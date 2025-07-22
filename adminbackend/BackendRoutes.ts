import express, { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import axios from "axios";
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
    "Connection": "keep-alive",
  },
});

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret_key";

interface AuthRequest extends Request {
  user?: { userId: number; email?: string; isAdmin?: boolean };
}

// Util function to convert unknown to string
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
function mapCategoryToValid(
  inferredCategory: string | null,
  validCategories: string[]
): string | null {
  if (!inferredCategory) return null;
  const match = validCategories.find(
    (cat) => cat.toLowerCase() === inferredCategory.toLowerCase()
  );
  return match || null;
}

// Fetch job categories from the database
async function fetchJobCategories(): Promise<string[]> {
  const result = await query("SELECT name FROM job_categories");
  return result.rows.map((row) => row.name);
}

// Async wrapper to catch errors in async route handlers
function asyncHandler(
  fn: (req: AuthRequest, res: Response, next: NextFunction) => Promise<any>
) {
  return function (req: AuthRequest, res: Response, next: NextFunction) {
    fn(req, res, next).catch(next);
  };
}

// Middleware: Verify JWT token and add user info to req.user
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

    const payload = user as {
      userId: number;
      email?: string;
      is_admin?: boolean;
    };

    req.user = {
      userId: payload.userId,
      email: payload.email,
      isAdmin: payload.is_admin || false,
    };

    next();
  });
}

// Middleware: Allow only admins to proceed
function adminOnly(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): void {
  if (!req.user?.isAdmin) {
    res.status(403).json({ error: "Access denied. Admins only." });
    return;
  }
  next();
}

// Protect all routes below this middleware with authentication
router.use(authenticateToken);

// --------- GMAIL FETCH ROUTE WITH TOKEN REFRESH AND SAVE -----------

interface EmailData {
  id: string;
  snippet?: string | null;
  payload?: any; // relaxed typing
  internalDate?: string | null;
  threadId?: string | null;
}

router.post(
  "/fetch-gmail-emails",
  adminOnly,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    try {
      const tokenPath = path.join(__dirname, "token.json");
      if (!fs.existsSync(tokenPath)) {
        return res.status(500).json({ error: "No saved Google OAuth token found." });
      }

      let tokens = JSON.parse(fs.readFileSync(tokenPath, "utf-8"));

      const oauth2Client = new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        process.env.GOOGLE_REDIRECT_URI
      );
      oauth2Client.setCredentials(tokens);

      // Refresh token if needed and save new tokens
      oauth2Client.on("tokens", (newTokens) => {
        if (newTokens.refresh_token) {
          tokens.refresh_token = newTokens.refresh_token;
        }
        if (newTokens.access_token) {
          tokens.access_token = newTokens.access_token;
          tokens.expiry_date = newTokens.expiry_date;
        }
        fs.writeFileSync(tokenPath, JSON.stringify(tokens, null, 2));
      });

      // Force a token refresh to trigger 'tokens' event if expired
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

// Other routes here...

export default router;
