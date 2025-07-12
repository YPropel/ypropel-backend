//--- this file handles backend routes for import jobs the aggregator

import { Router, Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { query } from "../db";

const router = Router();

interface AuthRequest extends Request {
  user?: { userId: number; email?: string; isAdmin?: boolean };
}

// Middleware to catch async errors
function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) {
  return function (req: Request, res: Response, next: NextFunction) {
    fn(req, res, next).catch(next);
  };
}

// Middleware to authenticate JWT token
function authenticateToken(req: AuthRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers["authorization"];
  const token = authHeader?.split(" ")[1];

  if (!token) {
    console.log("⚠️ No token found in Authorization header");
    res.status(401).json({ error: "Unauthorized: No token provided" });
    return;
  }

  jwt.verify(token, process.env.JWT_SECRET || "your_jwt_secret_key", (err, decoded) => {
    if (err) {
      console.log("❌ JWT verification failed:", err.message);
      res.status(403).json({ error: "Forbidden: Invalid token" });
      return;
    }

    const payload = decoded as { userId: number; email?: string; is_admin?: boolean };

    req.user = {
      userId: payload.userId,
      email: payload.email,
      isAdmin: payload.is_admin || false,
    };

    next();
  });
}

// Middleware to restrict to admin only
function adminOnly(req: AuthRequest, res: Response, next: NextFunction): void {
  if (!req.user?.isAdmin) {
    res.status(403).json({ error: "Access denied. Admins only." });
    return;  // return void here
  }
  next();
}

// Example admin route to import entry-level jobs
router.post(
  "/import-entry-jobs",
  authenticateToken,
  adminOnly,
  asyncHandler(async (req: AuthRequest, res: Response) => {
    try {
      // Your import logic here, e.g., call Adzuna API and insert jobs into DB
      // Example dummy logic:
      const inserted = 42;

      // Respond with success
      res.json({ success: true, inserted });
    } catch (error) {
      console.error("Import failed", error);
      res.status(500).json({ success: false, error: "Import failed" });
    }
  })
);

export default router;
