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

// Helper functions (inferCategoryFromTitle, mapCategoryToValid, fetchJobCategories) omitted for brevity
// asyncHandler, authenticateToken, adminOnly middlewares omitted for brevity

// Protect all routes below this middleware with authentication
router.use(authenticateToken);

// --------- GMAIL FETCH ROUTE WITH TOKEN REFRESH AND SAVE -----------

interface EmailData {
  id: string;
  snippet?: string | null;
  payload?: any; 
  internalDate?: string | null;
  threadId?: string | null;
}

router.post(
  "/fetch-gmail-emails",
  authenticateToken,
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

// Other routes omitted for brevity...

export default router;
