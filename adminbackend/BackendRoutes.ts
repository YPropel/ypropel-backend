import express, { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import axios from "axios";
import { query } from "../db";

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret_key";

interface AuthRequest extends Request {
  user?: { userId: number; email?: string; isAdmin?: boolean };
}

function asyncHandler(
  fn: (req: AuthRequest, res: Response, next: NextFunction) => Promise<any>
) {
  return function (req: AuthRequest, res: Response, next: NextFunction) {
    fn(req, res, next).catch(next);
  };
}

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

function adminOnly(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user?.isAdmin) {
    res.status(403).json({ error: "Access denied. Admins only." });
    return;
  }
  next();
}

router.use(authenticateToken);

router.post(
  "/import-careerjet-jobs",
  adminOnly,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    try {
      const affiliateId = process.env.CAREERJET_AFFID;
      if (!affiliateId) {
        return res.status(500).json({ error: "Careerjet affiliate ID not configured" });
      }

      const { keyword = "", location = "", page = 1 } = req.body;

      // Get user IP and user agent from incoming request headers (fallbacks)
      const user_ip =
        (req.headers["x-forwarded-for"] as string)?.split(",")[0] ||
        req.socket.remoteAddress ||
        "";
      const user_agent = req.headers["user-agent"] || "";

      if (!user_ip || !user_agent) {
        return res.status(400).json({ error: "Missing user_ip or user_agent in request" });
      }

      const careerjetUrl = `http://public.api.careerjet.net/search?affid=${affiliateId}&keywords=${encodeURIComponent(
        keyword
      )}&location=${encodeURIComponent(location)}&pagesize=50&pagenumber=${page}&sort=relevance&user_ip=${encodeURIComponent(
        user_ip
      )}&user_agent=${encodeURIComponent(user_agent)}`;

      console.log(`Fetching Careerjet page ${page}...`);

      const response = await axios.get(careerjetUrl);

      const data = response.data;

      if (data.type === "ERROR") {
        console.error("Careerjet API error:", data.error);
        return res.status(500).json({ error: `Careerjet API error: ${data.error}` });
      }

      if (data.type !== "JOBS" || !Array.isArray(data.jobs)) {
        return res.status(500).json({ error: "Invalid Careerjet response format" });
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
      ];

      function isValidJobTitle(title: string): boolean {
        const lowerTitle = title.toLowerCase();
        return !excludeKeywords.some((kw) => lowerTitle.includes(kw));
      }

      let insertedCount = 0;

      for (const job of data.jobs) {
        if (!job.title || !isValidJobTitle(job.title)) {
          console.log(`Skipped job due to excluded title: ${job.title}`);
          continue;
        }

        // Avoid duplicates by checking title, company, location
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
              title, description, company, location,
              apply_url, posted_at, is_active, job_type
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [
              job.title,
              job.description || null,
              job.company || null,
              job.locations || null,
              job.url || null,
              job.date ? new Date(job.date) : null,
              true,
              "entry_level", // or change dynamically if you want
            ]
          );
          insertedCount++;
          console.log(`Inserted job: ${job.title}`);
        } catch (err) {
          console.error(`Error inserting job ${job.title}:`, err);
        }
      }

      console.log(`Careerjet import completed. Total inserted jobs: ${insertedCount}`);

      res.json({ success: true, inserted: insertedCount });
    } catch (error) {
      console.error("Careerjet import failed:", error);
      res.status(500).json({ error: "Careerjet import failed. See server logs for details." });
    }
  })
);

export default router;
