import express, { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import axios from "axios";
import cheerio from "cheerio";
import { query } from "../db";
import { google } from "googleapis";



import fs from "fs";
import path from "path";

import Parser from "rss-parser";

const parser = new Parser({
  headers: {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; x64)...",
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
    // Your existing Adzuna import code here
  })
);

// ----------------- CAREERJET IMPORT -------------------
router.post(
  "/import-careerjet-jobs",
  adminOnly,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    // Your existing Careerjet import code here
  })
);

// ----------------- SIMPLYHIRED IMPORT -------------------
router.post(
  "/import-simplyhired-jobs",
  adminOnly,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    // Your existing SimplyHired import code here
  })
);

// ----------------- REDDIT IMPORT -------------------
router.post(
  "/import-reddit-internships",
  adminOnly,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    // Your existing Reddit import code here
  })
);

// ----------------- REMOTIVE IMPORT -------------------
router.post(
  "/import-remotive-internships",
  adminOnly,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    // Your existing Remotive import code here
  })
);

// ----------------- LINKEDIN NEWSLETTER IMPORT -------------------
router.post(
  "/import-linkedin-newsletter",
  adminOnly,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { emailHtml } = req.body;
    if (!emailHtml) {
      return res.status(400).json({ error: "emailHtml is required in the body" });
    }

    const validCategories = await fetchJobCategories();
    let insertedCount = 0;

    try {
      const cheerio = (await import("cheerio")).default;
      const $ = cheerio.load(emailHtml);

      const links = $("a").toArray();

      for (const elem of links) {
        const link = $(elem).attr("href") || "";
        const title = $(elem).text().trim();

        if (!title || !link) continue;

        const existing = await query(
          "SELECT id FROM jobs WHERE title = $1 OR apply_url = $2",
          [title, link]
        );
        if (existing.rows.length > 0) continue;

        const inferredCategoryRaw = inferCategoryFromTitle(title);
        const inferredCategory = mapCategoryToValid(inferredCategoryRaw, validCategories);

        await query(
          `INSERT INTO jobs (
            title, description, category, company, location,
            apply_url, posted_at, is_active, job_type, country, state, city
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            title,
            "", // No description available from simple parsing
            inferredCategory,
            "LinkedIn Newsletter",
            "LinkedIn Newsletter",
            link,
            new Date(),
            true,
            "newsletter",
            "United States",
            null,
            null,
          ]
        );
        insertedCount++;
      }

      res.json({ message: `Imported ${insertedCount} new jobs from LinkedIn newsletter.` });
    } catch (error) {
      console.error("Error importing LinkedIn newsletter jobs:", error);
      res.status(500).json({ error: "Failed to import LinkedIn newsletter jobs" });
    }
  })
);

// --------- GMAIL FETCH ROUTE WITH TOKEN REFRESH AND SAVE -----------

interface EmailData {
  id: string;
  snippet?: string | null;
  payload?: any; 
  internalDate?: string | null;
  threadId?: string | null;
}

console.log("Registering /fetch-gmail-emails route");
router.post(
  "/fetch-gmail-emails",
  authenticateToken,
  adminOnly,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    try {
      const tokenJsonStr = process.env.GOOGLE_OAUTH_TOKEN_JSON;
      if (!tokenJsonStr) {
        return res.status(500).json({ error: "No Google OAuth token found in environment variables." });
      }

      let tokens;
      try {
        tokens = JSON.parse(tokenJsonStr);
      } catch (e) {
        console.error("Failed to parse GOOGLE_OAUTH_TOKEN_JSON:", e);
        return res.status(500).json({ error: "Invalid Google OAuth token JSON format." });
      }

      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
      );
      oauth2Client.setCredentials(tokens);

      // Setup token refresh event to update tokens in env (optional)
      oauth2Client.on("tokens", (newTokens) => {
        if (newTokens.refresh_token) {
          tokens.refresh_token = newTokens.refresh_token;
        }
        if (newTokens.access_token) {
          tokens.access_token = newTokens.access_token;
          tokens.expiry_date = newTokens.expiry_date;
          // Note: To persist updated tokens, you'd need to save them somewhere (file, DB, or env)
          // but environment variables usually can't be updated at runtime.
          console.log("New access token refreshed.");
        }
      });

      // Force refresh token to update access token if expired
      await oauth2Client.getAccessToken();

      const gmail = google.gmail({ version: "v1", auth: oauth2Client });

      const listResponse = await gmail.users.messages.list({
        userId: "me",
        maxResults: 10,
        q: "label:INBOX",
      });

      const messages = listResponse.data.messages || [];
      const emailData: EmailData[] = [];

      for (const message of messages) {
        const msg = await gmail.users.messages.get({
          userId: "me",
          id: message.id!,
          format: "full",
        });

        emailData.push({
          id: message.id!,
          snippet: msg.data.snippet,
          payload: msg.data.payload,
          internalDate: msg.data.internalDate || null,
          threadId: msg.data.threadId || null,
        });
      }

      res.json({ emails: emailData });
    } catch (error) {
      console.error("Error fetching Gmail emails:", error);
      res.status(500).json({ error: "Failed to fetch Gmail emails" });
    }
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

// New route to import LinkedIn jobs from "See all jobs" page URL or from emailHtml
router.post(
  "/import-linkedin-detailed-jobs",
  adminOnly,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    const { emailHtml, seeAllJobsUrl } = req.body;

    let urlToFetch = seeAllJobsUrl;

    // If only emailHtml is provided, try to extract "See all jobs" link from it
    if (!urlToFetch && emailHtml) {
      const $email = cheerio.load(emailHtml);
      const link = $email("a:contains('See all jobs')").attr("href");
      if (!link) {
        return res.status(400).json({ error: "Could not find 'See all jobs' link in email HTML" });
      }
      urlToFetch = link;
    }

    if (!urlToFetch) {
      return res.status(400).json({ error: "No 'See all jobs' URL provided or found" });
    }

    // Fetch LinkedIn jobs page HTML
    const response = await axios.get(urlToFetch, {
      headers: {
        // Mimic a browser user agent
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
        // Add any LinkedIn cookies or auth headers here if needed to access the page
      },
    });

    const $ = cheerio.load(response.data);

    const validCategories = await fetchJobCategories();

    const jobs: Array<{
      title: string;
      company: string;
      location: string;
      description: string;
      applyUrl: string;
    }> = [];

    // NOTE: LinkedIn DOM structure can change frequently. Adjust selectors accordingly.

    $(".jobs-search-results__list-item").each((_, elem) => {
      const el = $(elem);

      // Job title
      const title = el.find("a.job-card-list__title, a.base-card__full-link").text().trim();

      // Company name
      const company = el.find("a.job-card-container__company-name, h4.base-search-card__subtitle").text().trim();

      // Location
      const location = el.find(".job-card-container__metadata-item, span.job-search-card__location").text().trim();

      // Apply URL
      const applyUrl = el.find("a.job-card-list__title, a.base-card__full-link").attr("href") || "";

      // Description snippet (LinkedIn usually does not have full description on listing page)
      const description = el.find(".job-card-list__snippet, p.job-snippet, div.job-card-container__description").text().trim() || "";

      if (title && applyUrl) {
        jobs.push({ title, company, location, description, applyUrl });
      }
    });

    // Insert into DB if not duplicate
    let insertedCount = 0;
    for (const job of jobs) {
      // Check for existing job by title + applyUrl
      const exists = await query(
        "SELECT id FROM jobs WHERE title = $1 AND apply_url = $2",
        [job.title, job.applyUrl]
      );
      if (exists.rows.length > 0) continue;

      const inferredCategoryRaw = inferCategoryFromTitle(job.title);
      const inferredCategory = mapCategoryToValid(inferredCategoryRaw, validCategories);

      await query(
        `INSERT INTO jobs (
          title, description, category, company, location,
          apply_url, posted_at, is_active, job_type, country, state, city
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          job.title,
          job.description,
          inferredCategory,
          job.company || "LinkedIn",
          job.location || "Unknown",
          job.applyUrl,
          new Date(),
          true,
          "linkedin_detailed",
          "United States",
          null,
          null,
        ]
      );
      insertedCount++;
    }

    res.json({ message: `Imported ${insertedCount} new detailed jobs from LinkedIn.` });
  })
);



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
