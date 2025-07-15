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

// Adzuna import route with US location filtering
router.post(
  "/import-entry-jobs",
  adminOnly,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const ADZUNA_APP_ID = process.env.ADZUNA_APP_ID!;
    const ADZUNA_APP_KEY = process.env.ADZUNA_APP_KEY!;
    const ADZUNA_COUNTRY = "us";

    const { keyword = "", location = "United States", pages = 3, job_type = "entry_level" } = req.body;

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

    function isValidJobTitle(title: string): boolean {
      const lowerTitle = title.toLowerCase();
      return !excludeKeywords.some((kw) => lowerTitle.includes(kw));
    }

    let insertedCount = 0;

    for (let page = 1; page <= pages; page++) {
      console.log(`Fetching Adzuna page ${page}...`);

      const adzunaUrl = `https://api.adzuna.com/v1/api/jobs/${ADZUNA_COUNTRY}/search/${page}?app_id=${ADZUNA_APP_ID}&app_key=${ADZUNA_APP_KEY}&results_per_page=50&max_days_old=30&content-type=application/json${keyword ? `&what=${encodeURIComponent(keyword)}` : ""}${location ? `&where=${encodeURIComponent(location)}` : ""}`;

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
              job_type,
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

// Careerjet import route with US location filtering
router.post(
  "/import-careerjet-jobs",
  adminOnly,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const CAREERJET_AFFID = process.env.CAREERJET_AFFID!;
    const { keyword = "", location = "United States", pages = 3, job_type = "entry_level" } = req.body;

    let insertedCount = 0;

    for (let page = 1; page <= pages; page++) {
      console.log(`Fetching Careerjet page ${page}...`);

      const careerjetUrl = `http://public.api.careerjet.net/search?affid=${CAREERJET_AFFID}&keywords=${encodeURIComponent(keyword)}&location=${encodeURIComponent(location)}&pagesize=50&pagenumber=${page}&sort=relevance`;

      try {
        const response = await axios.get(careerjetUrl, {
          headers: {
            "User-Agent": "ypropel-backend/1.0",
          },
        });

        const data = response.data;

        if (data.type === "ERROR") {
          console.error("Careerjet API error:", data.error);
          return res.status(500).json({ error: "Careerjet API error: " + data.error });
        }

        if (data.type === "JOBS" && data.jobs && Array.isArray(data.jobs)) {
          console.log(`Fetched ${data.jobs.length} jobs from Careerjet.`);

          for (const job of data.jobs) {
            if (!job.title) {
              console.log("Skipped job with missing title");
              continue;
            }

            // You can add excludeKeywords filtering here if you want same logic as Adzuna

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
                  job.description,
                  null,
                  job.company || null,
                  job.locations || null,
                  null,
                  job.url,
                  new Date(job.date),
                  true,
                  job_type,
                  "United States",
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
        }
      } catch (error) {
        console.error("Error fetching Careerjet data:", error);
      }
    }

    console.log(`Careerjet import completed. Total inserted jobs: ${insertedCount}`);

    res.json({ success: true, inserted: insertedCount });
  })
);

// Sunnova import route scraping their career site
router.post(
  "/import-sunnova-jobs",
  adminOnly,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { job_type = "entry_level" } = req.body;

    let insertedCount = 0;

    // Example: Sunnova job board URL - update this as needed
    const sunnovaJobsUrl = "https://www.sunnova.com/careers#open-positions";

    // You might want to use a real scraper library like Puppeteer or Cheerio
    // Here we simulate scraping with a placeholder
    // Replace below with real scraping logic

    try {
      // Example: fetch and parse HTML here
      // const html = await axios.get(sunnovaJobsUrl);
      // const jobs = parseHtmlToJobs(html.data);

      // For demo: hardcoded example jobs
      const jobs = [
        {
          title: "Solar Installer",
          description: "Install solar panels at customer homes.",
          company: "Sunnova",
          location: "Houston, TX",
          url: "https://www.sunnova.com/careers/solar-installer",
          date: new Date().toISOString(),
        },
        {
          title: "Energy Consultant",
          description: "Consult clients on energy solutions.",
          company: "Sunnova",
          location: "Houston, TX",
          url: "https://www.sunnova.com/careers/energy-consultant",
          date: new Date().toISOString(),
        },
      ];

      for (const job of jobs) {
        const existing = await query(
          "SELECT id FROM jobs WHERE title = $1 AND company = $2 AND location = $3",
          [job.title, job.company, job.location]
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
              job.description,
              null,
              job.company,
              job.location,
              null,
              job.url,
              new Date(job.date),
              true,
              job_type,
              "United States",
              null,
              null,
            ]
          );
          insertedCount++;
          console.log(`Inserted job: ${job.title}`);
        } catch (error) {
          console.error(`Error inserting Sunnova job ${job.title}:`, error);
        }
      }

      console.log(`Sunnova import completed. Total inserted jobs: ${insertedCount}`);

      res.json({ success: true, inserted: insertedCount });
    } catch (error) {
      console.error("Error scraping Sunnova jobs:", error);
      res.status(500).json({ error: "Error scraping Sunnova jobs" });
    }
  })
);

export default router;
