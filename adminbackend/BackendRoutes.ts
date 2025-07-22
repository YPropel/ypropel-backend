import express, { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import axios from "axios";
import { query } from "../db";
import { google } from "googleapis";



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
    // ... existing Adzuna import code ...
    // (omitted here for brevity, unchanged from your original)
  })
);

// ----------------- CAREERJET IMPORT -------------------
router.post(
  "/import-careerjet-jobs",
  adminOnly,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    // ... existing Careerjet import code ...
    // (omitted here for brevity, unchanged from your original)
  })
);

//-----------------

// New route: fetch emails from Gmail API for admin use
// New route: fetch emails from Gmail API for admin use

// Define interface for email data with payload as any
interface EmailData {
  id: string;
  snippet?: string | null;
  payload?: any; // changed from gmail_v1.Schema$MessagePart to any
  internalDate?: string | null;
  threadId?: string;
}

router.post(
  "/fetch-gmail-emails",
  authenticateToken,
  adminOnly,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { accessToken } = req.body;

    if (!accessToken) {
      return res.status(400).json({ error: "accessToken is required in request body" });
    }

    try {
      // Initialize OAuth2 client with access token
      const oauth2Client = new google.auth.OAuth2();
      oauth2Client.setCredentials({ access_token: accessToken });

      const gmail = google.gmail({ version: "v1", auth: oauth2Client });

      // Fetch list of messages from Gmail inbox
      const listResponse = await gmail.users.messages.list({
        userId: "me",
        maxResults: 10, // adjust as needed
        q: "label:INBOX", // search query if needed
      });

      const messages = listResponse.data.messages || [];

      const emailData: EmailData[] = [];

      for (const message of messages) {
        const msg = await gmail.users.messages.get({
          userId: "me",
          id: message.id!,
          format: "full",
        });

        interface EmailData {
          id: string;
          snippet?: string | null;
          payload?: any;
          internalDate?: string | null;
          threadId?: string | null;  // <-- allow null here
        }

      }

      res.json({ emails: emailData });
    } catch (error) {
      console.error("Error fetching Gmail emails:", error);
      res.status(500).json({ error: "Failed to fetch Gmail emails" });
    }
  })
);



// ----------------- SIMPLYHIRED IMPORT -------------------
router.post(
  "/import-simplyhired-jobs",
  adminOnly,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    // ... existing SimplyHired import code ...
    // (omitted here for brevity, unchanged from your original)
  })
);

// ----- NEW: Import jobs from plain email text (simple example) -----

interface JobFromEmail {
  title: string;
  company: string;
  location: string;
  description: string;
  applyUrl: string;
}

function parseJobsFromEmailText(text: string): JobFromEmail[] {
  const jobs: JobFromEmail[] = [];
  const lines = text.split("\n");

  for (const line of lines) {
    const match = line.match(/Title:\s*(.+),\s*Company:\s*(.+),\s*Location:\s*(.+)/i);
    if (match) {
      jobs.push({
        title: match[1].trim(),
        company: match[2].trim(),
        location: match[3].trim(),
        description: "",
        applyUrl: "",
      });
    }
  }
  return jobs;
}

router.post(
  "/import-jobs-from-email",
  adminOnly,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { emailText } = req.body;
    if (!emailText) {
      return res.status(400).json({ error: "emailText is required in the body" });
    }

    const validCategories = await fetchJobCategories();
    const jobsToImport = parseJobsFromEmailText(emailText);

    let insertedCount = 0;

    for (const job of jobsToImport) {
      const existing = await query(
        "SELECT id FROM jobs WHERE title = $1 AND company = $2 AND location = $3",
        [job.title, job.company, job.location]
      );

      if (existing.rows.length > 0) {
        continue;
      }

      const inferredCategoryRaw = inferCategoryFromTitle(job.title);
      const inferredCategory = mapCategoryToValid(inferredCategoryRaw, validCategories);

      try {
        await query(
          `INSERT INTO jobs (
            title, description, category, company, location,
            apply_url, posted_at, is_active, job_type, country, state, city
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            job.title,
            job.description,
            inferredCategory,
            job.company,
            job.location,
            job.applyUrl,
            new Date(),
            true,
            "email_import",
            "United States",
            null,
            null,
          ]
        );
        insertedCount++;
      } catch (error) {
        console.error(`Error inserting job ${job.title}:`, error);
      }
    }

    res.json({ message: `Imported ${insertedCount} new jobs from email text.` });
  })
);

export default router;
