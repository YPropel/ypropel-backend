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

// Google Careers import route (example using hypothetical Google Careers API endpoint)
router.post(
  "/import-google-jobs",
  adminOnly,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    // You need your Google Cloud API key here in your env
    const GOOGLE_API_KEY = process.env.GOOGLE_API_KEY!;
    const { keyword = "", location = "United States", pages = 3, job_type = "entry_level" } = req.body;

    // Define experience filter keywords (approximate filtering)
    const excludeKeywords = ['senior', 'manager', 'director', 'lead', 'principal'];
    const includeKeywords = ['entry level', 'junior', '1 year', '2 years', '3 years', '4 years', '5 years', 'graduate', 'internship'];

    function isEntryLevelJob(title: string, description: string) {
      const text = (title + ' ' + description).toLowerCase();
      if (excludeKeywords.some(kw => text.includes(kw))) return false;
      if (includeKeywords.some(kw => text.includes(kw))) return true;
      // default to false if unsure
      return false;
    }

    let insertedCount = 0;

    for (let page = 1; page <= pages; page++) {
      console.log(`Fetching Google Careers page ${page}...`);

      // Example Google Jobs API URL - you need to replace with actual Google Jobs API endpoint and query parameters
      const googleJobsUrl = `https://jobs.googleapis.com/v4/projects/YOUR_PROJECT_ID/tenants/YOUR_TENANT_ID/jobs?pageSize=50&pageToken=${page}&filter=location=United States&query=${encodeURIComponent(keyword)}&key=${GOOGLE_API_KEY}`;

      try {
        const response = await axios.get(googleJobsUrl);

        const jobs = response.data.jobs || [];

        console.log(`Fetched ${jobs.length} jobs from Google Careers.`);

        for (const job of jobs) {
          const title = job.title || "";
          const description = job.description || "";
          if (!isEntryLevelJob(title, description)) {
            console.log(`Skipped job due to experience level mismatch: ${title}`);
            continue;
          }

          // Check job status active - example field (you need to check actual API response fields)
          if (job.jobState !== 'JOB_STATE_PUBLISHED') {
            console.log(`Skipped inactive job: ${title}`);
            continue;
          }

          // Construct apply URL - ensure it's a full valid URL
          const applyUrl = job.applicationInfo?.uris?.length > 0 ? job.applicationInfo.uris[0] : job.jobUri || "";

          if (!applyUrl.startsWith("http")) {
            console.log(`Skipped job due to invalid apply URL: ${title}`);
            continue;
          }

          // Check if job exists already in DB
          const existing = await query(
            "SELECT id FROM jobs WHERE title = $1 AND company = $2 AND location = $3",
            [title, job.companyDisplayName || null, job.addresses?.[0] || null]
          );

          if (existing.rows.length > 0) {
            console.log(`Job already exists: ${title} at ${job.companyDisplayName}`);
            continue;
          }

          // Insert into jobs table
          try {
            await query(
              `INSERT INTO jobs (
                title, description, category, company, location, requirements,
                apply_url, posted_at, is_active, job_type, country, state, city
              ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
              [
                title,
                description,
                null, // category - if API provides category, map here
                job.companyDisplayName || null,
                job.addresses?.[0] || null,
                null,
                applyUrl,
                job.postingCreateTime || new Date(),
                true,
                job_type,
                "United States",
                null,
                null,
              ]
            );
            insertedCount++;
            console.log(`Inserted job: ${title}`);
          } catch (error) {
            console.error(`Error inserting job ${title}:`, error);
          }
        }
      } catch (error) {
        console.error("Error fetching Google Careers data:", error);
      }
    }

    console.log(`Google Careers import completed. Total inserted jobs: ${insertedCount}`);

    res.json({ success: true, inserted: insertedCount });
  })
);

export default router;
