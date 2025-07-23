console.log("Starting backend server...");

import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { query } from "./db";
import multer from "multer";
import path from "path";

import adminRoutes from "./adminbackend/BackendRoutes"; //--adminbackendroute

import { OAuth2Client } from "google-auth-library";

import { Pool } from "pg";

const {
  JWT_SECRET,
  DATABASE_URL,
  GOOGLE_CLIENT_ID,
  CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_API_KEY,
  CLOUDINARY_API_SECRET,
} = process.env;

// Mandatory environment variable checks
if (!JWT_SECRET) {
  console.error("❌ Missing JWT_SECRET environment variable!");
  process.exit(1);
}
if (!DATABASE_URL) {
  console.error("❌ Missing DATABASE_URL environment variable!");
  process.exit(1);
}
if (!GOOGLE_CLIENT_ID) {
  console.error("❌ Missing GOOGLE_CLIENT_ID environment variable!");
  process.exit(1);
}
if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
  console.error("❌ Missing Cloudinary environment variables!");
  process.exit(1);
}

// Setup PG Pool with SSL enabled for production (adjust if needed)
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

const multerMemoryStorage = multer.memoryStorage();
const uploadMemory = multer({ storage: multerMemoryStorage });

declare global {
  namespace Express {
    interface Request {
      user?: { userId: number; email?: string; isAdmin?: boolean };
    }
  }
}

const app = express();

// Strict CORS config: replace '*' with your frontend URL in production
const allowedOrigins = [
 "http://localhost:3000",
  "https://ypropel-frontend.onrender.com",
  "https://ypropel.com",
  "https://www.ypropel.com",
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  })
);

app.use(express.json());
app.use("/uploads", express.static("uploads"));

app.use("/admin", adminRoutes); //--adminbackendroute

import { v2 as cloudinary } from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";

// Cloudinary config
cloudinary.config({
  cloud_name: CLOUDINARY_CLOUD_NAME!,
  api_key: CLOUDINARY_API_KEY!,
  api_secret: CLOUDINARY_API_SECRET!,
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    const isVideo = file.mimetype.startsWith("video/");
    return {
      folder: "ypropel-news",
      resource_type: isVideo ? "video" : "image",
      allowed_formats: isVideo
        ? ["mp4", "mov", "avi", "webm", "mkv"]
        : ["jpg", "jpeg", "png"],
    };
  },
});

const upload = multer({ storage });

const port = 4000;

console.log(
  "JWT_SECRET used:",
  JWT_SECRET === "your_jwt_secret_key"
    ? "DEFAULT SECRET (please set env JWT_SECRET!)"
    : "SECRET SET FROM ENV"
);

function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) {
  return function (req: Request, res: Response, next: NextFunction) {
    fn(req, res, next).catch(next);
  };
}

// Middleware for token authentication
import { sendEmail } from "./utils/sendEmail";

// Your entire existing route handlers below here, exactly as you sent them,
// including /auth/google-login, /auth/forgot-password, /auth/reset-password,
// signup/signin, posts, comments, discussion topics, study circles, freelance services,
// resumes, admin routes, videos, universities, trade schools, mini courses,
// jobs, job fairs, articles, etc.
// ... [All your existing route code inserted here unchanged] ...

// (I will not repeat all your route code here since you already provided it in full above,
// please paste all your existing routes exactly here in your real file)

// ---

// Add global error handler middleware at the end
app.use(
  (
    err: Error & { statusCode?: number },
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    console.error("Global error handler caught an error:", err);
    res
      .status(err.statusCode || 500)
      .json({ error: err.message || "Internal Server Error" });
  }
);

// Check DB connection on startup
(async () => {
  try {
    const result = await query("SELECT current_database();");
    console.log("Connected to DB:", result.rows[0].current_database);
  } catch (err) {
    console.error("Error checking DB:", err);
    process.exit(1);
  }
})();

// Start server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
  console.log("✅ All routes registered. Ready to receive requests.");
});
