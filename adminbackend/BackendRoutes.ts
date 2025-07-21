import express, { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import axios from "axios";
import { query } from "../db";

import Parser from "rss-parser";

const parser = new Parser({
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)...",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.5",
    "Connection": "keep-alive"
  }
});



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

// Helper: Infer category based on job title keywords (mapped to your job_categories)
function inferCategoryFromTitle(title: string): string | null {
  if (!title) return null;
  const lowerTitle = title.toLowerCase();

  if (
    lowerTitle.includes("engineer") ||
    lowerTitle.includes("developer") ||
    lowerTitle.includes("software") ||
    lowerTitle.includes("qa") ||
    lowerTitle.includes("devops") ||
    lowerTitle.includes("data scientist") ||
    lowerTitle.includes("machine learning") ||
    lowerTitle.includes("ai") ||
    lowerTitle.includes("network") ||
    lowerTitle.includes("system administrator") ||
    lowerTitle.includes("database administrator") ||
    lowerTitle.includes("cloud")
  )
    return "Engineering";

  if (
    lowerTitle.includes("marketing") ||
    lowerTitle.includes("social media") ||
    lowerTitle.includes("content") ||
    lowerTitle.includes("brand") ||
    lowerTitle.includes("public relations")
  )
    return "Marketing";

  if (
    lowerTitle.includes("sales") ||
    lowerTitle.includes("business development") ||
    lowerTitle.includes("account manager")
  )
    return "Sales";

  if (
    lowerTitle.includes("designer") ||
    lowerTitle.includes("graphic") ||
    lowerTitle.includes("ux") ||
    lowerTitle.includes("ui")
  )
    return "Design";

  if (
    lowerTitle.includes("operations") ||
    lowerTitle.includes("project manager") ||
    lowerTitle.includes("logistics") ||
    lowerTitle.includes("procurement") ||
    lowerTitle.includes("supply chain")
  )
    return "Operations";

  if (
    lowerTitle.includes("customer support") ||
    lowerTitle.includes("customer service") ||
    lowerTitle.includes("customer success")
  )
    return "Customer Support";

  if (
    lowerTitle.includes("finance") ||
    lowerTitle.includes("accountant") ||
    lowerTitle.includes("controller") ||
    lowerTitle.includes("tax") ||
    lowerTitle.includes("payroll") ||
    lowerTitle.includes("analyst") ||
    lowerTitle.includes("investment")
  )
    return "Finance";

  if (
    lowerTitle.includes("human resources") ||
    lowerTitle.includes("hr") ||
    lowerTitle.includes("recruiter")
  )
    return "Human Resources";

  if (
    lowerTitle.includes("product manager") ||
    lowerTitle.includes("product owner") ||
    lowerTitle.includes("scrum master")
  )
    return "Product Management";

  if (
    lowerTitle.includes("data analyst") ||
    lowerTitle.includes("data science") ||
    lowerTitle.includes("business intelligence")
  )
    return "Data Science";

  return null;
}

// Map inferred category to valid categories fetched from DB
function mapCategoryToValid(inferredCategory: string | null, validCategories: string[]): string | null {
  if (!inferredCategory) return null;
  const match = validCategories.find(cat => cat.toLowerCase() === inferredCategory.toLowerCase());
  return match || null;
}

// Fetch job categories from the database
async function fetchJobCategories(): Promise<string[]> {
  const result = await query("SELECT name FROM job_categories");
  return result.rows.map(row => row.name);
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

    // Fetch valid categories from DB
    const validCategories = await fetchJobCategories();

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

        // Infer category and map to DB categories
        const inferredCategoryRaw = job.category?.label || inferCategoryFromTitle(job.title);
        const inferredCategory = mapCategoryToValid(inferredCategoryRaw, validCategories);

        try {
          await query(
            `INSERT INTO jobs (
              title, description, category, company, location, requirements,
              apply_url, posted_at, is_active, job_type, country, state, city
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
            [
              job.title,
              job.description,
              inferredCategory,
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

    // Keep your original exclude keywords
    const excludeKeywords = [
      "technician",
      "shift",
      "customer service",
      "hourly",
      "cook",
      "nurse",
    ];

    // Keep your original include keywords
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

    // Fetch valid categories from DB once
    const validCategories = await fetchJobCategories();

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

            if (containsKeyword(job.title, excludeKeywords)) {
              console.log(`Excluded job by exclude keyword: ${job.title}`);
              continue;
            }

            if (!containsKeyword(job.title, includeKeywords)) {
              console.log(`Skipped job - does not match include keywords: ${job.title}`);
              continue;
            }

            // Parse city and state from job.locations string
            const locParts = (job.locations || "").split(",").map((s: string) => s.trim());
            const city = locParts[0] || null;
            const stateFull = locParts[1] || null;

            // Map full state name or abbreviation to abbreviation
            let stateAbbreviation: string | null = null;
            if (stateFull) {
              if (stateFull.length === 2) {
                stateAbbreviation = stateFull.toUpperCase();
              } else {
                const result = await query(
                  "SELECT abbreviation FROM us_states WHERE LOWER(name) = LOWER($1) LIMIT 1",
                  [stateFull]
                );
                if (result.rows.length > 0) {
                  stateAbbreviation = result.rows[0].abbreviation;
                }
              }
            }

            // Infer category from title and map to DB category
            const inferredCategoryRaw = inferCategoryFromTitle(job.title);
            const inferredCategory = mapCategoryToValid(inferredCategoryRaw, validCategories);

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
                  inferredCategory,
                  job.company || null,
                  job.locations || null,
                  null,
                  job.url,
                  new Date(job.date),
                  true,
                  job_type,
                  "United States",
                  stateAbbreviation,
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

// --- Other existing routes unchanged ---

// --------------- INTERN INSIDER Newsletter RSS IMPORT -----------------
router.post(
  "/import-intern-insider",
  adminOnly,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    try {
      const feed = await parser.parseURL("https://interninsider.substack.com/feed");
      const validCategories = await fetchJobCategories();
      let insertedCount = 0;

      for (const item of feed.items) {
        const title = item.title || "";
        const link = item.link || "";
        const description = item.contentSnippet || item.content || "";
        const pubDate = item.pubDate ? new Date(item.pubDate) : new Date();

        // Check duplicates by title or apply_url (link)
        const existing = await query(
          "SELECT id FROM jobs WHERE title = $1 OR apply_url = $2",
          [title, link]
        );
        if (existing.rows.length > 0) continue; // skip duplicate

        // Infer category from title
        const inferredCategoryRaw = inferCategoryFromTitle(title);
        const inferredCategory = mapCategoryToValid(inferredCategoryRaw, validCategories);

        // Insert into jobs table
        await query(
          `INSERT INTO jobs (
            title, description, category, company, location,
            apply_url, posted_at, is_active, job_type
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            title,
            description,
            inferredCategory,
            null,       // no company info in feed
            null,       // no location info in feed
            link,
            pubDate,
            true,
            "internship" // or "entry_level" as you prefer
          ]
        );
        insertedCount++;
      }

      res.json({ message: `Imported ${insertedCount} new internships from Intern Insider RSS feed.` });
    } catch (error) {
      console.error("Error importing Intern Insider RSS feed:", error);
      res.status(500).json({ error: "Failed to import Intern Insider feed" });
    }
  })
);

