import express from "express";
import jwt from "jsonwebtoken";
import { query } from "../db";

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret_key";

router.delete("/news/:id", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    const decoded: any = jwt.verify(token, JWT_SECRET);
    if (!decoded.is_admin) {
      return res.status(403).json({ error: "Access denied. Admins only." });
    }

    const newsId = parseInt(req.params.id);
    if (isNaN(newsId)) {
      return res.status(400).json({ error: "Invalid news ID" });
    }

    await query("DELETE FROM news WHERE id = $1", [newsId]);
    res.json({ message: "News item deleted successfully" });
  } catch (err) {
    console.error("Error deleting news:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
