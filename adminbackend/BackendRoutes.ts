import express, { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import axios from "axios";
import { query } from "../db";

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret_key";

// Async wrapper
function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) {
  return function (req: Request, res: Response, next: NextFunction) {
    fn(req, res, next).catch(next);
  };
}

// Authentication middleware (already in your file)
function authenticateToken(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers["authorization"];
  const token = authHeader?.split(" ")[1];

  if (!token) {
    res.sendStatus(401);
    return;
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      res.sendStatus(403);
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

// Protect all admin routes with authentication middleware
router.use(authenticateToken);

// Existing DELETE /news/:id route here...

// New POST /admin/import-entry-jobs route
router.post(
  "/admin/import-entry-jobs",
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user?.isAdmin) {
      return res.status(403).json({ error: "Access denied. Admins only." });
    }

    const ADZUNA_APP_ID = process.env.ADZUNA_APP_ID!;
    const ADZUNA_APP_KEY = process.env.ADZUNA_APP_KEY!;
    const ADZUNA_COUNTRY = "us";

    const { keyword = "", location = "", page = 1 } = req.body;

    const includeKeywords = [
      "product manager",
      "software engineer",
      "data scientist",
      "data analyst",
      "developer",
      "business analyst",
      "product owner",
      "machine learning engineer",
      "ux designer",
    ];
    const excludeKeywords = [
      "cook",
      "customer support",
      "technician",
      "cashier",
      "driver",
      "security",
    ];

    function isValidJobTitle(title: string): boolean {
      const lowerTitle = title.toLowerCase();
      if (excludeKeywords.some((kw) => lowerTitle.includes(kw))) return false;
      return includeKeywords.some((kw) => lowerTitle.includes(kw));
    }

    const adzunaUrl = `https://api.adzuna.com/v1/api/jobs/${ADZUNA_COUNTRY}/search/${page}?app_id=${ADZUNA_APP_ID}&app_key=${ADZUNA_APP_KEY}&results_per_page=50&max_days_old=30&content-type=application/json${keyword ? `&what=${encodeURIComponent(keyword)}` : ""}${location ? `&where=${encodeURIComponent(location)}` : ""}`;

    const response = await axios.get(adzunaUrl);
    const jobs = response.data.results;

    let insertedCount = 0;

    for (const job of jobs) {
      if (!job.title || !isValidJobTitle(job.title)) continue;

      const existing = await query(
        "SELECT id FROM jobs WHERE title = $1 AND company = $2 AND location = $3",
        [job.title, job.company?.display_name || null, job.location?.display_name || null]
      );
      if (existing.rows.length > 0) continue;

      const loc = job.location || {};
      const city = loc.area ? loc.area[1] || null : null;
      const state = loc.area ? loc.area[2] || null : null;
      const country = loc.area ? loc.area[0] || null : null;

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
          "entry_level",
          country,
          state,
          city,
        ]
      );

      insertedCount++;
    }

    res.json({ success: true, inserted: insertedCount });
  })
);

export default router;
