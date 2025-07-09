import express, { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { query } from "../db";

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret_key";

// Async wrapper to catch errors and forward them to Express error handler
function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) {
  return function (req: Request, res: Response, next: NextFunction) {
    fn(req, res, next).catch(next);
  };
}

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

router.delete(
  "/news/:id",
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user?.isAdmin) {
      return res.status(403).json({ error: "Access denied. Admins only." });
    }

    const newsId = parseInt(req.params.id);
    if (isNaN(newsId)) {
      return res.status(400).json({ error: "Invalid news ID" });
    }

    await query("DELETE FROM news WHERE id = $1", [newsId]);
    res.json({ message: "News item deleted successfully" });
  })
);

export default router;
