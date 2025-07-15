import express, { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import axios from "axios";
import { query } from "../db";

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret_key";

interface AuthRequest extends Request {
  user?: { userId: number; email?: string; isAdmin?: boolean };
}

// Async wrapper to catch errors
function asyncHandler(
  fn: (req: AuthRequest, res: Response, next: NextFunction) => Promise<any>
) {
  return function (req: AuthRequest, res: Response, next: NextFunction) {
    fn(req, res, next).catch(next);
  };
}

// Authentication middleware
function authenticateToken(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers["authorization"];
  const token = authHeader?.split(" ")[1];

  if (!token) {
    res.status(401).json({ error: "Unauthorized: No token provided" });
    return;
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      res.status(403).json({ error: "Forbidden: Invalid token" });
      return;
    }

    const payload = user as { userId: number; email?: string; is_admin?: boolean };

    req.user = {
      userId: payload.userId,
      email: payload.email,
      isAdmin: payload.is_admin || false,
    };

    next();
  });
}

// Admin-only middleware
function adminOnly(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user?.isAdmin) {
    res.status(403).json({ error: "Access denied. Admins only." });
    return;
  }
  next();
}

// Protect all routes below this middleware with authentication
router.use(authenticateToken);

// === Adzuna import route ===
router.post(
  "/import-entry-jobs",
  adminOnly,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const ADZUNA_APP_ID = process.env.ADZUNA_APP_ID!;
    const ADZUNA_APP_KEY = process.env.ADZUNA_APP_KEY!;
    const ADZUNA_COUNTRY = "us";

    const { keyword = "", location = "", pages = 3, jobType = "entry_level" } = req.body;

    // For internships, force keyword to "internship" for better results
    let searchKeyword = keyword;
    if (jobType === "internship") {
      searchKeyword = "internship";
    }

    const excludeKeywords = [
      "cook",
      "customer support",
      "technician",
      "cashier",
      "driver",
      "security",
      "hourly",
      "shift supervisor",
      "supervisor",
      "janitor",
      // Add more excluded keywords as needed
    ];

    function isValidJobTitle(title: string): boolean {
      const lowerTitle = title.toLowerCase();
      return !excludeKeywords.some((kw) => lowerTitle.includes(kw));
    }

    let insertedCount = 0;

    for (let page = 1; page <= pages; page++) {
      console.log(`Fetching Adzuna page ${page}...`);

      const adzunaUrl = `https://api.adzuna.com/v1/api/jobs/${ADZUNA_COUNTRY}/search/${page}?app_id=${ADZUNA_APP_ID}&app_key=${ADZUNA_APP_KEY}&results_per_page=50&max_days_old=30&content-type=application/json${searchKeyword ? `&what=${encodeURIComponent(searchKeyword)}` : ""}${location ? `&where=${encodeURIComponent(location)}` : ""}`;

      const response = await axios.get(adzunaUrl);
      const jobs = response.data.results;
      console.log(`Fetched ${jobs.length} jobs from Adzuna.`);

      for (const job of jobs) {
        if (!job.title || !isValidJobTitle(job.title)) {
          console.log(`Skipped job due to excluded title: ${job.title}`);
          continue;
        }

        const existing = await query(
          "SELECT id FROM jobs WHERE title = $1 AND company = $2 AND location = $3",
          [job.title, job.company?.display_name || null, job.location?.display_name || null]
        );

        if (existing.rows.length > 0) {
          console.log(`Job already exists: ${job.title} at ${job.company?.display_name}`);
          continue;
        }

        const loc = job.location || {};
        const city = loc.area ? loc.area[1] || null : null;
        const state = loc.area ? loc.area[2] || null : null;
        const country = loc.area ? loc.area[0] || null : null;

        try {
          await query(
            `INSERT INTO jobs (
              title, description, category, company, location, requirements,
              apply_url, posted_at, is_active, job_type, country, state, city
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
            [
              job.title,
              job.description,
              job.category?.label || null,
              job.company?.display_name || null,
              job.location?.display_name || null,
              null,
              job.redirect_url,
              job.created,
              true,
              jobType,
              country,
              state,
              city,
            ]
          );
          insertedCount++;
          console.log(`Inserted job: ${job.title}`);
        } catch (error) {
          console.error(`Error inserting job ${job.title}:`, error);
        }
      }
    }

    console.log(`Adzuna import completed. Total inserted jobs: ${insertedCount}`);

    res.json({ success: true, inserted: insertedCount });
  })
);

// === Careerjet import route (you can update or extend similarly) ===
router.post(
  "/import-careerjet-jobs",
  adminOnly,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const CAREERJET_AFFID = process.env.CAREERJET_AFFID!;
    const { keyword = "", location = "", pages = 3, jobType = "entry_level" } = req.body;

    // Force keyword if internship for better match
    let searchKeyword = keyword;
    if (jobType === "internship") {
      searchKeyword = "internship";
    }

    let insertedCount = 0;

    // The Careerjet API is a GET request with parameters; paginate by 'pagenumber'
    for (let page = 1; page <= pages; page++) {
      console.log(`Fetching Careerjet page ${page}...`);

      const params = new URLSearchParams({
        affid: CAREERJET_AFFID,
        keywords: searchKeyword,
        location,
        pagesize: "50",
        pagenumber: page.toString(),
        sort: "relevance",
      });

      try {
        const response = await axios.get(`https://public.api.careerjet.net/search?${params.toString()}`, {
          headers: {
            "User-Agent": "YPropel-Backend-Client/1.0",
          },
        });

        const data = response.data;

        if (data.type !== "JOBS") {
          console.log(`Careerjet response type: ${data.type}. No jobs fetched on page ${page}.`);
          continue;
        }

        const jobs = data.jobs;

        for (const job of jobs) {
          if (!job.title || !job.company) {
            console.log("Skipped job due to missing title or company");
            continue;
          }

          // Optionally skip excluded titles same as Adzuna
          const excludeKeywords = [
            "cook",
            "customer support",
            "technician",
            "cashier",
            "driver",
            "security",
            "hourly",
            "shift supervisor",
            "supervisor",
            "janitor",
          ];

          const lowerTitle = job.title.toLowerCase();
          if (excludeKeywords.some((kw) => lowerTitle.includes(kw))) {
            console.log(`Skipped job due to excluded title: ${job.title}`);
            continue;
          }

          const existing = await query(
            "SELECT id FROM jobs WHERE title = $1 AND company = $2 AND location = $3",
            [job.title, job.company || null, job.locations || null]
          );

          if (existing.rows.length > 0) {
            console.log(`Job already exists: ${job.title} at ${job.company}`);
            continue;
          }

          try {
            await query(
              `INSERT INTO jobs (
                title, description, category, company, location, requirements,
                apply_url, posted_at, is_active, job_type, country, state, city
              ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
              [
                job.title,
                job.description || null,
                null,
                job.company || null,
                job.locations || null,
                null,
                job.url || null,
                job.date || null,
                true,
                jobType,
                null,
                null,
                null,
              ]
            );
            insertedCount++;
            console.log(`Inserted job: ${job.title}`);
          } catch (error) {
            console.error(`Error inserting job ${job.title}:`, error);
          }
        }
      } catch (error) {
        console.error(`Error fetching Careerjet page ${page}:`, error);
      }
    }

    console.log(`Careerjet import completed. Total inserted jobs: ${insertedCount}`);

    res.json({ success: true, inserted: insertedCount });
  })
);

export default router;
