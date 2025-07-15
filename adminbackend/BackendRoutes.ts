import express, { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import axios from "axios";
import { query } from "../db";

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret_key";

interface AuthRequest extends Request {
  user?: { userId: number; email?: string; isAdmin?: boolean };
}

function toSingleString(value: unknown): string {
  if (!value) return "";
  if (Array.isArray(value)) return value[0] || "";
  if (typeof value === "string") return value;
  return String(value);
}

// Category normalization map based on your table
const categoryMap: Record<string, string> = {
  "software engineering": "Engineering",
  "software developer": "Engineering",
  "software engineer": "Engineering",
  "engineer": "Engineering",
  "devops engineer": "Engineering",
  "network engineer": "Engineering",
  "system administrator": "Engineering",
  "database administrator": "Engineering",
  "cloud engineer": "Engineering",
  "quality assurance": "Engineering",
  "qa": "Engineering",
  "machine learning engineer": "Engineering",
  "ai engineer": "Engineering",
  "data engineer": "Engineering",

  "marketing": "Marketing",
  "digital marketing": "Marketing",
  "marketing coordinator": "Marketing",
  "social media": "Marketing",
  "content strategist": "Marketing",
  "brand manager": "Marketing",
  "public relations": "Marketing",

  "sales": "Sales",
  "business development": "Sales",
  "account manager": "Sales",

  "designer": "Design",
  "graphic designer": "Design",
  "ux designer": "Design",
  "ui designer": "Design",

  "operations": "Operations",
  "operations manager": "Operations",
  "project manager": "Operations",
  "supply chain": "Operations",
  "logistics": "Operations",
  "procurement": "Operations",

  "customer support": "Customer Support",
  "customer success": "Customer Support",
  "customer service manager": "Customer Support",

  "finance": "Finance",
  "financial analyst": "Finance",
  "accountant": "Finance",
  "controller": "Finance",
  "tax specialist": "Finance",
  "payroll": "Finance",
  "risk analyst": "Finance",
  "investment analyst": "Finance",
  "credit analyst": "Finance",

  "human resources": "Human Resources",
  "hr": "Human Resources",
  "recruiter": "Human Resources",

  "product management": "Product Management",
  "product manager": "Product Management",
  "product owner": "Product Management",
  "scrum master": "Product Management",

  "data science": "Data Science",
  "data scientist": "Data Science",
  "data analyst": "Data Science",
  "business intelligence": "Data Science",
};

function normalizeCategory(cat: string | null | undefined): string | null {
  if (!cat) return null;
  const key = cat.toLowerCase().trim();
  return categoryMap[key] || cat;
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

// ----------------- ADZUNA IMPORT -------------------
router.post(
  "/import-entry-jobs",
  adminOnly,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const ADZUNA_APP_ID = process.env.ADZUNA_APP_ID!;
    const ADZUNA_APP_KEY = process.env.ADZUNA_APP_KEY!;
    const ADZUNA_COUNTRY = "us";

    const {
      keyword = "",
      location = "United States",
      pages = 6,
      job_type = "entry_level",
    } = req.body;

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

        const categoryNormalized = normalizeCategory(job.category?.label || null);

        try {
          await query(
            `INSERT INTO jobs (
              title, description, category, company, location, requirements,
              apply_url, posted_at, is_active, job_type, country, state, city
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
            [
              job.title,
              job.description,
              categoryNormalized,
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

// ----------------- CAREERJET IMPORT -------------------
router.post(
  "/import-careerjet-jobs",
  adminOnly,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const CAREERJET_AFFID = process.env.CAREERJET_AFFID!;

    const keyword = toSingleString(req.body.keyword) || "";
    const location = toSingleString(req.body.location) || "United States";
    const pages = Number(req.body.pages) || 10;
    const job_type = toSingleString(req.body.job_type) || "entry_level";

    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    let insertedCount = 0;

    const userIp = req.ip || (req.headers["x-forwarded-for"] as string) || "8.8.8.8";
    const userAgent = req.headers["user-agent"] || "ypropel-backend/1.0";

    const excludeKeywords = [
      "technician",
      "shift",
      "customer service",
      "hourly",
      "cook",
      "nurse",
    ];

    const includeKeywords = [
      "engineer",
      "software",
      "product manager",
      "finance",
      "accounting",
      "architect",
      "data science",
      "cyber security",
      "cybersecurity",
      "analyst",
      "developer",
      "consultant",
      "marketing",
      "sales",
      "business analyst",
      "quality assurance",
      "qa",
      "researcher",
      "designer",
      "project manager",
      "operations",
      "human resources",
      "hr",
      "recruiter",
      "legal",
      "compliance",
      "audit",
      "controller",
      "tax",
      "strategy",
      "planner",
      "administrator",
      "executive assistant",
      "account manager",
      "customer success",
      "content writer",
      "copywriter",
      "public relations",
      "communications",
      "trainer",
      "product owner",
      "scrum master",
      "software engineer",
      "business development",
      "ux designer",
      "ui designer",
      "graphic designer",
      "digital marketing",
      "social media",
      "information security",
      "network engineer",
      "system administrator",
      "database administrator",
      "cloud engineer",
      "financial analyst",
      "risk analyst",
      "portfolio manager",
      "operations manager",
      "supply chain",
      "logistics",
      "procurement",
      "technical writer",
      "event coordinator",
      "content strategist",
      "brand manager",
      "accountant",
      "tax specialist",
      "payroll",
      "business intelligence",
      "data analyst",
      "machine learning engineer",
      "ai engineer",
      "software developer",
      "devops engineer",
      "product specialist",
      "corporate trainer",
      "customer service manager",
      "marketing coordinator",
      "office manager",
      "financial controller",
      "investment analyst",
      "credit analyst",
      "legal assistant",
      "paralegal",
      "corporate communications",
      "editor",
      "auditor",
      "compliance officer",
      "market researcher",
      "quality control",
      "procurement specialist",
    ];

    function containsKeyword(text: string, keywords: string[]): boolean {
      const lowerText = text.toLowerCase();
      return keywords.some((kw) => lowerText.includes(kw));
    }

    for (let page = 1; page <= pages; page++) {
      console.log(`Fetching Careerjet page ${page}...`);

      const careerjetUrl = `http://public.api.careerjet.net/search?affid=${CAREERJET_AFFID}&keywords=${encodeURIComponent(
        keyword
      )}&location=${encodeURIComponent(location)}&pagesize=50&pagenumber=${page}&sort=relevance&user_ip=${encodeURIComponent(
        userIp
      )}&user_agent=${encodeURIComponent(userAgent)}`;

      try {
        const response = await axios.get(careerjetUrl, {
          headers: {
            "User-Agent": userAgent,
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

            // Exclude if title contains any exclude keywords
            if (containsKeyword(job.title, excludeKeywords)) {
              console.log(`Excluded job by exclude keyword: ${job.title}`);
              continue;
            }

            // Include only if title contains at least one include keyword
            if (!containsKeyword(job.title, includeKeywords)) {
              console.log(`Skipped job - does not match include keywords: ${job.title}`);
              continue;
            }

            // Parse city and state from job.locations string
            const locParts = (job.locations || "").split(",").map((s: string) => s.trim());
            const city = locParts[0] || null;
            const state = locParts[1] || null;

            const categoryNormalized = normalizeCategory(job.category?.label || null);

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
                  categoryNormalized,
                  job.company || null,
                  job.locations || null,
                  null,
                  job.url,
                  new Date(job.date),
                  true,
                  job_type,
                  "United States",
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
      } catch (error) {
        console.error("Error fetching Careerjet data:", error);
        // Optionally respond with error or continue
      }
    }

    console.log(`Careerjet import completed. Total inserted jobs: ${insertedCount}`);

    res.json({ success: true, inserted: insertedCount });
  })
);

//------careerjet hourly
router.post(
  "/import-careerjet-hourly-jobs",
  adminOnly,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const CAREERJET_AFFID = process.env.CAREERJET_AFFID!;

    // Normalize inputs
    const keyword = toSingleString(req.body.keyword) || "";
    const location = toSingleString(req.body.location) || "United States";
    const pages = Number(req.body.pages) || 10;
    const job_type = "hourly"; // fixed job_type for hourly jobs import

    // User ID check (optional, depending on your app logic)
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    let insertedCount = 0;

    // Get user IP and user agent for Careerjet API
    const userIp = req.ip || (req.headers["x-forwarded-for"] as string) || "8.8.8.8";
    const userAgent = req.headers["user-agent"] || "ypropel-backend/1.0";

    // **This time we do NOT exclude any keywords**
    // Instead, we want to include all previously excluded keywords and hourly/shift jobs
    // So we do NOT filter out jobs by excludeKeywords at all.

    // But to be consistent, let's keep includeKeywords broad (or empty)
    // or just allow all jobs with keywords like "hourly", "shift" explicitly.
    // For safety, let's include only jobs that mention "hourly" or "shift" or the excluded job types:

    const includeKeywords = [
      "hourly",
      "shift",
      "technician",
      "cook",
      "nurse",
      "cashier",
      "driver",
      "security",
      "customer service",
      "janitor",
      "cleaner",
      "waiter",
      "waitress",
      "barista",
      "laborer",
      "warehouse",
      "stock clerk",
      "maintenance",
      "packer",
      "food service",
      "host",
      "dishwasher",
    ];

    function containsKeyword(text: string, keywords: string[]): boolean {
      const lowerText = text.toLowerCase();
      return keywords.some((kw) => lowerText.includes(kw));
    }

    for (let page = 1; page <= pages; page++) {
      console.log(`Fetching Careerjet hourly jobs page ${page}...`);

      const careerjetUrl = `http://public.api.careerjet.net/search?affid=${CAREERJET_AFFID}&keywords=${encodeURIComponent(
        keyword
      )}&location=${encodeURIComponent(location)}&pagesize=50&pagenumber=${page}&sort=relevance&user_ip=${encodeURIComponent(
        userIp
      )}&user_agent=${encodeURIComponent(userAgent)}`;

      try {
        const response = await axios.get(careerjetUrl, {
          headers: {
            "User-Agent": userAgent,
          },
        });

        const data = response.data;

        if (data.type === "ERROR") {
          console.error("Careerjet API error:", data.error);
          return res.status(500).json({ error: "Careerjet API error: " + data.error });
        }

        if (data.type === "JOBS" && data.jobs && Array.isArray(data.jobs)) {
          console.log(`Fetched ${data.jobs.length} hourly jobs from Careerjet.`);

          for (const job of data.jobs) {
            if (!job.title) {
              console.log("Skipped job with missing title");
              continue;
            }

            // Include only jobs matching includeKeywords
            if (!containsKeyword(job.title, includeKeywords)) {
              console.log(`Skipped job - does not match hourly include keywords: ${job.title}`);
              continue;
            }

            // Parse city and state from job.locations string
            const locParts = (job.locations || "").split(",").map((s: string) => s.trim());
            const city = locParts[0] || null;
            const state = locParts[1] || null;

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
                  state,
                  city,
                ]
              );
              insertedCount++;
              console.log(`Inserted hourly job: ${job.title}`);
            } catch (error) {
              console.error(`Error inserting hourly job ${job.title}:`, error);
            }
          }
        }
      } catch (error) {
        console.error("Error fetching Careerjet hourly jobs data:", error);
      }
    }

    console.log(`Careerjet hourly jobs import completed. Total inserted jobs: ${insertedCount}`);

    res.json({ success: true, inserted: insertedCount });
  })
);

//-- ---careerjet internhips
router.post(
  "/import-careerjet-intern-jobs",
  adminOnly,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const CAREERJET_AFFID = process.env.CAREERJET_AFFID!;

    const keyword = toSingleString(req.body.keyword) || "";
    const location = toSingleString(req.body.location) || "United States";
    const pages = Number(req.body.pages) || 10;
    const job_type = "internship";

    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    let insertedCount = 0;

    const userIp = req.ip || (req.headers["x-forwarded-for"] as string) || "8.8.8.8";
    const userAgent = req.headers["user-agent"] || "ypropel-backend/1.0";

    const includeKeywords = [
      "internship",
      "intern",
      "early career",
      "graduate",
      "trainee",
      "apprentice",
      "co-op",
      "student",
      "summer intern",
    ];

    function containsKeyword(text: string, keywords: string[]): boolean {
      const lowerText = text.toLowerCase();
      return keywords.some((kw) => lowerText.includes(kw));
    }

    for (let page = 1; page <= pages; page++) {
      console.log(`Fetching Careerjet internship jobs page ${page}...`);

      const careerjetUrl = `http://public.api.careerjet.net/search?affid=${CAREERJET_AFFID}&keywords=${encodeURIComponent(
        keyword
      )}&location=${encodeURIComponent(location)}&pagesize=50&pagenumber=${page}&sort=relevance&user_ip=${encodeURIComponent(
        userIp
      )}&user_agent=${encodeURIComponent(userAgent)}`;

      try {
        const response = await axios.get(careerjetUrl, {
          headers: {
            "User-Agent": userAgent,
          },
        });

        const data = response.data;

        if (data.type === "ERROR") {
          console.error("Careerjet API error:", data.error);
          return res.status(500).json({ error: "Careerjet API error: " + data.error });
        }

        if (data.type === "JOBS" && data.jobs && Array.isArray(data.jobs)) {
          console.log(`Fetched ${data.jobs.length} internship jobs from Careerjet.`);

          for (const job of data.jobs) {
            if (!job.title) {
              console.log("Skipped job with missing title");
              continue;
            }

            if (!containsKeyword(job.title, includeKeywords)) {
              console.log(`Skipped job - does not match internship include keywords: ${job.title}`);
              continue;
            }

            const locParts = (job.locations || "").split(",").map((s: string) => s.trim());
            const city = locParts[0] || null;
            const state = locParts[1] || null;

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
                  state,
                  city,
                ]
              );
              insertedCount++;
              console.log(`Inserted internship job: ${job.title}`);
            } catch (error) {
              console.error(`Error inserting internship job ${job.title}:`, error);
            }
          }
        }
      } catch (error) {
        console.error("Error fetching Careerjet internship jobs data:", error);
      }
    }

    console.log(`Careerjet internship jobs import completed. Total inserted jobs: ${insertedCount}`);

    res.json({ success: true, inserted: insertedCount });
  })
);

// ----------------- GOOGLE CAREERS IMPORT -------------------
router.post(
  "/import-google-jobs",
  adminOnly,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { keyword = "", location = "United States", pages = 3, job_type = "entry_level" } = req.body;

    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    const now = new Date();

    let insertedCount = 0;

    for (let page = 0; page < pages; page++) {
      const start = page * 10;

      const filter = `location=${encodeURIComponent(location)}`;
      const employmentType = job_type === "internship" ? "INTERN" : "FULL_TIME";
      const url = `https://careers.google.com/api/v3/search/?query=${encodeURIComponent(
        keyword
      )}&${filter}&offset=${start}&limit=10&employment_type=${employmentType}`;

      try {
        const response = await axios.get(url);
        const jobs = response.data.jobs;

        if (!jobs || jobs.length === 0) {
          console.log(`No jobs found on Google Careers page ${page + 1}`);
          break;
        }

        for (const job of jobs) {
          const title = job.title || "";
          const company = job.company?.name || "Google";
          const locationStr =
            job.locations?.map((loc: any) => loc.name).join(", ") || "";
          const jobUrl = job.applyUrl || `https://careers.google.com/jobs/results/${job.jobId}/`;
          const description = job.description || "";
          const postedDate = job.postedDate ? new Date(job.postedDate) : null;

          if (!postedDate || now.getTime() - postedDate.getTime() > THIRTY_DAYS_MS) {
            console.log(`Skipped old or missing date job: ${title}`);
            continue;
          }

          const titleLower = title.toLowerCase();
          if (titleLower.includes("senior") || titleLower.includes("manager") || titleLower.includes("lead")) {
            console.log(`Skipped senior/manager job: ${title}`);
            continue;
          }

          const existing = await query(
            "SELECT id FROM jobs WHERE title = $1 AND company = $2 AND location = $3",
            [title, company, locationStr]
          );

          if (existing.rows.length > 0) {
            console.log(`Job already exists: ${title} at ${company}`);
            continue;
          }

          if (!jobUrl || jobUrl.includes("job-not-found") || jobUrl.includes("removed")) {
            console.log(`Skipped job with invalid apply URL: ${title}`);
            continue;
          }

          try {
            await query(
              `INSERT INTO jobs (
                title, description, category, company, location, requirements,
                apply_url, posted_at, is_active, job_type, country, state, city
              ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
              [
                title,
                description,
                null,
                company,
                locationStr,
                null,
                jobUrl,
                postedDate,
                true,
                job_type,
                "United States",
                null,
                null,
              ]
            );
            insertedCount++;
            console.log(`Inserted job: ${title}`);
          } catch (err) {
            console.error(`Error inserting job ${title}:`, err);
          }
        }
      } catch (error) {
        console.error(`Error fetching Google Careers page ${page + 1}:`, error);
        return res.status(500).json({ error: "Failed to fetch jobs from Google Careers" });
      }
    }

    console.log(`Google Careers import completed. Total inserted jobs: ${insertedCount}`);
    res.json({ success: true, inserted: insertedCount });
  })
);

// ----------------- TESLA IMPORT (new company scraper example) -------------------
router.post(
  "/import-tesla-jobs",
  adminOnly,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { keyword = "", location = "United States", pages = 1, job_type = "entry_level" } = req.body;

    let insertedCount = 0;

    for (let page = 0; page < pages; page++) {
      console.log(`Fetching Tesla jobs page ${page + 1}...`);

      try {
        const response = await axios.post("https://www.tesla.com/careers/api/v1/search", {
          filters: {
            keywords: keyword || "",
            location: location || "",
          },
          page: page,
          pageSize: 50,
        });

        console.log("Tesla response data sample:", JSON.stringify(response.data, null, 2));

        const jobs = response.data.data || [];

        if (!jobs.length) {
          console.log(`No Tesla jobs found on page ${page + 1}`);
          break;
        }

        for (const job of jobs) {
          console.log("Tesla job item:", job);

          const title = job.title || "";
          const company = "Tesla";
          const locationStr = job.location || location;
          const jobUrl = `https://www.tesla.com/careers/job/${job.id}`;
          const description = job.description || "";
          const postedDate = job.postedDate ? new Date(job.postedDate) : null;

          if (!postedDate) {
            console.log(`Tesla job missing postedDate, skipping: ${title}`);
            continue; // or accept, your choice
          }

          const titleLower = title.toLowerCase();
          if (titleLower.includes("senior") || titleLower.includes("manager") || titleLower.includes("lead")) {
            console.log(`Skipped senior/manager Tesla job: ${title}`);
            continue;
          }

          const existing = await query(
            "SELECT id FROM jobs WHERE title = $1 AND company = $2 AND location = $3",
            [title, company, locationStr]
          );

          if (existing.rows.length > 0) {
            console.log(`Tesla job already exists: ${title} at ${company}`);
            continue;
          }

          try {
            await query(
              `INSERT INTO jobs (
                title, description, category, company, location, requirements,
                apply_url, posted_at, is_active, job_type, country, state, city
              ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
              [
                title,
                description,
                null,
                company,
                locationStr,
                null,
                jobUrl,
                postedDate,
                true,
                job_type,
                "United States",
                null,
                null,
              ]
            );
            insertedCount++;
            console.log(`Inserted Tesla job: ${title}`);
          } catch (err) {
            console.error(`Error inserting Tesla job ${title}:`, err);
          }
        }
      } catch (error) {
        console.error(`Error fetching Tesla jobs page ${page + 1}:`, error);
        return res.status(500).json({ error: "Failed to fetch jobs from Tesla Careers" });
      }
    }

    console.log(`Tesla import completed. Total inserted jobs: ${insertedCount}`);
    res.json({ success: true, inserted: insertedCount });
  })
);


router.post(
  "/import-lever-jobs",
  adminOnly,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const company = req.body.company || "github"; // default company if not provided
    const url = `https://jobs.lever.co/${company}?mode=json`;

    console.log(`Fetching Lever jobs for company: ${company}`);

    try {
      const response = await axios.get(url);
      const jobs = response.data;

      let insertedCount = 0;

      for (const job of jobs) {
        const title = job.text || "";
        const location = job.categories?.location || "Unknown";
        const applyUrl = job.hostedUrl || "";
        const description = job.description || "";
        const companyName = company.charAt(0).toUpperCase() + company.slice(1);

        // Skip if title or applyUrl missing
        if (!title || !applyUrl) continue;

        // Check if job already exists to avoid duplicates
        const existing = await query(
          "SELECT id FROM jobs WHERE title=$1 AND company=$2 AND location=$3",
          [title, companyName, location]
        );

        if (existing.rows.length > 0) {
          console.log(`Job already exists: ${title} at ${companyName} in ${location}`);
          continue;
        }

        // Insert job into your jobs table
        await query(
          `INSERT INTO jobs (
            title, description, company, location, apply_url, posted_at, is_active, job_type, country
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            title,
            description,
            companyName,
            location,
            applyUrl,
            new Date(), // use current date as posted_at since Lever feed doesn’t provide it
            true,
            req.body.job_type || "entry_level",
            "United States",
          ]
        );

        insertedCount++;
        console.log(`Inserted job: ${title} at ${companyName}`);
      }

      res.json({ success: true, inserted: insertedCount });
    } catch (error) {
      console.error("Error fetching Lever jobs:", error);
      res.status(500).json({ error: "Failed to fetch Lever jobs" });
    }
  })
);

export default router;
