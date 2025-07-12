//--- this file handles backend routes for import jobs the aggregator

import { Router } from "express";
import { authenticateToken, adminOnly, AuthRequest } from "../middleware/auth";
import { Response } from "express";
// import your DB helper and any other utilities
import { query } from "../db";

const router = Router();

// Example admin route to import entry-level jobs
router.post(
  "/import-entry-jobs",
  authenticateToken,
  adminOnly,
  async (req: AuthRequest, res: Response) => {
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
  }
);

export default router;