// ----------------- SIMPLYHIRED IMPORT -------------------
router.post(
  "/import-simplyhired-jobs",
  adminOnly,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const parser = new Parser();
    const { q = "software engineer", location = "" } = req.body;

    // Construct SimplyHired RSS feed URL - update as needed
    const baseUrl = "https://www.simplyhired.com/search/rss";
    const urlParams = new URLSearchParams();
    urlParams.append("q", q);
    if (location) urlParams.append("l", location);
    
    
    const rssUrl = req.body.rssUrl;
if (!rssUrl) {
  return res.status(400).json({ error: "rssUrl parameter is required." });
}
const feed = await parser.parseURL(rssUrl);


    // Fetch valid categories from DB once
    const validCategories = await fetchJobCategories();

    let inserted = 0;
    let updated = 0;

    for (const item of feed.items) {
      const sourceJobId = item.guid || item.link || "";

      if (!sourceJobId) continue;

      // Check if job already exists
      const existing = await query(
        "SELECT id FROM jobs WHERE source_job_id = $1 LIMIT 1",
        [sourceJobId]
      );

      // Map category from feed item categories or infer from title
      const categoryName = item.categories && item.categories.length > 0 ? item.categories[0] : "";
     let categoryId: string | null = null;

      if (categoryName) {
        categoryId = await query(
          "SELECT id FROM job_categories WHERE LOWER(name) = LOWER($1) LIMIT 1",
          [categoryName.trim()]
        ).then(res => (res.rows.length > 0 ? res.rows[0].id : null));
      }
      if (!categoryId) {
        // fallback: infer category from title
        const inferred = inferCategoryFromTitle(item.title || "");
        categoryId = mapCategoryToValid(inferred, validCategories);
      }

      // Simple location inference
      let jobLocation = "onsite";
      const textToCheck = `${item.title} ${item.contentSnippet}`.toLowerCase();
      if (textToCheck.includes("remote")) jobLocation = "remote";
      else if (textToCheck.includes("hybrid")) jobLocation = "hybrid";

      const jobData = {
        title: item.title || "",
        description: item.content || "",
        category: categoryId,
        company: item.creator || item["dc:creator"] || "Unknown",
        location: jobLocation,
        requirements: "",
        apply_url: item.link || "",
        posted_by: req.user?.userId || 1,
        posted_at: item.pubDate ? new Date(item.pubDate) : new Date(),
        is_active: true,
        expires_at: null,
        salary: "",
        job_type: "",
        country: "",
        state: "",
        city: "",
        source_job_id: sourceJobId,
      };

      if (existing.rows.length === 0) {
        await query(
          `INSERT INTO jobs (
            title, description, category, company, location, requirements,
            apply_url, posted_by, posted_at, is_active, expires_at, salary, job_type,
            country, state, city, source_job_id
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
          [
            jobData.title,
            jobData.description,
            jobData.category,
            jobData.company,
            jobData.location,
            jobData.requirements,
            jobData.apply_url,
            jobData.posted_by,
            jobData.posted_at,
            jobData.is_active,
            jobData.expires_at,
            jobData.salary,
            jobData.job_type,
            jobData.country,
            jobData.state,
            jobData.city,
            jobData.source_job_id,
          ]
        );
        inserted++;
      } else {
        // Optionally update existing record here
        updated++;
      }
    }

    res.json({ message: `SimplyHired import complete. Inserted: ${inserted}, Updated: ${updated}` });
  })
);


export default router;
