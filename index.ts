console.log("Starting backend server...");

import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { query } from "./db";
// ======= Admin: Import Indeed CSV -> jobs =======
import multer from "multer";
import crypto from "crypto";
import { parse } from "csv-parse/sync";
//import { parse as csvParse } from "csv-parse/sync";
import { parse as parseCsv } from "csv-parse/sync";



import path from "path";
import adminRoutes from "./adminbackend/BackendRoutes"; //--adminbackendroute
import { OAuth2Client } from "google-auth-library";
import { Pool } from "pg";
import rateLimit from "express-rate-limit";
import Stripe from "stripe";

//  Email Notifications

import { verifyUnsubscribeToken } from "./utils/unsubscribeTokens";
import { wrapWithUnsubscribe } from "./src/emailTemplates";





// Define the rate limiter middleware
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 2000, // allow 2000 requests per IP per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: "Too many requests from this IP, please try again later.",
});

//-----------------------

// index.ts or stripe setup file

// @ts-ignore - Allow Stripe to use a newer API version than TypeScript definitions
//const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  //apiVersion: "2022-11-15",
//});
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2025-07-30.basil'  // Use the exact API version you want
});


//-----------------

const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // or your config
  // other config options if needed
});

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// --- CORS setup with correct origins whitelist ---
const allowedOrigins = [
  "https://ypropel-frontend.onrender.com",
  "https://www.ypropel.com",
];

const corsOptions = {
  origin: function (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  credentials: true,
};

const app = express();

app.use(cors(corsOptions));
//app.use(express.json());

app.use((req, res, next) => {
 const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  console.log(`${req.method} ${fullUrl}`);
  if (req.originalUrl === "/webhooks/stripe") {
    next(); // Skip JSON parsing for Stripe webhook
  } else {
    express.json()(req, res, next); // Parse JSON for all other routes
  }
  
});


app.use("/admin", adminRoutes); //--adminbackendroute

import { v2 as cloudinary } from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";

// Cloudinary configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME!,
  api_key: process.env.CLOUDINARY_API_KEY!,
  api_secret: process.env.CLOUDINARY_API_SECRET!,
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    const isVideo = file.mimetype.startsWith("video/");
    return {
      folder: "ypropel-news",
      resource_type: isVideo ? "video" : "image",
      allowed_formats: isVideo ? ["mp4", "mov", "avi", "webm", "mkv"] : ["jpg", "jpeg", "png"],
    };
  },
});
//----- cloud storage for ocmpanies logos
const companyLogoStorage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => ({
    folder: "company-logos",
    resource_type: "image",
    allowed_formats: ["jpg", "jpeg", "png"],
  }),
});

const uploadCompanyLogo = multer({ storage: companyLogoStorage });
//------

const upload = multer({ storage });
const multerMemoryStorage = multer.memoryStorage();
const uploadMemory = multer({ storage: multerMemoryStorage });

declare global {
  namespace Express {
    interface Request {
      user?: { userId: number; email?: string; isAdmin?: boolean };
    }
  }
}

const port = 4000;
const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret_key";

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

class AuthError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number = 401) {
    super(message);
    this.statusCode = statusCode;
  }
}


//------Middleware authenticate
function authenticateToken(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers["authorization"];
  const token = authHeader?.split(" ")[1];

  if (!token) {
    return next(new AuthError("No token provided", 401));
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return next(new AuthError("Invalid or expired token", 403));
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
//----------------------------------
// Import sendEmail utility here
import { sendEmail } from "./utils/sendEmail";

app.use(limiter);

//-------------------------------
function optionalAuthenticateToken(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers["authorization"];
  const token = authHeader?.split(" ")[1];
  if (!token) return next();

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (!err && decoded) {
      const payload = decoded as { userId: number; email?: string; is_admin?: boolean };
      req.user = {
        userId: payload.userId,
        email: payload.email,
        isAdmin: payload.is_admin || false,
      };
    }
    next();
  });
}

app.use(optionalAuthenticateToken);  // <-- here, early middleware


app.use(async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (req.method !== "GET") {
      return next();
    }

    const userId = req.user?.userId || null;
    const visitDate = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const pageUrl = req.originalUrl || req.url;

    // Skip logging for admin users
    if (req.user?.isAdmin) {
      return next();
    }

    // Get visitor IP (handle proxy headers and fallback)
    const ipAddress =
      (req.headers['x-forwarded-for'] as string)?.split(',')[0].trim() ||
      req.socket.remoteAddress ||
      null;

    // Check if visit already logged for this user or IP, page, and date
    // For logged-in users: check by user_id
    // For guests: check by ip_address
    const existsResult = userId
      ? await query(
          `SELECT 1 FROM visitors WHERE user_id = $1 AND visit_date = $2 AND page_url = $3 LIMIT 1`,
          [userId, visitDate, pageUrl]
        )
      : ipAddress
      ? await query(
          `SELECT 1 FROM visitors WHERE ip_address = $1 AND visit_date = $2 AND page_url = $3 LIMIT 1`,
          [ipAddress, visitDate, pageUrl]
        )
      : null;

    if (!existsResult || existsResult.rowCount === 0) {
      await query(
        `INSERT INTO visitors (user_id, visit_date, page_url, ip_address) VALUES ($1, $2, $3, $4)`,
        [userId, visitDate, pageUrl, ipAddress]
      );
    }

    next();
  } catch (error) {
    console.error("Error logging visitor:", error);
    next();
  }
});



//================= Email Notifications and broadcast ===============/

app.get(
  "/unsubscribe",
  asyncHandler(async (req: Request, res: Response) => {
    const token = req.query.token as string | undefined;
    if (!token) return res.status(400).send("Missing unsubscribe token.");

    try {
      const { userId } = verifyUnsubscribeToken(token);

      await query(
        `INSERT INTO email_preferences (user_id, marketing_emails_enabled)
         VALUES ($1, FALSE)
         ON CONFLICT (user_id)
         DO UPDATE SET marketing_emails_enabled = FALSE, updated_at = NOW()`,
        [userId]
      );

      res.send(`
        <html>
          <body style="font-family: system-ui, sans-serif; text-align:center; padding:40px;">
            <h2>You have been unsubscribed</h2>
            <p>You will no longer receive marketing emails from YPropel.</p>
          </body>
        </html>
      `);
    } catch (err) {
      console.error("Unsubscribe error:", err);
      res.status(400).send("Invalid or expired unsubscribe link.");
    }
  })
);


// ------- ADMIN EMAIL BROADCAST --------------------
app.post(
  "/admin/email/broadcast",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user?.isAdmin) {
      return res.status(403).json({ error: "Admins only" });
    }

    const { subject, htmlBody } = req.body;

    if (!subject || !htmlBody) {
      return res.status(400).json({ error: "subject and htmlBody required" });
    }

    // Get all users who have not unsubscribed
   const { rows: users } = await query(
  `SELECT u.id, u.email, u.name
   FROM users u
   LEFT JOIN email_preferences p ON p.user_id = u.id
   WHERE COALESCE(p.marketing_emails_enabled, TRUE) = TRUE
     AND u.email IS NOT NULL
     AND u.email = 'rania.a.omar@gmail.com'`  
);

    let sent = 0;
    let failed = 0;

    for (const user of users) {
      try {
        const finalHtml = wrapWithUnsubscribe(user.id, htmlBody);

        await sendEmail(user.email, subject, finalHtml);

        // Log email
        await query(
          `INSERT INTO email_log (user_id, email, subject, template_name)
           VALUES ($1, $2, $3, $4)`,
          [user.id, user.email, subject, "admin_broadcast"]
        );

        sent++;
      } catch (error) {
        console.error(`Failed to send to ${user.email}`, error);
        failed++;
      }
    }

    res.json({
      success: true,
      sent,
      failed,
      total: users.length,
    });
  })
);
//------- Users Emails notificaitons and email handling based on user preference
// Track job interest when a logged-in user views/clicks a job
app.post(
  "/jobs/:id/interest",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user!.userId;
    const jobId = parseInt(req.params.id, 10);

    if (isNaN(jobId)) {
      return res.status(400).json({ error: "Invalid job id" });
    }

    // Get job_type and category from jobs table
    const jobRes = await query(
      "SELECT job_type, category FROM jobs WHERE id = $1",
      [jobId]
    );

    if (jobRes.rows.length === 0) {
      return res.status(404).json({ error: "Job not found" });
    }

    const { job_type, category } = jobRes.rows[0];

    // Insert interest (ignore if already exists)
    await query(
      `INSERT INTO job_interest_events (user_id, job_id, job_type, category)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, job_id) DO NOTHING`,
      [userId, jobId, job_type, category]
    );

    res.json({ success: true });
  })
);
//--------------------------------------

//===================== End of emails notification and broadcast =============

// ===================
// Begin your full original route handlers here exactly as you sent them:

// --- Google OAuth login
app.post(
  "/auth/google-login",
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const { tokenId } = req.body;
      if (!tokenId) {
        return res.status(400).json({ error: "tokenId is required" });
      }

      const ticket = await googleClient.verifyIdToken({
        idToken: tokenId,
        audience: process.env.GOOGLE_CLIENT_ID,
      });
      const payload = ticket.getPayload();
      if (!payload) {
        return res.status(401).json({ error: "Invalid Google token" });
      }

      const email = payload.email!;
      const name = payload.name!;
      const picture = payload.picture;

      // Check if user already exists
      const existingUserRes = await query("SELECT * FROM users WHERE email = $1", [email]);
      let user;
      if (existingUserRes.rows.length === 0) {
        // Create a dummy password hash for Google OAuth users
        const dummyPassword = "google_oauth_dummy_password_" + Date.now();
        const dummyPasswordHash = await bcrypt.hash(dummyPassword, 10);

        // Insert new user with dummy password hash to satisfy NOT NULL constraint
        const insertRes = await query(
          `INSERT INTO users (name, email, photo_url, password_hash, created_at, updated_at)
           VALUES ($1, $2, $3, $4, NOW(), NOW())
           RETURNING *`,
          [name, email, picture || null, dummyPasswordHash]
        );
        user = insertRes.rows[0];
      } else {
        user = existingUserRes.rows[0];
      }

      // Sign JWT token
      const token = jwt.sign(
        { userId: user.id, email: user.email, is_admin: user.is_admin || false },
        JWT_SECRET,
        { expiresIn: "7d" }
      );

      res.json({ user, token, isNewUser: existingUserRes.rows.length === 0 });
    } catch (error) {
      console.error("Error in /auth/google-login:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  })
);

// --- Forgot password
app.post(
  "/auth/forgot-password",
  asyncHandler(async (req: Request, res: Response) => {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const result = await query("SELECT * FROM users WHERE email = $1", [email]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "No account found with this email" });
    }

    const user = result.rows[0];
    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        is_admin: user.is_admin,
      },
      JWT_SECRET,
      { expiresIn: "1h" }
    );

    const resetLink = `http://localhost:3000/reset-password?token=${token}`;

    await sendEmail(
      email,
      "Reset your YPropel password",
      `<p>You requested a password reset.</p><p><a href="${resetLink}">Click here to reset your password</a></p>`
    );

    res.json({ message: "Password reset email sent" });
  })
);

// --- Reset password
app.post(
  "/auth/reset-password",
  asyncHandler(async (req: Request, res: Response) => {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ error: "Token and new password are required" });
    }

    try {
      const decoded = jwt.verify(token, JWT_SECRET) as { userId: number };
      const hashedPassword = await bcrypt.hash(newPassword, 10);

      await query("UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2", [
        hashedPassword,
        decoded.userId,
      ]);

      res.json({ message: "Password has been reset successfully." });
    } catch (err) {
      console.error("Invalid or expired reset token", err);
      res.status(400).json({ error: "Invalid or expired reset token." });
    }
  })
);

// --- Signup
const defaultProfilePhotos = [
  "https://res.cloudinary.com/denggbgma/image/upload/v<version>/ypropel-users/default-profile1.png",
];

async function signupHandler(req: Request, res: Response) {
  const {
    name,
    email,
    password,
    title,
    university,
    major,
    experience_level,
    skills,
    company,
    courses_completed,
    country,
    birthdate,
    volunteering_work,
    projects_completed,
    photo_url,
  } = req.body;

  if (!name || !email || !password) {
    return res.status(400).json({ error: "Name, email, and password are required" });
  }

  let photoUrlToUse = photo_url;
  if (!photoUrlToUse || photoUrlToUse.trim() === "") {
    photoUrlToUse =
      defaultProfilePhotos[Math.floor(Math.random() * defaultProfilePhotos.length)];
  }

  try {
    const existingUser = await query("SELECT * FROM users WHERE email = $1", [email]);
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: "Email already registered" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await query(
      `INSERT INTO users 
      (name, email, password_hash, title, university, major, experience_level, skills, company, courses_completed, country, birthdate, volunteering_work, projects_completed, photo_url, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15, NOW(), NOW())
      RETURNING id, name, email, title, university, major, experience_level, skills, company, courses_completed, country, birthdate, volunteering_work, projects_completed, photo_url`,
      [
        name,
        email,
        hashedPassword,
        title || null,
        university || null,
        major || null,
        experience_level || null,
        skills || null,
        company || null,
        courses_completed || null,
        country || null,
        birthdate || null,
        volunteering_work || null,
        projects_completed || null,
        photoUrlToUse,
      ]
    );

    const user = result.rows[0];

    const token = jwt.sign({ userId: user.id, email: user.email }, JWT_SECRET, {
      expiresIn: "7d",
    });

    res.status(201).json({ user, token });
  } catch (error) {
    console.error("Error signing up user:", error);
    res.status(500).json({ error: (error as Error).message || "Unknown error" });
  }
}

// --- Signin
async function signinHandler(req: Request, res: Response) {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  try {
    const result = await query("SELECT * FROM users WHERE email = $1", [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const user = result.rows[0];

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        is_admin: user.is_admin,
      },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    const { password_hash, ...userData } = user;
    res.json({ user: userData, token });
  } catch (error) {
    console.error("Error signing in user:", error);
    res.status(500).json({ error: (error as Error).message || "Unknown error" });
  }
}

// --- Register signup and signin routes
app.post("/auth/signup", asyncHandler(signupHandler));
app.post("/auth/signin", asyncHandler(signinHandler));

//----------------------Routes---------------------------
// -------- Protected route to get current user's profile ---------


app.get(
  "/users/me",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
   
    
    const userId = req.user?.userId;
    //console.log("Decoded user ID in middleware:", userId);
if (!userId) return res.status(401).json({ error: "Unauthorized" });


   const result = await query(
  `SELECT id, name, email, title, university, major, experience_level, skills, company,
       courses_completed, country, birthdate, volunteering_work, projects_completed, photo_url,
       is_premium, is_company_premium, subscription_id
   FROM users    WHERE id = $1`,
  [userId]
);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json(result.rows[0]);
  })
);

// -------- Protected route to get all users ---------
app.get(
  "/users",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    const result = await query(
      `SELECT id, name, email, title, university, major, experience_level, skills, company,
        courses_completed, country, birthdate, volunteering_work, projects_completed, photo_url
      FROM users`
    );
    res.json(result.rows);
  })
);


// -------- Posts Routes ---------

// GET all posts with author info, followed, liked flags, and comments
app.get(
  "/posts",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {

    
    const userId = req.user?.userId;
if (!userId) return res.status(401).json({ error: "Unauthorized" });


    // Get all posts with author info
   const postsResult = await query(
  `SELECT p.id, p.user_id AS author_id, u.name AS author_name, p.content, p.image_url, p.video_url, p.created_at
   FROM posts p
   JOIN users u ON p.user_id = u.id
   ORDER BY p.created_at DESC`
);


    // Get list of post IDs the user follows
    const followsResult = await query(`SELECT post_id FROM post_follows WHERE user_id = $1`, [userId]);
    const followedPostIds = new Set(followsResult.rows.map((row) => row.post_id));

    // Get list of post IDs the user liked
    const likesResult = await query(`SELECT post_id FROM post_likes WHERE user_id = $1`, [userId]);
    const likedPostIds = new Set(likesResult.rows.map((row) => row.post_id));

    // Get comments for all posts in one query
    const postIds = postsResult.rows.map((post) => post.id);
    let commentsResult = { rows: [] as any[] };
    if (postIds.length > 0) {
      commentsResult = await query(
        `SELECT c.id, c.post_id, c.user_id, u.name AS user_name, c.content, c.created_at
         FROM comments c
         JOIN users u ON c.user_id = u.id
         WHERE c.post_id = ANY($1)
         ORDER BY c.created_at ASC`,
        [postIds]
      );
    }

    // Group comments by post_id
    const commentsByPostId: { [key: number]: any[] } = {};
    commentsResult.rows.forEach((comment) => {
      if (!commentsByPostId[comment.post_id]) {
        commentsByPostId[comment.post_id] = [];
      }
      commentsByPostId[comment.post_id].push({
        id: comment.id,
        userId: comment.user_id,
        userName: comment.user_name,
        content: comment.content,
        createdAt: comment.created_at,
      });
    });

    // Map posts and add followed, liked, comments
    const postsWithExtras = postsResult.rows.map((post) => ({
      id: post.id,
      authorId: post.author_id,
      authorName: post.author_name,
      title: post.title,
      content: post.content,
      imageUrl: post.image_url,
        videoUrl: post.video_url,
      createdAt: post.created_at,
      followed: followedPostIds.has(post.id),
      liked: likedPostIds.has(post.id),
      comments: commentsByPostId[post.id] || [],
    }));

    res.json(postsWithExtras);
  })
);

// -----POST create a new post on home page----------


// POST create a new post
app.post(
  "/posts",
  authenticateToken,
  upload.fields([
    { name: "image", maxCount: 1 },
    { name: "video", maxCount: 1 },
  ]),
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const userId = req.user?.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const { content } = req.body;

      const files = req.files as { [fieldname: string]: Express.Multer.File[] };
      const imageFile = files?.image?.[0];
      const videoFile = files?.video?.[0];

      // Log files nicely
      //console.log("Image File:----->", JSON.stringify(imageFile, null, 2));
      //console.log("Video File:----->", JSON.stringify(videoFile, null, 2));

      const imageUrl = imageFile ? imageFile.path : null;
      const videoUrl = videoFile ? videoFile.path : null;

      if (!content && !imageFile && !videoFile) {
        console.error("⚠️ Post rejected: missing content and media.");
        return res.status(400).json({ error: "Post must contain content or media." });
      }

      const result = await query(
        `INSERT INTO posts (user_id, content, image_url, video_url, created_at)
         VALUES ($1, $2, $3, $4, NOW())
         RETURNING id, user_id AS authorId, content, image_url AS imageUrl, video_url AS videoUrl, created_at`,
        [userId, content || "", imageUrl, videoUrl]
      );

      //console.log("✅ Post inserted:", result.rows[0]);
      res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error("❌ Error inserting post:", error);
      res.status(500).json({ error: "Failed to create post" });
    }
  })
); 


//----- PUT update a post by ID (protected)
app.put(
  "/posts/:postId",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    const postId = parseInt(req.params.postId, 10);
    const {  content, imageUrl, videoUrl } = req.body;
 

    const userId = req.user?.userId;
if (!userId) return res.status(401).json({ error: "Unauthorized" });


    if (isNaN(postId)) {
      return res.status(400).json({ error: "Invalid post ID" });
    }
    if (!content && !imageUrl && !videoUrl) {
  return res.status(400).json({ error: "Post must contain content or media." });
}


    const resultCheck = await query("SELECT user_id FROM posts WHERE id = $1", [postId]);
    if (resultCheck.rows.length === 0) {
      return res.status(404).json({ error: "Post not found" });
    }
    if (resultCheck.rows[0].user_id !== userId) {
      return res.status(403).json({ error: "Forbidden: You can only edit your own posts" });
    }

   const result = await query(
  `UPDATE posts 
   SET content = $1, image_url = $2, video_url = $3, updated_at = NOW()
   WHERE id = $4
   RETURNING id, user_id AS authorId, content, image_url AS imageUrl, video_url AS videoUrl, created_at`,
  [content, imageUrl || null, videoUrl || null, postId]
);


    res.json(result.rows[0]);
  })
);
// POST toggle follow/unfollow for a post
app.post(
  "/posts/:postId/follow",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    
    const userId = req.user?.userId;
if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const postId = parseInt(req.params.postId, 10);

    if (isNaN(postId)) {
      return res.status(400).json({ error: "Invalid post ID" });
    }

    // Check if user already follows this post
    const followCheck = await query("SELECT * FROM post_follows WHERE user_id = $1 AND post_id = $2", [userId, postId]);

    if (followCheck.rows.length > 0) {
      // User follows this post, so unfollow
      await query("DELETE FROM post_follows WHERE user_id = $1 AND post_id = $2", [userId, postId]);
      return res.json({ followed: false });
    } else {
      // User does not follow this post, so add follow
      await query("INSERT INTO post_follows (user_id, post_id) VALUES ($1, $2)", [userId, postId]);
      return res.json({ followed: true });
    }
  })
);

// POST toggle like/unlike for a post
app.post(
  "/posts/:postId/like",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
   
    const userId = req.user?.userId;
if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const postId = parseInt(req.params.postId, 10);

    if (isNaN(postId)) {
      return res.status(400).json({ error: "Invalid post ID" });
    }

    // Check if user already liked this post
    const likeCheck = await query("SELECT * FROM post_likes WHERE user_id = $1 AND post_id = $2", [userId, postId]);

    if (likeCheck.rows.length > 0) {
      // User liked this post, so unlike (remove)
      await query("DELETE FROM post_likes WHERE user_id = $1 AND post_id = $2", [userId, postId]);
      return res.json({ liked: false });
    } else {
      // User did not like yet, add like
      await query("INSERT INTO post_likes (user_id, post_id) VALUES ($1, $2)", [userId, postId]);
      return res.json({ liked: true });
    }
  })
);

// POST share a post
app.post(
  "/posts/:postId/share",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    
    const userId = req.user?.userId;
if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const postId = parseInt(req.params.postId, 10);

    if (isNaN(postId)) {
      return res.status(400).json({ error: "Invalid post ID" });
    }

    // Check if user already shared this post
    const shareCheck = await query("SELECT * FROM post_shares WHERE user_id = $1 AND post_id = $2", [userId, postId]);

    if (shareCheck.rows.length > 0) {
      return res.status(400).json({ error: "Post already shared" });
    } else {
      await query("INSERT INTO post_shares (user_id, post_id, shared_at) VALUES ($1, $2, NOW())", [userId, postId]);
      return res.json({ shared: true });
    }
  })
);

// -------- COMMENTS ROUTES ---------

// GET comments for a post
app.get(
  "/posts/:postId/comments",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    const postId = parseInt(req.params.postId, 10);

    if (isNaN(postId)) {
      return res.status(400).json({ error: "Invalid post ID" });
    }

    const result = await query(
      `SELECT 
         c.id, 
         c.post_id, 
         c.user_id AS "userId", 
         u.name AS "userName", 
         c.content, 
         c.created_at
       FROM comments c
       JOIN users u ON c.user_id = u.id
       WHERE c.post_id = $1
       ORDER BY c.created_at ASC`,
      [postId]
    );

    res.json(result.rows);
  })
);
//-------------Admin News and updates-------
// GET news - no changes needed if table has url column
app.get("/news", async (req: Request, res: Response) => {
  try {
    const result = await query("SELECT * FROM news ORDER BY created_at DESC");
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch news" });
  }
});

// POST news - add url field support
app.post("/news", (req: Request, res: Response): void => {
  (async () => {
    const { title, content, image_url, url } = req.body;

    if (!title || !content) {
      res.status(400).json({ error: "Missing title or content" });
      return;
    }

    try {
      await query(
        "INSERT INTO news (title, content, image_url, url) VALUES ($1, $2, $3, $4)",
        [title, content, image_url || null, url || null]
      );
      res.status(201).json({ message: "News added successfully" });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to add news" });
    }
  })();
});

//--------Add news image------

app.post(
  "/upload-news-image",
  upload.single("image"),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) {
      console.error("❌ No file uploaded.");
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    console.log("✅ Uploaded file via Cloudinary:");
    console.dir(req.file, { depth: null });

    // ✅ Use `path` instead of `secure_url`
   res.status(200).json({ imageUrl: req.file.path }); // currently only returns path? Need secure_url instead

  })
);






//-------Edit My profile routes-------------
//---------------Routes to display majors in dropdown in edit profile-------------------------

app.put("/users/:id", authenticateToken, asyncHandler(async (req, res) => {
  const userId = Number(req.params.id);

  // List all possible fields, adding major_id and major_other
  const allowedFields = [
    "name",
    "email",
    "title",
    "university",
    "major", // keep for legacy, but ideally avoid updating this
    "major_id",
    "major_other",
    "experience_level",
    "skills",
    "company",
    "courses_completed",
    "country",
    "state",
    "city",
    "birthdate",
    "volunteering_work",
    "projects_completed",
    "photo_url",
  ];

  // Validate major_id if provided
  if (req.body.major_id !== undefined && req.body.major_id !== null) {
    const majorCheck = await query(
      "SELECT id FROM standard_majors WHERE id = $1",
      [req.body.major_id]
    );
    if (majorCheck.rowCount === 0) {
      return res.status(400).json({ error: "Invalid major_id" });
    }
  }

  // Filter fields present in req.body
  const fieldsToUpdate = allowedFields.filter(field => req.body[field] !== undefined);

  if (fieldsToUpdate.length === 0) {
    return res.status(400).json({ error: "No valid fields provided for update" });
  }

  // Build SET clause dynamically
  const setClause = fieldsToUpdate
    .map((field, idx) => `${field}=$${idx + 1}`)
    .join(", ");

  // Collect values in same order
  const values = fieldsToUpdate.map(field => req.body[field]);

  // Add userId as last parameter
  values.push(userId);

  // Execute dynamic query
  const result = await query(
    `UPDATE users SET ${setClause} WHERE id=$${values.length} RETURNING *`,
    values
  );

  if (result.rowCount === 0) {
    return res.status(404).json({ error: "User not found" });
  }

  res.json(result.rows[0]);
}));

// GET /standard_majors - fetch all standard majors
app.get("/standard_majors", asyncHandler(async (req, res) => {
  const result = await query("SELECT id, name FROM standard_majors ORDER BY name ASC");
  res.json(result.rows);
}));

//----insert new  majors added by users in pending majors to approve
app.post("/pending_majors", authenticateToken, asyncHandler(async (req, res) => {
  const userId = req.user?.userId;
  if (!userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const { name } = req.body;

  if (!name || name.trim() === "") {
    return res.status(400).json({ error: "Major name is required" });
  }

  const existingStandard = await query(
    `SELECT id FROM standard_majors WHERE LOWER(name) = LOWER($1)`,
    [name.trim()]
  );

  if (existingStandard?.rowCount && existingStandard.rowCount > 0) {
    return res.status(400).json({ error: "Major already exists" });
  }

  const existingPending = await query(
    `SELECT id FROM pending_majors WHERE LOWER(name) = LOWER($1)`,
    [name.trim()]
  );

  if (existingPending?.rowCount && existingPending.rowCount > 0) {
    return res.status(400).json({ error: "Major already submitted and pending approval" });
  }

  const result = await query(
    `INSERT INTO pending_majors (name, submitted_by) VALUES ($1, $2) RETURNING *`,
    [name.trim(), userId]
  );

  res.status(201).json(result.rows[0]);
}));

//-----Routes to get experience level for drop down in edite profile


// GET all standard experience levels
app.get(
  "/standard_experience_levels",
  asyncHandler(async (req, res) => {
    const result = await query(
      `SELECT id, level_name FROM standard_experience_levels ORDER BY id`
    );
    res.json(result.rows);
  })
);


//--------------------


// -------- Protected route to delete user profile ---------
app.delete(
  "/users/:id",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
     const userId = parseInt(req.params.id, 10);
    const tokenUserId = req.user?.userId;
if (!tokenUserId || isNaN(tokenUserId)) {
  return res.status(400).json({ error: "Invalid or missing user ID" });
}

    if (isNaN(userId)) {
      return res.status(400).json({ error: "Invalid user ID" });
    }

    // Only allow deleting own account
    if (userId !== tokenUserId) {
      return res.status(403).json({ error: "Forbidden: You can only delete your own account" });
    }

    const result = await query("DELETE FROM users WHERE id = $1 RETURNING id", [userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({ message: "User deleted successfully" });
  })
);


// POST add a comment to a post
app.post(
  "/posts/:postId/comments",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
  
    const userId = req.user?.userId;
if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const postId = parseInt(req.params.postId, 10);
    const { content } = req.body;

    if (isNaN(postId)) {
      return res.status(400).json({ error: "Invalid post ID" });
    }
    if (!content || content.trim() === "") {
      return res.status(400).json({ error: "Content is required" });
    }

    const result = await query(
      `INSERT INTO comments (post_id, user_id, content, created_at)
       VALUES ($1, $2, $3, NOW())
       RETURNING id, post_id, user_id, content, created_at`,
      [postId, userId, content]
    );

    res.status(201).json(result.rows[0]);
  })
);

// DELETE a comment
// -------- DELETE a post by ID (protected) --------
app.delete(
  "/posts/:postId",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    const postId = parseInt(req.params.postId, 10);
    
    const userId = req.user?.userId;
if (!userId) return res.status(401).json({ error: "Unauthorized" });


    if (isNaN(postId)) {
      return res.status(400).json({ error: "Invalid post ID" });
    }

    // Check if post exists and belongs to the user
    const result = await query("SELECT user_id FROM posts WHERE id = $1", [postId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Post not found" });
    }

    if (result.rows[0].user_id !== userId) {
      return res.status(403).json({ error: "Forbidden: You can only delete your own posts" });
    }

    await query("DELETE FROM posts WHERE id = $1", [postId]);

    res.json({ message: "Post deleted successfully" });
  })
);

app.delete(
  "/comments/:commentId",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    const commentId = parseInt(req.params.commentId, 10);
 
    const userId = req.user?.userId;
if (!userId) return res.status(401).json({ error: "Unauthorized" });


    if (isNaN(commentId)) {
      return res.status(400).json({ error: "Invalid comment ID" });
    }

    // Verify comment exists and belongs to user
    const commentResult = await query("SELECT user_id FROM comments WHERE id = $1", [commentId]);
    if (commentResult.rows.length === 0) {
      return res.status(404).json({ error: "Comment not found" });
    }
    if (commentResult.rows[0].user_id !== userId) {
      return res.status(403).json({ error: "Forbidden: You can only delete your own comments" });
    }

    await query("DELETE FROM comments WHERE id = $1", [commentId]);

    res.json({ message: "Comment deleted successfully" });
  })
);

// PUT update a comment
app.put(
  "/posts/:postId/comments/:commentId",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    const postId = parseInt(req.params.postId, 10);
    const commentId = parseInt(req.params.commentId, 10);
    const { content } = req.body;
    
    const userId = req.user?.userId;
if (!userId) return res.status(401).json({ error: "Unauthorized" });


    if (isNaN(postId) || isNaN(commentId)) {
      return res.status(400).json({ error: "Invalid post ID or comment ID" });
    }

    if (!content || content.trim() === "") {
      return res.status(400).json({ error: "Content is required" });
    }

    // Check if the comment belongs to the user and matches the post
    const commentResult = await query(
      "SELECT * FROM comments WHERE id = $1 AND post_id = $2 AND user_id = $3",
      [commentId, postId, userId]
    );

    if (commentResult.rows.length === 0) {
      return res.status(404).json({ error: "Comment not found or you are not the author" });
    }

    const updateResult = await query(
      `UPDATE comments
       SET content = $1, created_at = NOW()
       WHERE id = $2
       RETURNING id, post_id, user_id, content, created_at`,
      [content, commentId]
    );

    res.json(updateResult.rows[0]);
  })
);

//------messages for memebers chat routes----------
//-------------chat routes---------
// GET conversation messages between two users
app.get(
  "/messages/conversation",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.userId;
    const user1 = parseInt(req.query.user1 as string);
    const user2 = parseInt(req.query.user2 as string);

    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (!user1 || !user2) return res.status(400).json({ error: "Missing user1 or user2 query params" });

    // Security: Ensure the logged-in user is one of the two users
    if (userId !== user1 && userId !== user2) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const sql = `
      SELECT id, sender_id, receiver_id, message_text, sent_at, read_at
      FROM messages
      WHERE (sender_id = $1 AND receiver_id = $2)
         OR (sender_id = $2 AND receiver_id = $1)
      ORDER BY sent_at ASC
    `;

    const result = await query(sql, [user1, user2]);
    res.json(result.rows);
  })
);

// POST send a message
app.post(
  "/messages",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    const sender_id = req.user?.userId;
    const { receiver_id, message_text } = req.body;

    if (!sender_id) return res.status(401).json({ error: "Unauthorized" });
    if (!receiver_id || !message_text || message_text.trim() === "") {
      return res.status(400).json({ error: "receiver_id and message_text are required" });
    }

    const sql = `
      INSERT INTO messages (sender_id, receiver_id, message_text, sent_at)
      VALUES ($1, $2, $3, NOW())
      RETURNING id, sender_id, receiver_id, message_text, sent_at, read_at
    `;

    const result = await query(sql, [sender_id, receiver_id, message_text.trim()]);
    res.status(201).json(result.rows[0]);
  })
);
//---fetch all members for member-list component
app.get("/members", authenticateToken, asyncHandler(async (req, res) => {
  const userId = req.user?.userId;
  const members = await query(
    `SELECT id, name, photo_url FROM users WHERE id != $1 ORDER BY name ASC`,
    [userId]
  );
  res.json(members.rows);
}));

//-------add red notification with new message--
app.get('/messages/unread-count', authenticateToken, asyncHandler(async (req, res) => {
  const userId = req.user?.userId;
  const result = await query(
    `SELECT COUNT(*) FROM messages WHERE receiver_id = $1 AND read_at IS NULL`,
    [userId]
  );
  res.json({ unreadCount: parseInt(result.rows[0].count, 10) });
}));
app.post(
  "/messages/mark-read",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.userId;
    const { otherUserId } = req.body;

    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (!otherUserId) return res.status(400).json({ error: "Missing otherUserId" });

    // Update all unread messages sent from otherUserId to userId
    const result = await query(
      `UPDATE messages
       SET read_at = NOW()
       WHERE sender_id = $1 AND receiver_id = $2 AND read_at IS NULL`,
      [otherUserId, userId]
    );

    res.json({ message: "Messages marked as read" });
  })
);

app.get(
  "/members/combined-list",
  authenticateToken,
  asyncHandler(async (req, res) => {
    const userId = req.user?.userId;

    const sql = `
      SELECT u.id, u.name, u.photo_url, recent.last_message
      FROM users u
      LEFT JOIN (
        SELECT
          CASE WHEN sender_id = $1 THEN receiver_id ELSE sender_id END AS member_id,
          MAX(sent_at) as last_message
        FROM messages
        WHERE sender_id = $1 OR receiver_id = $1
        GROUP BY member_id
      ) recent ON u.id = recent.member_id
      WHERE u.id != $1
      ORDER BY
        CASE WHEN recent.last_message IS NULL THEN 1 ELSE 0 END,
        recent.last_message DESC NULLS LAST,
        u.name ASC
    `;

    const result = await query(sql, [userId]);

    const recentMembers = result.rows.filter((m) => m.last_message !== null);
    const otherMembers = result.rows.filter((m) => m.last_message === null);

    res.json({ recentMembers, otherMembers });
  })
);

app.get(
  "/messages/unread-count-by-sender",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const result = await query(
      `SELECT sender_id, COUNT(*) AS unread_count
       FROM messages
       WHERE receiver_id = $1 AND read_at IS NULL
       GROUP BY sender_id`,
      [userId]
    );

    // Format as { sender_id: unread_count, ... }
    const unreadCounts: Record<number, number> = {};
    result.rows.forEach((row) => {
      unreadCounts[row.sender_id] = parseInt(row.unread_count, 10);
    });

    res.json(unreadCounts);
  })
);

//---------------------------------------------
// --------------Discussion Topics route---------------
//--------------Post Discussion Topic---------------

app.post(
  "/discussion_topics",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    const { title, topic } = req.body;
    //const { topic } = req.body;
    const userId = req.user?.userId;

    if (!userId) 
       if (!title || title.trim() === "") {
      return res.status(401).json({ error: "Unauthorized" });
       }
    if (!topic || topic.trim() === "") {
      return res.status(400).json({ error: "Topic content is required" });
    }

    // 1. Insert topic & title
      const insertResult = await query(
      `INSERT INTO discussion_topics (user_id, title, topic, created_at)
       VALUES ($1, $2, $3, NOW())
       RETURNING id, user_id, title, topic, created_at`,
      [userId, title.trim(), topic.trim()]
    );
    const newTopic = insertResult.rows[0];

    // 2. Get author name
    const authorResult = await query("SELECT name FROM users WHERE id = $1", [userId]);
    const authorName = authorResult.rows[0]?.name || "Unknown";

    // 3. Return enriched topic object
    res.status(201).json({
      id: newTopic.id,
      title: newTopic.title,
      topic: newTopic.topic,
      createdAt: newTopic.created_at,
      author: authorName,
      authorId: userId,
      liked: false,
      followed: false,
      upvoted: false,
      likes: 0,
      shares: 0,
      upvotes: 0,
      comments: [],
    });
  })
);



//----Post discussion topics likes-----
app.post(
  "/discussion_topics/:topicId/like",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    const topicId = parseInt(req.params.topicId, 10);
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (isNaN(topicId)) return res.status(400).json({ error: "Invalid topic ID" });

    let liked = false;

    const likeCheck = await query(
      "SELECT * FROM discussion_likes WHERE user_id = $1 AND topic_id = $2",
      [userId, topicId]
    );

    if (likeCheck.rows.length > 0) {
      await query("DELETE FROM discussion_likes WHERE user_id = $1 AND topic_id = $2", [userId, topicId]);
      liked = false;
    } else {
      await query("INSERT INTO discussion_likes (user_id, topic_id) VALUES ($1, $2)", [userId, topicId]);
      liked = true;
    }

    const countResult = await query(
      "SELECT COUNT(*) FROM discussion_likes WHERE topic_id = $1",
      [topicId]
    );

    const totalLikes = parseInt(countResult.rows[0].count, 10);

    return res.json({ liked, totalLikes });
  })
);
//----Post disucssion topics follows----
app.post(
  "/discussion_topics/:topicId/follow",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    const topicId = parseInt(req.params.topicId, 10);
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (isNaN(topicId)) return res.status(400).json({ error: "Invalid topic ID" });

    const followCheck = await query(
      "SELECT * FROM discussion_follows WHERE user_id = $1 AND topic_id = $2",
      [userId, topicId]
    );

    if (followCheck.rows.length > 0) {
      await query("DELETE FROM discussion_follows WHERE user_id = $1 AND topic_id = $2", [userId, topicId]);
      return res.json({ followed: false });
    } else {
      await query("INSERT INTO discussion_follows (user_id, topic_id) VALUES ($1, $2)", [userId, topicId]);
      return res.json({ followed: true });
    }
  })
);

 //-------Discussion topics comments  --------
    app.post(
  "/discussion_topics/:topicId/comments",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    const topicId = parseInt(req.params.topicId, 10);
    const userId = req.user?.userId;
    const { content } = req.body;

    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (isNaN(topicId)) return res.status(400).json({ error: "Invalid topic ID" });
    if (!content || content.trim() === "") {
      return res.status(400).json({ error: "Content is required" });
    }

    // Insert the comment
    const insertResult = await query(
      `INSERT INTO discussion_comments (topic_id, user_id, content, created_at)
       VALUES ($1, $2, $3, NOW())
       RETURNING id, topic_id, user_id, content, created_at`,
      [topicId, userId, content]
    );

    const newComment = insertResult.rows[0];

    // Get the user name to return with comment
    const userResult = await query(`SELECT name FROM users WHERE id = $1`, [userId]);
    const userName = userResult.rows[0]?.name || "Unknown";

    // Return the comment with userName
    res.status(201).json({
      id: newComment.id,
      userId: newComment.user_id,
      userName,
      content: newComment.content,
      createdAt: newComment.created_at,
    });
  })
);


//----Get comments for discussion topic---
app.get(
  "/discussion_topics",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    // Get all discussion topics with author names
    const topicsResult = await query(
      `SELECT dt.*, u.name AS author_name
       FROM discussion_topics dt
       JOIN users u ON dt.user_id = u.id
       ORDER BY dt.created_at DESC`
    );
    // Get all upvotes for the current user
const upvotesResult = await query(
  "SELECT topic_id FROM discussion_upvotes WHERE user_id = $1",
  [userId]
);

// Count total upvotes per topic
const upvoteCountsResult = await query(`
  SELECT topic_id, COUNT(*) AS count
  FROM discussion_upvotes
  GROUP BY topic_id
`);

const upvotedTopicIds = new Set(upvotesResult.rows.map((r) => r.topic_id));
const upvoteCountsMap: { [key: number]: number } = {};
for (const row of upvoteCountsResult.rows) {
  upvoteCountsMap[row.topic_id] = parseInt(row.count, 10);
}


    const topicIds = topicsResult.rows.map((t) => t.id);
    let commentsResult = { rows: [] as any[] };

    if (topicIds.length > 0) {
      commentsResult = await query(
        `SELECT c.*, u.name AS user_name
         FROM discussion_comments c
         JOIN users u ON c.user_id = u.id
         WHERE c.topic_id = ANY($1::int[])
         ORDER BY c.created_at ASC`,
        [topicIds]
      );
    }

    const commentsByTopicId: { [key: number]: any[] } = {};
    for (const comment of commentsResult.rows) {
      if (!commentsByTopicId[comment.topic_id]) {
        commentsByTopicId[comment.topic_id] = [];
      }
      commentsByTopicId[comment.topic_id].push(comment);
    }

    // Fetch likes and follows by the current user
    const likesResult = await query(
      "SELECT topic_id FROM discussion_likes WHERE user_id = $1",
      [userId]
    );
    const followsResult = await query(
      "SELECT topic_id FROM discussion_follows WHERE user_id = $1",
      [userId]
    );

    const likedTopicIds = new Set(likesResult.rows.map((r) => r.topic_id));
    const followedTopicIds = new Set(followsResult.rows.map((r) => r.topic_id));
const likesCountResult = await query(`
  SELECT topic_id, COUNT(*) AS count
  FROM discussion_likes
  GROUP BY topic_id
`);
const likesCountMap: { [key: number]: number } = {};
for (const row of likesCountResult.rows) {
  likesCountMap[row.topic_id] = parseInt(row.count, 10);
}
    const enrichedTopics = topicsResult.rows.map((topic) => ({
      id: topic.id,
       title: topic.title,      
      topic: topic.topic,
      authorId: topic.user_id,
      createdAt: topic.created_at,
      author: topic.author_name,
       likes: likesCountMap[topic.id] || 0, 
      shares: topic.shares || 0,
      liked: likedTopicIds.has(topic.id),
      upvotes: upvoteCountsMap[topic.id] || 0,
upvoted: upvotedTopicIds.has(topic.id),
      followed: followedTopicIds.has(topic.id),
      comments: commentsByTopicId[topic.id] || [],
    }));

    res.json(enrichedTopics);
  })
);

//--------allow user to delete comment
app.delete(
  "/discussion_topics/comments/:commentId",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    const commentId = parseInt(req.params.commentId, 10);
    const userId = req.user?.userId;

    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (isNaN(commentId)) return res.status(400).json({ error: "Invalid comment ID" });

    // Check ownership
    const commentCheck = await query(
      "SELECT user_id FROM discussion_comments WHERE id = $1",
      [commentId]
    );

    if (commentCheck.rows.length === 0) {
      return res.status(404).json({ error: "Comment not found" });
    }

    if (commentCheck.rows[0].user_id !== userId) {
      return res.status(403).json({ error: "Forbidden: You can only delete your own comments" });
    }

    // Delete comment
    await query("DELETE FROM discussion_comments WHERE id = $1", [commentId]);

    res.json({ message: "Comment deleted successfully" });
  })
);


// ---Post discussion topics upvote--
app.post(
  "/discussion_topics/:topicId/upvote",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    const topicId = parseInt(req.params.topicId, 10);
    const userId = req.user?.userId;

    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (isNaN(topicId)) return res.status(400).json({ error: "Invalid topic ID" });

    const upvoteCheck = await query(
      "SELECT * FROM discussion_upvotes WHERE user_id = $1 AND topic_id = $2",
      [userId, topicId]
    );

    if (upvoteCheck.rows.length > 0) {
      await query("DELETE FROM discussion_upvotes WHERE user_id = $1 AND topic_id = $2", [userId, topicId]);
      return res.json({ upvoted: false });
    } else {
      await query("INSERT INTO discussion_upvotes (user_id, topic_id) VALUES ($1, $2)", [userId, topicId]);
      return res.json({ upvoted: true });
    }
  })
);



//----delete discussion topic---
app.delete(
  "/discussion_topics/:topicId",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    const topicId = parseInt(req.params.topicId, 10);
    const userId = req.user?.userId;

    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (isNaN(topicId)) return res.status(400).json({ error: "Invalid topic ID" });

    const topicCheck = await query("SELECT user_id FROM discussion_topics WHERE id = $1", [topicId]);
    if (topicCheck.rows.length === 0) {
      return res.status(404).json({ error: "Topic not found" });
    }

    if (topicCheck.rows[0].user_id !== userId) {
      return res.status(403).json({ error: "Forbidden: You can only delete your own topic" });
    }

    await query("DELETE FROM discussion_topics WHERE id = $1", [topicId]);

    res.json({ message: "Topic deleted successfully" });
  })
);
//---Update discussion topic---
app.put(
  "/discussion_topics/:topicId",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    const topicId = parseInt(req.params.topicId, 10);
    const userId = req.user?.userId;
    const { topic } = req.body;

    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (isNaN(topicId)) return res.status(400).json({ error: "Invalid topic ID" });
    if (!topic || topic.trim() === "") return res.status(400).json({ error: "Topic content is required" });

    const topicCheck = await query("SELECT user_id FROM discussion_topics WHERE id = $1", [topicId]);
    if (topicCheck.rows.length === 0) {
      return res.status(404).json({ error: "Topic not found" });
    }

    if (topicCheck.rows[0].user_id !== userId) {
      return res.status(403).json({ error: "Forbidden: You can only edit your own topic" });
    }

    await query("UPDATE discussion_topics SET topic = $1, created_at = NOW() WHERE id = $2", [
      topic,
      topicId,
    ]);

    res.json({ message: "Topic updated successfully" });
  })
);


//---------------Create Study circle route-------
app.post(
  "/study-circles",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    const { name, isPublic, members } = req.body;
    const userId = req.user?.userId;
    

    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (!name || name.trim() === "") return res.status(400).json({ error: "Study circle name is required" });

    console.log("📥 Received request to create study circle:", { name, isPublic, members });

    // ✅ Insert study circle
    const result = await query(
      `INSERT INTO study_circles (user_id, name, is_public, created_at)
       VALUES ($1, $2, $3, NOW())
       RETURNING id, user_id, name, is_public, created_at`,
      [userId, name.trim(), isPublic]
    );

    const circleId = result.rows[0].id;
    console.log("✅ Circle created successfully with ID:", circleId);

    // ✅ Auto-add the creator
    await query("INSERT INTO study_circle_members (circle_id, user_id) VALUES ($1, $2)", [circleId, userId]);
    //console.log("👤 Creator added as member");

    // ✅ Add additional members if any
    if (Array.isArray(members) && members.length > 0) {
      for (const email of members) {
        const userResult = await query("SELECT id FROM users WHERE email = $1", [email]);

        if (userResult.rows.length > 0) {
          const memberId = userResult.rows[0].id;
          if (memberId !== userId) {
            await query("INSERT INTO study_circle_members (circle_id, user_id) VALUES ($1, $2)", [circleId, memberId]);
            console.log(`👥 Added member ${email} (ID: ${memberId})`);
          }
        } else {
          console.log(`⚠️ No user found with email ${email}`);
        }
      }
    }

    res.status(201).json({ message: "Study circle created", id: circleId });
  })
);


//-------------Get all study circles----------
app.get(
  "/study-circles",
  authenticateToken,
  asyncHandler(async (_req: Request, res: Response) => {
  
    const ownerEmail = (_req.query.ownerEmail as string) || null;
     const circleName = (_req.query.circleName as string) || null;

    const  results = await query(
       `SELECT sc.id, sc.name, sc.is_public, sc.created_at, sc.user_id AS created_by, u.name AS creator, u.email AS owner_email
       FROM study_circles sc
       JOIN users u ON sc.user_id = u.id
       WHERE ($1::text IS NULL OR u.email ILIKE '%' || $1 || '%')
         AND ($2::text IS NULL OR sc.name ILIKE '%' || $2 || '%')
       ORDER BY sc.created_at DESC`,
      [ownerEmail, circleName]
    );

      //  Get members for circles (same as before)
    const memberResults = await query(
      `SELECT scm.circle_id, u.email
       FROM study_circle_members scm
       JOIN users u ON scm.user_id = u.id`
    );

    // ✅ FIXED: Include `created_by` in the type definition
    const circleMap = new Map<number, {
      id: number;
      name: string;
      is_public: boolean;
      creator: string;
      created_by: number; // ✅ Important for permission checks
       owner_email: string;   // for search circles by member email
      members: string[];
    }>();

   // Build map from filtered circles only
    results.rows.forEach(circle => {
      circleMap.set(circle.id, { ...circle, members: [] });
    });

    memberResults.rows.forEach(member => {
      if (circleMap.has(member.circle_id)) {
        circleMap.get(member.circle_id)!.members.push(member.email);
      }
    });

    res.json(Array.from(circleMap.values()));
  })
);





//----------------------Circle messaging -------------
app.get(
  "/study-circles/:id/messages",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    const circleId = parseInt(req.params.id, 10);

    const result = await query(
      `SELECT cm.id, cm.message, cm.created_at, cm.user_id AS senderId, u.name AS sender
       FROM circle_messages cm
       JOIN users u ON cm.user_id = u.id
       WHERE cm.circle_id = $1
       ORDER BY cm.created_at ASC`,
      [circleId]
    );

    res.json(result.rows);
  })
);


app.post(
  "/study-circles/:id/messages",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.userId;
    const circleId = parseInt(req.params.id, 10);
    const { message } = req.body;

    if (!message || !userId || isNaN(circleId)) {
      return res.status(400).json({ error: "Missing data" });
    }

    // Insert the new message
    const insertResult = await query(
      `INSERT INTO circle_messages (circle_id, user_id, message)
       VALUES ($1, $2, $3)
       RETURNING id, message, created_at`,
      [circleId, userId, message]
    );

    const savedMessage = insertResult.rows[0];

    // Get sender name
    const userResult = await query(`SELECT name FROM users WHERE id = $1`, [userId]);
    const senderName = userResult.rows[0]?.name || "Unknown";

    res.status(201).json({
      ...savedMessage,
      senderId: userId,
      sender: senderName,
    });
  })
);


app.post(
  "/study-circles/:circleId/add-member",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    const circleId = parseInt(req.params.circleId, 10);
    const { userId } = req.body;

    if (!circleId || !userId) {
      return res.status(400).json({ error: "Circle ID and user ID are required" });
    }

    // Check if user already exists in the circle
    const existing = await query(
      `SELECT * FROM study_circle_members WHERE circle_id = $1 AND user_id = $2`,
      [circleId, userId]
    );

    if (existing.rows.length > 0) {
      return res.status(400).json({ error: "User is already a member of this circle" });
    }

    await query(
      `INSERT INTO study_circle_members (circle_id, user_id) VALUES ($1, $2)`,
      [circleId, userId]
    );

    return res.json({ success: true });
  })
);



//---------add memebrs to study circles---------
// ----------------- SEARCH USERS -----------------


// ----------------- SEARCH USERS -----------------
// 🔍 Search users by name or email (case-insensitive)

app.get("/users/search", authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const queryParam = req.query.query;

  if (!queryParam || typeof queryParam !== "string") {
    res.status(400).json({ error: "Missing or invalid search query" });
    return;
  }

  try {
    const results = await query(
      `SELECT id, name, email FROM users
       WHERE LOWER(name) LIKE LOWER($1) OR LOWER(email) LIKE LOWER($1)
       LIMIT 10`,
      [`%${queryParam}%`]
    );

    res.json(results.rows);
  } catch (err) {
    console.error("Error searching users:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

//------------
app.get(
  "/users/:id",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = parseInt(req.params.id, 10);

    if (isNaN(userId)) {
      return res.status(400).json({ error: "Invalid user ID" });
    }

    // Authorization check: allow only the user themselves or admins
    if (req.user!.userId !== userId && !req.user!.isAdmin) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const result = await query(
  `SELECT id, name, email, title, university, major, experience_level, skills, company,
   courses_completed, country, birthdate, volunteering_work, projects_completed, photo_url,
   is_premium
   FROM users WHERE id = $1`,
  [userId]
);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json(result.rows[0]);
  })
);





//---------Join- leave Circles logic------------------
app.post(
  "/study-circles/:id/join",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.userId;
    const circleId = parseInt(req.params.id, 10);

    if (!userId || isNaN(circleId)) {
      return res.status(400).json({ error: "Invalid user or circle ID" });
    }

    // Check if user is already a member
    const check = await query(
      "SELECT * FROM study_circle_members WHERE user_id = $1 AND circle_id = $2",
      [userId, circleId]
    );

    if (check.rows.length > 0) {
      // Already a member — so remove (leave)
      await query(
        "DELETE FROM study_circle_members WHERE user_id = $1 AND circle_id = $2",
        [userId, circleId]
      );
      return res.json({ joined: false });
    } else {
      // Not a member — so join
      await query(
        "INSERT INTO study_circle_members (user_id, circle_id) VALUES ($1, $2)",
        [userId, circleId]
      );
      return res.json({ joined: true });
    }
  })
);

// --------DELETE study circle by creator--------------
app.delete("/study-circles/:id", authenticateToken, async (req: Request, res: Response): Promise<void> => {
  const userId = req.user?.userId;
  if (!userId) {
    
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const circleId = parseInt(req.params.id, 10);
    const result = await query("SELECT user_id FROM study_circles WHERE id = $1", [circleId]);


    if (result.rows.length === 0) {
      
      res.status(404).json({ error: "Circle not found" });
      return;
    }

    const created_by = result.rows[0].user_id;

    console.log("🔍 Created by:", created_by, "| Requesting userId:", userId, "| Typeof:", typeof created_by, typeof userId);
if (Number(created_by) !== Number(userId)) {

      console.log("❌ Not authorized - user is not creator");
      res.status(403).json({ error: "Not authorized to delete this circle" });
      return;
    }

    await query("DELETE FROM study_circle_members WHERE circle_id = $1", [circleId]);
    await query("DELETE FROM circle_messages WHERE circle_id = $1", [circleId]);
    await query("DELETE FROM study_circles WHERE id = $1", [circleId]);

    console.log("✅ Circle deleted");
    res.status(200).json({ message: "Circle deleted successfully." });
  } catch (err) {
    console.error("🔥 Error deleting circle:", err);
    res.status(500).json({ error: "Failed to delete circle" });
  }
});
//---------------------------------------------------------------------------------
//-------------Majors list route
app.get("/api/majors", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const offset = parseInt(req.query.offset as string) || 0;

    const baseQuery = `FROM majors`;
    const queryParams: any[] = [];

    // Get total count
    const countResult = await query(`SELECT COUNT(*) ${baseQuery}`, queryParams);
    const totalCount = parseInt(countResult.rows[0].count, 10);

    // Get paged results
    queryParams.push(limit);
    queryParams.push(offset);
    const dataResult = await query(
      `SELECT id, name, description, popular_universities, cover_photo_url ${baseQuery} ORDER BY name LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length}`,
      queryParams
    );

    res.json({ totalCount, majors: dataResult.rows });
  } catch (error) {
    console.error("Error fetching majors:", error);
    res.status(500).json({ error: "Failed to fetch majors" });
  }
});

//---------PitchPoint Video---------

app.get(
  "/api/videos",
  asyncHandler(async (req, res) => {
    const videosRes = await query(`
      SELECT 
        v.id,
        v.user_id,
        v.title,
        v.description,
        v.video_url,
        v.category,
        COALESCE(l.likes_count, 0) AS likes,
        COALESCE(f.follows_count, 0) AS follows,
        COALESCE(v.share_count, 0) AS shares
      FROM pitchpoint_videos v
      LEFT JOIN (
        SELECT video_id, COUNT(*) AS likes_count
        FROM pitchpoint_video_likes
        GROUP BY video_id
      ) l ON v.id = l.video_id
      LEFT JOIN (
        SELECT video_id, COUNT(*) AS follows_count
        FROM pitchpoint_video_follows
        GROUP BY video_id
      ) f ON v.id = f.video_id
      ORDER BY v.created_at DESC;
    `);
    res.json(videosRes.rows);
  })
);


// POST /api/videos - add new video
app.post(
  "/api/videos",
  authenticateToken,
  asyncHandler(async (req, res) => {
    const { title, description, video_url, category } = req.body;
    const userId = req.user?.userId;

    if (!title || !video_url) {
      res.status(400).json({ error: "Title and video_url are required" });
      return;
    }

    if (!userId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const insertRes = await query(
      `INSERT INTO pitchpoint_videos (user_id, title, description, video_url, category, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW()) RETURNING *`,
      [userId, title, description || null, video_url, category || null]
    );

    res.status(201).json(insertRes.rows[0]);
  })
);



// POST /api/videos/:id/like - toggle like
// POST /api/videos/:id/like - toggle like
app.post(
  "/api/videos/:id/like",
  authenticateToken,
  asyncHandler(async (req, res) => {
    const videoId = parseInt(req.params.id);
    const userId = req.user?.userId;
    const { liked } = req.body;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (typeof liked !== "boolean") {
      res.status(400).json({ error: "liked must be boolean" });
      return;
    }

    if (liked) {
      await query(
        `INSERT INTO pitchpoint_video_likes (video_id, user_id, liked_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (video_id, user_id) DO NOTHING`,
        [videoId, userId]
      );
    } else {
      await query(
        `DELETE FROM pitchpoint_video_likes WHERE video_id = $1 AND user_id = $2`,
        [videoId, userId]
      );
    }

    const likesRes = await query(
      `SELECT COUNT(*) FROM pitchpoint_video_likes WHERE video_id = $1`,
      [videoId]
    );

    res.json({
      likes: parseInt(likesRes.rows[0].count, 10),
      likedByUser: liked,
    });
  })
);

// POST /api/videos/:id/follow - toggle follow
app.post(
  "/api/videos/:id/follow",
  authenticateToken,
  asyncHandler(async (req, res) => {
    const videoId = parseInt(req.params.id);
    const userId = req.user?.userId;
    const { followed } = req.body;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    if (typeof followed !== "boolean") {
      res.status(400).json({ error: "followed must be boolean" });
      return;
    }

    if (followed) {
      await query(
        `INSERT INTO pitchpoint_video_follows (video_id, user_id, followed_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (video_id, user_id) DO NOTHING`,
        [videoId, userId]
      );
    } else {
      await query(
        `DELETE FROM pitchpoint_video_follows WHERE video_id = $1 AND user_id = $2`,
        [videoId, userId]
      );
    }

    const followsRes = await query(
      `SELECT COUNT(*) FROM pitchpoint_video_follows WHERE video_id = $1`,
      [videoId]
    );

    res.json({
      follows: parseInt(followsRes.rows[0].count, 10),
      followedByUser: followed,
    });
  })
);

// POST /api/videos/:id/share - register share (increment count)
app.post(
  "/api/videos/:id/share",
  authenticateToken,
  asyncHandler(async (req, res) => {
    const videoId = parseInt(req.params.id);
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    await query(
      `UPDATE pitchpoint_videos SET share_count = COALESCE(share_count, 0) + 1, updated_at = NOW() WHERE id = $1`,
      [videoId]
    );

    const sharesRes = await query(
      `SELECT COALESCE(share_count, 0) AS shares FROM pitchpoint_videos WHERE id = $1`,
      [videoId]
    );

    res.json({ shares: sharesRes.rows[0].shares });
  })
);


app.post(
  "/api/upload-video",
  authenticateToken,
  uploadMemory.single("file"),
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const streamUpload = () => {
      return new Promise<{ secure_url: string }>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            resource_type: "video",
            folder: "ypropel-videos",
          },
          (error, result) => {
            if (error || !result) {
              reject(error || new Error("Upload failed"));
            } else {
              resolve(result);
            }
          }
        );

        // Here add non-null assertion to assure TypeScript req.file is defined
        stream.end(req.file!.buffer);
      });
    };

    try {
      const uploadResult = await streamUpload();
      res.json({ videoUrl: uploadResult.secure_url });
    } catch (error) {
      console.error("Cloudinary upload error:", error);
      res.status(500).json({ error: "Failed to upload video" });
    }
  })
);
// DELETE /api/videos/:id - delete a video if owned by the authenticated user
app.delete(
  "/api/videos/:id",
  authenticateToken,
  asyncHandler(async (req, res) => {
    const videoId = parseInt(req.params.id);
    //const userId = (req as any).user.id;
const userId = req.user?.userId;
    // Verify video exists and is owned by user
    const videoRes = await query("SELECT user_id FROM pitchpoint_videos WHERE id = $1", [videoId]);
    if (videoRes.rowCount === 0) {
      return res.status(404).json({ error: "Video not found" });
    }
    if (videoRes.rows[0].user_id !== userId) {
      return res.status(403).json({ error: "Not authorized to delete this video" });
    }

    // Delete video
    await query("DELETE FROM pitchpoint_videos WHERE id = $1", [videoId]);

    res.json({ success: true });
  })
);


//-------------------Universities ---------------------------------------
//------- get universities list to public 
app.get("/api/universities", async (req, res) => {
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const offset = parseInt(req.query.offset as string) || 0;
    const state = req.query.state as string;

    let baseQuery = `FROM universities WHERE country='United States'`;
    const queryParams: any[] = [];

    if (state && state !== "") {
      queryParams.push(state);
      baseQuery += ` AND state = $${queryParams.length}`;
    }

    // Get total count
    const countResult = await query(`SELECT COUNT(*) ${baseQuery}`, queryParams);
    const totalCount = parseInt(countResult.rows[0].count, 10);

    // Get current page results
    queryParams.push(limit);
    queryParams.push(offset);
    const dataResult = await query(
      `SELECT id, title, website, description, country, state, city ${baseQuery} ORDER BY state LIMIT $${queryParams.length - 1} OFFSET $${queryParams.length}`,
      queryParams
    );

    res.json({ totalCount, universities: dataResult.rows });
  } catch (error) {
    console.error("Error fetching universities:", error);
    res.status(500).json({ error: "Failed to fetch universities" });
  }
});
//-- Create routes to search universities by name & description
app.get("/api/universities/search", async (req, res) => {
  console.log("Search universities route hit");
  try {
    const limit = parseInt(req.query.limit as string) || 100;
    const offset = parseInt(req.query.offset as string) || 0;
    const state = req.query.state as string | undefined;
    const name = (req.query.name as string | undefined)?.trim();
    const knownFor = (req.query.known_for as string | undefined)?.trim();

    let baseQuery = `
      SELECT id, title, website, description, country, state, city
      FROM universities
      WHERE 1=1
    `;

    const params: any[] = [];
    let paramIndex = 1;

    if (state && state !== "") {
      baseQuery += ` AND state = $${paramIndex++}`;
      params.push(state);
    }
    if (name && name !== "") {
      baseQuery += ` AND LOWER(title) LIKE LOWER($${paramIndex++})`;
      params.push(`%${name}%`);
    }
    if (knownFor && knownFor !== "") {
      baseQuery += ` AND LOWER(description) LIKE LOWER($${paramIndex++})`;
      params.push(`%${knownFor}%`);
    }

    // Count total matching rows for pagination
    const countQuery = `SELECT COUNT(*) FROM (${baseQuery}) AS sub`;
    const countResult = await pool.query(countQuery, params);
    const totalCount = parseInt(countResult.rows[0].count, 10);

    baseQuery += ` ORDER BY title ASC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
    params.push(limit, offset);

    const dataResult = await pool.query(baseQuery, params);

    res.json({
      totalCount,
      universities: dataResult.rows,
    });
  } catch (error) {
    console.error("Error fetching universities (search):", error);
    res.status(500).json({ error: "Internal server error" });
  }
});



//----------------------------

//-------------------trade schools ---------------------------------------
// get schools list to public 

// GET /trade-schools/states - get distinct states
app.get(
  "/trade-schools/states",
  asyncHandler(async (req: Request, res: Response) => {
    const result = await query("SELECT DISTINCT state FROM trade_schools ORDER BY state ASC");
    const states = result.rows.map((row) => row.state);
    res.json(states);
  })
);

// GET /trade-schools - paginated list with optional state filter
app.get(
  "/trade-schools",
  asyncHandler(async (req: Request, res: Response) => {
    const { state, page = "1", limit = "20" } = req.query;

    const pageNum = parseInt(page as string);
    const limitNum = parseInt(limit as string);
    const offset = (pageNum - 1) * limitNum;

    let baseQuery = "SELECT * FROM trade_schools";
    const params: any[] = [];
    let whereClause = "";

    if (state) {
      params.push(state);
      whereClause = ` WHERE state = $${params.length}`;
    }

    const paginatedQuery = `${baseQuery}${whereClause} ORDER BY title ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limitNum, offset);

    const result = await query(paginatedQuery, params);

    const countQuery = `SELECT COUNT(*) FROM trade_schools${whereClause}`;
    const countResult = await query(countQuery, state ? [state] : []);

    res.json({
      tradeSchools: result.rows,
      total: parseInt(countResult.rows[0].count, 10),
      page: pageNum,
      limit: limitNum,
    });
  })
);

//-------music schools----------

// GET /music-majors — fetch all music majors
app.get('/music-majors', asyncHandler(async (req, res) => {
  const result = await query(`
    SELECT id, title, description, top_universities, cover_photo_url 
    FROM music_majors
    ORDER BY title ASC
  `);
  res.json(result.rows);
}));

//----------------Pre-college summer programs---------------
//---------return all summer programs to the frontend:-----
app.get("/summer-programs", async (req: Request, res: Response) => {
  try {
    const result = await query("SELECT * FROM pre_college_summer_programs ORDER BY created_at DESC");
    res.json(result.rows);
  } catch (err) {
    console.error("Error fetching summer programs:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});
//-------------Create Freelance page Routes----------
//---Allow members to post freelance service
app.post(
  "/freelance-services",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.userId;
    const {
      name,
      description,
      about,
      service_type,
      other_service,  // New field added here
      state,
      city,
      location,
      rate,
      email,
      website,
      gallery,
    } = req.body;

    if (!name) return res.status(400).json({ error: "Service name is required" });

    const galleryJson = gallery ? JSON.stringify(gallery) : null;

    const result = await query(
      `INSERT INTO freelance_services
      (member_id, name, description, about, service_type, other_service, state, city, rate, email, website, gallery)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING *`,
      [userId, name, description, about, service_type, other_service, state, city, rate, email, website, galleryJson]
    );

    res.status(201).json(result.rows[0]);
  })
);

//-------------Get All Freelance Services (public)-----------------
app.get(
  "/freelance-services",
  asyncHandler(async (_req: Request, res: Response) => {
    const result = await query(
      `SELECT fs.id, fs.member_id, fs.name, fs.description, fs.about, fs.service_type, fs.other_service, fs.state, fs.city, fs.rate, fs.email, fs.website, fs.gallery, fs.created_at, fs.updated_at,
              u.photo_url AS profile_photo
       FROM freelance_services fs
       LEFT JOIN users u ON fs.member_id = u.id
       ORDER BY fs.created_at DESC`
    );

    const services = result.rows.map((r) => ({
      ...r,
      gallery: r.gallery ? JSON.parse(r.gallery) : [],
    }));

    res.json(services);
  })
);

//--------get services dropdown list
app.get(
  "/service-types",
  asyncHandler(async (_req: Request, res: Response) => {
    const result = await query("SELECT id, name FROM service_types ORDER BY name");
    res.json(result.rows);
  })
);

//--------Get Current User's Freelance Services so users can handle thier own listing----------------
app.get(
  "/freelance-services/mine",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.userId;

    const result = await query(
      `SELECT fs.*, u.photo_url AS profile_photo
       FROM freelance_services fs
       JOIN users u ON fs.member_id = u.id
       WHERE fs.member_id = $1
       ORDER BY fs.created_at DESC`,
      [userId]
    );

    const services = result.rows.map((r) => ({
      ...r,
      gallery: r.gallery ? JSON.parse(r.gallery) : [],
    }));

    res.json(services);
  })
);


//-------------Update Freelance Service (owner only)-----------------
//------------- Update Freelance Service (owner only) -------------
app.put(
  "/freelance-services/:id",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.userId;
    const isAdmin = req.user?.isAdmin;

    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid service ID" });

    // Verify ownership or admin
    const serviceResult = await query("SELECT * FROM freelance_services WHERE id = $1", [id]);
    if (serviceResult.rows.length === 0) return res.status(404).json({ error: "Service not found" });

    if (serviceResult.rows[0].member_id !== userId && !isAdmin) {
      return res.status(403).json({ error: "Forbidden: Not your service" });
    }

    const {
      name,
      description,
      about,
      service_type,
      other_service, // New field added here
      state,
      city,
      location,
      rate,
      email,
      website,
      gallery,
    } = req.body;

    if (!name) return res.status(400).json({ error: "Service name is required" });

    const galleryJson = gallery ? JSON.stringify(gallery) : null;

    await query(
      `UPDATE freelance_services SET
        name=$1,
        description=$2,
        about=$3,
        service_type=$4,
        other_service=$5,
        state=$6,
        city=$7,
        location=$8,
        rate=$9,
        email=$10,
        website=$11,
        gallery=$12,
        updated_at=NOW()
      WHERE id=$13`,
      [
        name,
        description,
        about,
        service_type,
        other_service,
        state,
        city,
        location,
        rate,
        email,
        website,
        galleryJson,
        id,
      ]
    );

    res.json({ message: "Service updated successfully" });
  })
);

//------------- Delete Freelance Service (owner only) -------------
app.delete(
  "/freelance-services/:id",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.userId;
    const isAdmin = req.user?.isAdmin;

    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid service ID" });

    // Verify ownership or admin
    const serviceResult = await query("SELECT * FROM freelance_services WHERE id = $1", [id]);
    if (serviceResult.rows.length === 0) return res.status(404).json({ error: "Service not found" });

    if (serviceResult.rows[0].member_id !== userId && !isAdmin) {
      return res.status(403).json({ error: "Forbidden: Not your service" });
    }

    await query("DELETE FROM freelance_services WHERE id = $1", [id]);

    res.json({ message: "Service deleted successfully" });
  })
);

//-----------Upload resume Page routes---------------
app.post(
  "/members/resumes",
  authenticateToken,
  uploadMemory.single("resume"),
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    if (!req.file) {
      return res.status(400).json({ error: "Resume file is required" });
    }

    try {
      // Convert buffer to base64 string with data URI prefix
      const base64Str = `data:${req.file.mimetype};base64,${req.file.buffer.toString("base64")}`;

      // Upload to Cloudinary as raw resource using base64 string
      const uploadResult = await cloudinary.uploader.upload(base64Str, {
        resource_type: "raw",
        folder: "ypropel/resumes",
      });

      //--- save reusme also in users table in resume field
      // Update user's resume URL in users table
          await query(
            `UPDATE users SET resume_url = $1 WHERE id = $2`,
             [uploadResult.secure_url, userId]
            );
//-----------

      // Fetch user profile
      const userProfileRes = await query(
        `SELECT name, email, title, university, major, experience_level, skills, company, courses_completed, country, birthdate, volunteering_work, projects_completed FROM users WHERE id = $1`,
        [userId]
      );

      if (userProfileRes.rows.length === 0) {
        return res.status(404).json({ error: "User profile not found" });
      }

      const profile = userProfileRes.rows[0];

      // Insert resume record in DB
      const insertResult = await query(
        `INSERT INTO members_resumes (
          member_id, resume_url, file_name, file_size, member_name, member_email,
          member_title, member_university, member_major, member_experience_level,
          member_skills, member_company, member_courses_completed, member_country,
          member_birthdate, member_volunteering_work, member_projects_completed
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10,
          $11, $12, $13, $14,
          $15, $16, $17
        ) RETURNING *`,
        [
          userId,
          uploadResult.secure_url,
          req.file.originalname,
          req.file.size,
          profile.name,
          profile.email,
          profile.title,
          profile.university,
          profile.major,
          profile.experience_level,
          profile.skills,
          profile.company,
          profile.courses_completed,
          profile.country,
          profile.birthdate,
          profile.volunteering_work,
          profile.projects_completed,
        ]
      );

      res.status(201).json(insertResult.rows[0]);
    } catch (error) {
      console.error("Upload resume error:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  })
);
//-------display user's resumes 
// GET /members/resumes - get all resumes for logged-in user
app.get(
  "/members/resumes",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    const result = await query(
      `SELECT id, resume_url, file_name, file_size, created_at
       FROM members_resumes
       WHERE member_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );

    res.json(result.rows);
  })
);
//-------Delete user's resumes
// DELETE /members/resumes/:id - delete a resume by ID
app.delete(
  "/members/resumes/:id",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.userId;
    const resumeId = parseInt(req.params.id, 10);

    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (isNaN(resumeId)) return res.status(400).json({ error: "Invalid resume ID" });

    // Verify resume ownership
    const resumeRes = await query(
      `SELECT member_id FROM members_resumes WHERE id = $1`,
      [resumeId]
    );
    if (resumeRes.rows.length === 0) {
      return res.status(404).json({ error: "Resume not found" });
    }
    if (resumeRes.rows[0].member_id !== userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    // Delete resume record
    await query(`DELETE FROM members_resumes WHERE id = $1`, [resumeId]);
    res.json({ message: "Resume deleted successfully" });
  })
);

//---------------HERE Starts Admin backend functions----------
//----------------------------------------------------------------------------------
//-------AdminNews Delete Route--- Delete news and updates news

app.delete("/admin/news/:id", authenticateToken, asyncHandler(async (req, res) => {
  // Check admin rights via req.user.isAdmin, no need to decode JWT again
  console.log("req.user in DELETE:", req.user);
  if (!req.user?.isAdmin) {
    return res.status(403).json({ error: "Access denied. Admins only." });
  }

  const newsId = parseInt(req.params.id);
  if (isNaN(newsId)) {
    return res.status(400).json({ error: "Invalid news ID" });
  }

  await query("DELETE FROM news WHERE id = $1", [newsId]);
  res.json({ message: "News item deleted successfully" });
}));



//------------Pre college summer programs Admin routes------------
//----Add pre-college-summer program by Admin---
// Admin-only: Add a new summer program

app.post("/admin/summer-programs", async (req: Request, res: Response) => {
  const {
    title,
    description,
    cover_photo_url,
    program_type,
    is_paid,
    price,
    location,
    program_url, // ✅ Add this line
  } = req.body;

  try {
    console.log("Backend received:", {
  title,
  cover_photo_url,
});

   await query(
  `
  INSERT INTO pre_college_summer_programs
  (title, description, program_type, cover_photo_url, is_paid, price, location, program_url)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  `,
  [title, description, program_type, cover_photo_url, is_paid, price, location, program_url]
);

    res.status(201).json({ message: "Program added successfully" });
  } catch (err) {
    console.error("Error adding program:", err);
    res.status(500).json({ error: "Server error" });
  }
});

//-------------Delete pre-college summer program by Admin------
app.delete(
  "/admin/summer-programs/:id",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user?.isAdmin) {
      return res.status(403).json({ error: "Access denied. Admins only." });
    }

    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

    await query("DELETE FROM pre_college_summer_programs WHERE id = $1", [id]);

    res.json({ message: "Summer program deleted successfully" });
  })
);


//-----------------
//----- get precollege summer program category for the Admin drop down list
app.get("/program-types", async (req: Request, res: Response) => {
  try {
    const result = await query("SELECT * FROM program_types ORDER BY name ASC");
    res.json(result.rows);
  } catch (err) {
    console.error("Failed to fetch program types", err);
    res.status(500).json({ error: "Server error" });
  }
});

//------------------------------
app.post ( 
  "/admin/program-types", 
  authenticateToken, asyncHandler (async (req: Request, res: Response)=>  { 
 
 
  const { name } = req.body;

  if (!name || !name.trim()) {
    return res.status(400).json({ error: "Type name is required" });
  }

  try {
    const result = await query(
      "INSERT INTO program_types (name) VALUES ($1) RETURNING *",
      [name.trim()]
    );
    res.status(201).json(result.rows[0]);
  } catch (err: any) {
    if (err.code === "23505") {
      return res.status(400).json({ error: "This type already exists" });
    }
    console.error("Failed to add program type", err);
    res.status(500).json({ error: "Server error" });
  }
}));

//-------------Add job fair by Admin------------------
// ✅ POST /admin/job-fairs - Add a new job fair
app.post(
  "/admin/job-fairs",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    const {
      title,
      description,
      location_state,
      location_city,
      start_datetime,
      website,
      cover_photo_url,
    } = req.body;

    const location = `${location_state} - ${location_city}`;

    if (!title || !location_state || !location_city || !start_datetime || !cover_photo_url) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    try {
      const result = await query(
        `
        INSERT INTO job_fairs
        (title, description, location, start_datetime, website, cover_image_url)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
        `,
        [title, description, location, start_datetime, website, cover_photo_url]
      );

      res.status(201).json(result.rows[0]);
    } catch (err) {
      console.error("❌ Failed to add job fair:", err);
      res.status(500).json({ error: "Server error" });
    }
  })
);

//----------------------------------------------
// ✅ GET /job-fairs - Public route
app.get("/job-fairs", async (req: Request, res: Response) => {
  try {
    const result = await query(
      "SELECT * FROM job_fairs ORDER BY start_datetime DESC"
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Failed to fetch job fairs:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.get("/us-states", async (req: Request, res: Response) => {
  try {
    const result = await query("SELECT name, abbreviation FROM us_states ORDER BY name ASC");
    // Return an array of objects: { name, abbreviation }
    res.json(result.rows);
  } catch (err) {
    console.error("Failed to fetch states:", err);
    res.status(500).json({ error: "Server error" });
  }
});


//----------Get job-fair cities for the selected states to display on the dropdown-----
app.get(
  "/us-cities",
  asyncHandler(async (req: Request, res: Response) => {
    const stateAbbreviation = (req.query.state as string)?.trim().toUpperCase();

    if (!stateAbbreviation) {
      return res.status(400).json({ error: "Missing or invalid state abbreviation" });
    }

    // Get the ID of the state by abbreviation
    const stateResult = await query(
      "SELECT id FROM us_states WHERE abbreviation = $1",
      [stateAbbreviation]
    );

    if (stateResult.rows.length === 0) {
      return res.status(404).json({ error: "State not found" });
    }

    const stateId = stateResult.rows[0].id;

    // Get cities with that state_id
    const cityResult = await query(
      "SELECT name FROM us_cities WHERE state_id = $1 ORDER BY name ASC",
      [stateId]
    );

    const cities = cityResult.rows.map((row) => row.name);
    res.json(cities);
  })
);


//---------Get countries for drop downlist 
app.get("/countries", async (req: Request, res: Response) => {
  try {
    // Select distinct countries from the us_states table (or us_cities)
    const result = await query("SELECT DISTINCT country FROM us_states ORDER BY country ASC");
    const countries = result.rows.map((r) => r.country);
    res.json(countries);
  } catch (err) {
    console.error("Failed to fetch countries:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET all mini courses (public, with optional category filter)
app.get(
  "/mini-courses",
  asyncHandler(async (req: Request, res: Response) => {
    const { category } = req.query;
    let sql = "SELECT * FROM mini_courses";
    const params: any[] = [];

    if (category) {
      sql += " WHERE category = $1";
      params.push(category);
    }

    const result = await query(sql, params);
    res.json(result.rows);
  })
);

// GET mini course by ID (public)
app.get(
  "/mini-courses/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid course ID" });

    const result = await query("SELECT * FROM mini_courses WHERE id = $1", [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Course not found" });
    }

    res.json(result.rows[0]);
  })
);

// POST create a new mini course (admin only)
app.post(
  "/mini-courses",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user?.isAdmin) return res.status(403).json({ error: "Admins only" });

    const {
      title,
      description,
      brief,               // <-- added here
      author_id,
      price,
      category,
      duration,
      content_url,
      cover_photo_url,
    } = req.body;

    if (!title) return res.status(400).json({ error: "Title is required" });

    const sql = `
      INSERT INTO mini_courses
      (title, description, brief, author_id, price, category, duration, content_url, cover_photo_url)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *;
    `;

    const values = [
      title,
      description || null,
      brief || null,        // <-- added here
      author_id || null,
      price || null,
      category || null,
      duration || null,
      content_url || null,
      cover_photo_url || null,
    ];

    const result = await query(sql, values);
    res.status(201).json(result.rows[0]);
  })
);

// PUT update a mini course (admin only)
app.put(
  "/mini-courses/:id",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user?.isAdmin) return res.status(403).json({ error: "Admins only" });

    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid course ID" });

    const existing = await query("SELECT * FROM mini_courses WHERE id = $1", [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Course not found" });
    }

    const {
      title,
      description,
      brief,               // <-- added here
      author_id,
      price,
      category,
      duration,
      content_url,
      cover_photo_url,
    } = req.body;

    const sql = `
      UPDATE mini_courses SET
        title = $1,
        description = $2,
        brief = $3,          -- <-- added here
        author_id = $4,
        price = $5,
        category = $6,
        duration = $7,
        content_url = $8,
        cover_photo_url = $9
      WHERE id = $10
      RETURNING *;
    `;

    const values = [
      title || existing.rows[0].title,
      description || existing.rows[0].description,
      brief || existing.rows[0].brief,         // <-- added here
      author_id || existing.rows[0].author_id,
      price || existing.rows[0].price,
      category || existing.rows[0].category,
      duration || existing.rows[0].duration,
      content_url || existing.rows[0].content_url,
      cover_photo_url || existing.rows[0].cover_photo_url,
      id,
    ];

    const result = await query(sql, values);
    res.json(result.rows[0]);
  })
);

// DELETE a mini course (admin only)
app.delete(
  "/mini-courses/:id",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user?.isAdmin) return res.status(403).json({ error: "Admins only" });

    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid course ID" });

    const existing = await query("SELECT * FROM mini_courses WHERE id = $1", [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Course not found" });
    }

    await query("DELETE FROM mini_courses WHERE id = $1", [id]);
    res.json({ message: "Course deleted successfully" });
  })
);

//-----------------Jobs-------------------
//-----------Job positng for Admin----------
//------------------
//------- Get all job categories for admin page cateogey drop-down list
app.get(
  "/admin/job-categories",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user?.isAdmin) return res.status(403).json({ error: "Admins only" });
    const result = await query("SELECT id, name FROM job_categories ORDER BY name");
    res.json(result.rows);
  })
);

// Add new job category to the job category dropdown list from Admin frontend
app.post(
  "/admin/job-categories",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user?.isAdmin) return res.status(403).json({ error: "Admins only" });
    const { name } = req.body;
    if (!name || name.trim() === "") return res.status(400).json({ error: "Name is required" });
    try {
      const result = await query(
        "INSERT INTO job_categories (name) VALUES ($1) RETURNING id, name",
        [name.trim()]
      );
      res.status(201).json(result.rows[0]);
    } catch (error: any) {
      if (error.code === "23505") {
        // unique_violation
        return res.status(409).json({ error: "Category already exists" });
      }
      throw error;
    }
  })
);
//--- delete job category from the admin job category drop down list
app.delete(
  "/admin/job-categories/:id",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user?.isAdmin) {
      return res.status(403).json({ error: "Admins only" });
    }

    const { id } = req.params;

    // Optionally check if category is in use before deletion

    const result = await query("DELETE FROM job_categories WHERE id = $1 RETURNING *", [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Category not found" });
    }

    res.json({ message: "Category deleted successfully" });
  })
);

//------------------

// Create job posting (admin only)
const ALLOWED_LOCATIONS = ["Remote", "Onsite", "Hybrid"];
app.post(
  "/admin/jobs",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user?.isAdmin) {
      return res.status(403).json({ error: "Admins only" });
    }

    const {
      title,
      description,
      category,
      company,
      location,
      requirements,
      apply_url,
      salary,
      is_active,
      expires_at,
        job_type,  
        country,
      state,
      city,
    } = req.body;

    const posted_by = req.user.userId;
   
    if (location && !ALLOWED_LOCATIONS.includes(location)) {
      return res.status(400).json({ error: "Invalid location value. Allowed: Remote, Onsite, Hybrid" });
    }
    // Convert empty or whitespace-only expires_at to null
    const expiresAtValue = expires_at && expires_at.trim() !== "" ? expires_at : null;

    const result = await query(
      `INSERT INTO jobs
        (title, description, category, company, location, requirements, apply_url, salary, posted_by, posted_at, is_active, expires_at, job_type, country, state, city)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,CURRENT_TIMESTAMP,$10,$11,$12,$13,$14,$15)
       RETURNING *`,
      [
        title,
        description,
        category,
        company,
        location,
        requirements,
        apply_url,
        salary,
        posted_by,
        is_active ?? true,
        expiresAtValue,
        job_type || 'entry_level',
        country,
        state,
        city,
        
      ]
    );

    res.status(201).json(result.rows[0]);
  })
);

// Admin: Get all jobs (admin only)
app.get(
  "/admin/jobs",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user?.isAdmin) {
      return res.status(403).json({ error: "Admins only" });
    }

    const result = await query(
      "SELECT * FROM jobs ORDER BY posted_at DESC"
    );

    res.json(result.rows);
  })
);
//---- edit job post by Admin only
app.put(
  "/admin/jobs/:id",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user?.isAdmin) {
      return res.status(403).json({ error: "Admins only" });
    }

    const { id } = req.params;
    const {
      title,
      description,
      category,
      company,
      location,
      requirements,
      apply_url,
      salary,
      is_active,
      expires_at,
      job_type,
      country,
      state,
      city,
    } = req.body;

     if (location && !ALLOWED_LOCATIONS.includes(location)) {
      return res.status(400).json({ error: "Invalid location value. Allowed: Remote, Onsite, Hybrid" });
    }

    // Convert empty or whitespace-only expires_at to null
    const expiresAtValue = expires_at && expires_at.trim() !== "" ? expires_at : null;

    const result = await query(
      `UPDATE jobs SET
        title=$1,
        description=$2,
        category=$3,
        company=$4,
        location=$5,
        requirements=$6,
        apply_url=$7,
        salary=$8,
        is_active=$9,
        expires_at=$10,
        job_type=$11,
        country=$12,
        state=$13,
        city=$14
      WHERE id=$15
      RETURNING *`,
      [
        title,
        description,
        category,
        company,
        location,
        requirements,
        apply_url,
        salary,
        is_active,
        expiresAtValue,
        job_type,
        country,
        state,
        city,
        id,
      ]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Job not found" });
    }

    res.json(result.rows[0]);
  })
);


// Delete job posting (admin only)
app.delete(
  "/admin/jobs/:id",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user?.isAdmin) {
      return res.status(403).json({ error: "Admins only" });
    }

    const { id } = req.params;

    const result = await query("DELETE FROM jobs WHERE id=$1 RETURNING *", [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Job not found" });
    }

    res.json({ message: "Job deleted successfully" });
  })
);

//==================== Admin upload CSV file to add jobs ==================
//------------------------- Admin only --------------------------------
// ================== Admin CSV Import: Indeed/Apify ===================
const uploadCsv = multer({ storage: multer.memoryStorage() });
function sha1(s: string) {
  return crypto.createHash("sha1").update(s).digest("hex");
}

// Very simple category guesser from title.
function categorizeTitle(title: string): string {
  const t = (title || "").toLowerCase();
  if (t.includes("software") || t.includes("developer") || t.includes("engineer")) return "Software Engineering";
  if (t.includes("data") && (t.includes("analyst") || t.includes("science"))) return "Data / Analytics";
  if (t.includes("marketing") || t.includes("growth") || t.includes("brand")) return "Marketing";
  if (t.includes("social media") || t.includes("content")) return "Social Media";
  if (t.includes("finance") || t.includes("accounting")) return "Finance";
  if (t.includes("sales") || t.includes("business development")) return "Sales";
  if (t.includes("product manager") || t.includes("product management")) return "Product Management";
  if (t.includes("design") || t.includes("ux") || t.includes("ui")) return "Design";
  if (t.includes("hr") || t.includes("recruit")) return "HR / Recruiting";
  if (t.includes("biology") || t.includes("lab") || t.includes("research")) return "Research";
  if (t.includes("intern")) return "Internship";
  return "General";
}

// Split "City, ST, Country" or similar
function splitLocation(raw: string) {
  const val = (raw || "").trim();
  if (!val) return { city: null, state: null, country: null, label: "" };
  if (/^remote$/i.test(val)) return { city: null, state: null, country: "Remote", label: "Remote" };

  const parts = val.split(",").map((p) => p.trim()).filter(Boolean);
  let city: string | null = null;
  let state: string | null = null;
  let country: string | null = null;

  if (parts.length === 3) {
    [city, state, country] = parts;
  } else if (parts.length === 2) {
    [city, state] = parts;
    if (!/^[A-Za-z]{2}$/.test(state)) {
      country = state;
      state = null;
    } else {
      country = "United States";
    }
  } else if (parts.length === 1) {
    country = parts[0];
  }

  return { city, state, country, label: val };
}

// Ensure company exists
async function getOrCreateCompanyByName(name: string, ownerUserId: number | null) {
  const nm = (name || "").trim();
  if (!nm) return { id: null as any, name: null as any };

  const existing = await query(
    `SELECT id, name FROM companies WHERE LOWER(name) = LOWER($1) LIMIT 1`,
    [nm]
  );
  if (existing?.rows?.length) return existing.rows[0];

  const ins = await query(
    `INSERT INTO companies (name, user_id, created_at) VALUES ($1, $2, NOW()) RETURNING id, name`,
    [nm, ownerUserId]
  );
  return ins.rows[0];
}

app.post(
  "/admin/import/indeed",
  authenticateToken,
  uploadCsv.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.user?.isAdmin) return res.status(403).json({ error: "Admins only" });
    if (!req.file) return res.status(400).json({ error: "CSV file is required (field name 'file')." });

    let rows: any[] = [];
    try {
      rows = parseCsv(req.file.buffer.toString("utf8"), {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      });
    } catch (err) {
      console.error("CSV parse error:", err);
      return res.status(400).json({ error: "Invalid CSV format." });
    }

    console.log(`📄 Parsed ${rows.length} rows from CSV.`);
    if (rows[0]) {
      console.log("🔎 First row keys:", Object.keys(rows[0]));
      console.log("🔎 First row sample:", rows[0]);
    }

    let inserted = 0;
    let skippedExisting = 0;
    let failed = 0;
    const failReasons: Array<{ row: any; reason: string }> = [];

    let rowIndex = 0;
    for (const originalRow of rows) {
      rowIndex++;

      // 🔥 FIX: Remove BOM (﻿) from header keys
      const r: any = {};
      for (const [key, value] of Object.entries(originalRow)) {
        const cleanKey = key.replace(/^\uFEFF/, ""); // strip BOM
        r[cleanKey] = value;
      }

      try {
        const title = (r["positionName"] || r["title"] || "").toString().trim();
        const companyName = (r["company"] || "").toString().trim();
        const applyUrl = (r["externalApplyLink"] || r["apply_url"] || r["url"] || "").toString().trim();
        const internshipFlagRaw = (r["jobType/1"] ?? "").toString().toLowerCase();
        const locationRaw = (r["location"] || "").toString().trim();
        const salary = (r["salary"] || "").toString().trim();
        const postedAtRaw = (r["postedAt"] || "").toString().trim();
        const isExpiredRaw = (r["isExpired"] || "").toString().toLowerCase();

        console.log(`\n----- Row ${rowIndex} -----`);
        console.log("cleaned row:", r);
        console.log("derived fields:", {
          title,
          companyName,
          applyUrl,
          internshipFlagRaw,
          locationRaw,
          salary,
          postedAtRaw,
          isExpiredRaw,
        });

        // Required fields
        if (!title || !applyUrl) {
          console.log(`⏭️  Row ${rowIndex} FAILED: missing title or applyUrl`);
          failed++;
          failReasons.push({ row: r, reason: "Missing required title/applyUrl" });
          continue;
        }

        // dedupe logic
        const sourceJobId = sha1(`${title}::${companyName}::${applyUrl}`);
        const check = await query(
          `SELECT 1 FROM jobs WHERE source_job_id = $1 OR apply_url = $2 LIMIT 1`,
          [sourceJobId, applyUrl]
        );

        if (check?.rows?.length) {
          console.log(`⏭️  Row ${rowIndex} SKIPPED: duplicate job`);
          skippedExisting++;
          continue;
        }

        // detect job type
        let job_type: "internship" | "entry_level" | "hourly" = "entry_level";
        if (["true", "1", "yes", "internship"].includes(internshipFlagRaw)) job_type = "internship";
        const tLower = title.toLowerCase();
        if (job_type !== "internship") {
          if (tLower.includes("intern")) job_type = "internship";
          else if (tLower.includes("hourly")) job_type = "hourly";
        }

        // active/expired
        const is_active = !["true", "1", "yes"].includes(isExpiredRaw);

        // posted_at parsing
        let posted_at: Date = new Date();
        const tryDate = Date.parse(postedAtRaw);
        if (!Number.isNaN(tryDate)) posted_at = new Date(tryDate);

        // location split
        const { city, state, country, label } = splitLocation(locationRaw);
        const locationLabel = label || (job_type === "hourly" ? "Onsite" : "Remote");

        // category
        const category = categorizeTitle(title);

        // ensure company
        const company = await getOrCreateCompanyByName(companyName, req.user.userId);
        const company_id = company?.id ?? null;

        console.log("🟢 Inserting job:", {
          title,
          companyName,
          applyUrl,
          job_type,
          posted_at,
          is_active,
        });

        await query(
          `INSERT INTO jobs
            (title, description, category, company, location, requirements, apply_url,
             posted_by, posted_at, is_active, expires_at, salary, job_type,
             country, state, city, source_job_id, status, company_id, plan_type, is_featured)
           VALUES
            ($1, $2, $3, $4, $5, $6, $7,
             $8, $9, $10, NOW() + INTERVAL '30 days', $11, $12,
             $13, $14, $15, $16, 'published', $17, 'free', FALSE)`,
          [
            title,
            r["description"] || r["full_description"] || null,
            category,
            companyName || null,
            locationLabel,
            null, // requirements
            applyUrl,
            req.user!.userId,
            posted_at,
            is_active,
            salary || null,
            job_type,
            country || (locationLabel === "Remote" ? "United States" : null),
            state || null,
            city || null,
            sourceJobId,
            company_id,
          ]
        );

        inserted++;
        console.log(`✅ Row ${rowIndex}: INSERTED`);
      } catch (err: any) {
        console.error(`❌ Row ${rowIndex} import failed:`, err?.message || err);
        failed++;
        failReasons.push({ row: r, reason: err?.message || "unknown" });
      }
    }

    console.log(`\n=== IMPORT SUMMARY ===`);
    console.log("Inserted:", inserted);
    console.log("SkippedExisting:", skippedExisting);
    console.log("Failed:", failed);
    console.log("======================\n");

    return res.json({ success: true, inserted, skippedExisting, failed, total: rows.length, failReasons });
  })
);
// ================== end CSV Import ===================================

//======================================================================

//-------------- Public route get all job liting to users -------------------
app.get(
  "/jobs",
  asyncHandler(async (req: Request, res: Response) => {
    const { job_type, country, state, city, category } = req.query;

    let queryStr = `
      SELECT jobs.* 
      FROM jobs
      LEFT JOIN us_states ON jobs.state = us_states.abbreviation
      WHERE jobs.is_active = TRUE
    `;
    const params: any[] = [];

    if (job_type) {
      params.push(job_type);
      queryStr += ` AND jobs.job_type = $${params.length}`;
    }
    if (country) {
      params.push(country);
      queryStr += ` AND jobs.country = $${params.length}`;
    }
    if (state) {
  params.push(state); // for jobs.state
  params.push(state); // for us_states.name
  const stateParam1 = params.length - 1; // index of first param (jobs.state)
  const stateParam2 = params.length;     // index of second param (us_states.name)
  queryStr += ` AND (jobs.state = $${stateParam1} OR LOWER(us_states.name) = LOWER($${stateParam2}))`;
}
    if (city) {
  let cityStr = "";
  if (typeof city === "string") {
    cityStr = city.toLowerCase();
  }
  params.push(cityStr);
  queryStr += ` AND LOWER(jobs.city) = $${params.length}`;
}
    if (category) {
      params.push(category);
      queryStr += ` AND jobs.category = $${params.length}`;
    }

    queryStr += " ORDER BY jobs.posted_at DESC";

    const result = await query(queryStr, params);
    res.json(result.rows);
  })
);
//--------get single job detials page
// ---- Public route: get ONE job by id
app.get(
  "/jobs/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: "Invalid job id" });
    }

    const sql = `
      SELECT jobs.*, us_states.name AS state_name
      FROM jobs
      LEFT JOIN us_states ON jobs.state = us_states.abbreviation
      WHERE jobs.is_active = TRUE AND jobs.id = $1
      LIMIT 1
    `;
    const result = await query(sql, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Job not found" });
    }
    return res.json(result.rows[0]);
  })
);

//--------get job categories for the fitler drop down for public 
app.get(
  "/job-categories",
  asyncHandler(async (req: Request, res: Response) => {
    const result = await query("SELECT id, name FROM job_categories ORDER BY name");
    res.json(result.rows);
  })
);


//---------------------
//----------Delete Job Fairs by Admin
app.delete(
  "/admin/job-fairs/:id",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user?.isAdmin) {
      return res.status(403).json({ error: "Admins only" });
    }

    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

    try {
      await query("DELETE FROM job_fairs WHERE id = $1", [id]);
      res.json({ message: "Job fair deleted successfully" });
    } catch (err) {
      console.error("Failed to delete job fair:", err);
      res.status(500).json({ error: "Server error" });
    }
  })
);

//--------------------------------------
//-------Add articles by Admin backend


app.get(
  "/admin/articles",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user?.isAdmin) {
      return res.status(403).json({ error: "Admins only" });
    }

    const result = await query(
      "SELECT id, title, content, cover_image, author_id, published_at FROM articles ORDER BY published_at DESC"
    );

    res.json(result.rows);
  })
);

//------  Admin post articles
//-- before new edit profile non - but orignal missed
app.post(
  "/admin/articles",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user?.isAdmin) {
      return res.status(403).json({ error: "Admins only" });
    }

    const { title, content, cover_image } = req.body;

    if (!title || !content) {
      return res.status(400).json({ error: "Title and content are required" });
    }

    const result = await query(
      `INSERT INTO articles (title, content, cover_image, author_id, published_at)
       VALUES ($1, $2, $3, $4, NOW()) RETURNING *`,
      [title, content, cover_image || null, req.user.userId]
    );

    res.status(201).json(result.rows[0]);
  })
);


//----- importentry level jobs route-(main route code is in AdminRoutes.tsx-
//app.use("/admin", adminBackendRouter);


//--------Add added articles lists to admin page so they can edit and delete


app.put(
  "/admin/articles/:id",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    const articleId = parseInt(req.params.id);
    if (isNaN(articleId)) {
      return res.status(400).json({ error: "Invalid article ID" });
    }

    const { title, content, cover_image } = req.body;

    if (!req.user?.isAdmin) {
      return res.status(403).json({ error: "Admins only" });
    }

    if (!title || !content) {
      return res.status(400).json({ error: "Title and content are required" });
    }

    await query(
      `UPDATE articles
       SET title = $1, content = $2, cover_image = $3, updated_at = NOW()
       WHERE id = $4`,
      [title, content, cover_image || null, articleId]
    );

    res.json({ message: "✅ Article updated successfully" });
  })
);


app.delete(
  "/admin/articles/:id",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    const articleId = parseInt(req.params.id);
    if (isNaN(articleId)) {
      return res.status(400).json({ error: "Invalid article ID" });
    }

    if (!req.user?.isAdmin) {
      return res.status(403).json({ error: "Admins only" });
    }

    await query("DELETE FROM articles WHERE id = $1", [articleId]);

    res.json({ message: "✅ Article deleted successfully" });
  })
);



//-------Get articles grid  for articles page for frontend
app.get(
  "/articles",
  asyncHandler(async (req: Request, res: Response) => {
    const result = await query(`
      SELECT 
        a.id, 
        a.title, 
        a.cover_image, 
        a.content,
        COALESCE(l.likes_count, 0) AS total_likes
      FROM articles a
      LEFT JOIN (
        SELECT article_id, COUNT(*) AS likes_count
        FROM article_likes
        GROUP BY article_id
      ) l ON a.id = l.article_id
      ORDER BY a.published_at DESC
    `);
    res.json(result.rows);
  })
);



//----------Get and display individual  article page
// GET /articles — Get all published articles

app.get("/articles/:id", asyncHandler(async (req: Request, res: Response) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) {
    return res.status(400).json({ error: "Invalid ID" });
  }

  const result = await query("SELECT * FROM articles WHERE id = $1", [id]);
  if (result.rows.length === 0) {
    return res.status(404).json({ error: "Article not found" });
  }

  res.json(result.rows[0]);
}));
//-------routes to add like button to articles---
// POST /articles/:id/like - Like an article
app.post('/articles/:id/like', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  const articleId = parseInt(req.params.id);
  const userId = req.user!.userId;

  // Insert like if not already liked
  await query(
    `INSERT INTO article_likes (article_id, user_id)
     VALUES ($1, $2)
     ON CONFLICT (article_id, user_id) DO NOTHING`,
    [articleId, userId]
  );

  res.json({ success: true });
}));

// DELETE /articles/:id/like - Unlike an article
app.delete('/articles/:id/like', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  const articleId = parseInt(req.params.id);
  const userId = req.user!.userId;

  await query(
    `DELETE FROM article_likes WHERE article_id = $1 AND user_id = $2`,
    [articleId, userId]
  );

  res.json({ success: true });
}));

// GET /articles/:id/likes - Get total likes count and whether current user liked
app.get('/articles/:id/likes', authenticateToken, asyncHandler(async (req: Request, res: Response) => {
  const articleId = parseInt(req.params.id);
  const userId = req.user!.userId;

  const totalLikesResult = await query(
    `SELECT COUNT(*) AS total FROM article_likes WHERE article_id = $1`,
    [articleId]
  );

  const userLikedResult = await query(
    `SELECT 1 FROM article_likes WHERE article_id = $1 AND user_id = $2`,
    [articleId, userId]
  );

  res.json({
    totalLikes: parseInt(totalLikesResult.rows[0].total, 10),
    userLiked: userLikedResult.rows.length > 0,
  });
}));


//------------------------------------------------------------------
//======================= Admin Reports routes =====================

app.get(
  "/reports/members/new",
  authenticateToken,
  asyncHandler(async (req, res) => {
      //--Check if is-admin
    if (!req.user?.isAdmin) {
      return res.status(403).json({ error: "Access denied. Admins only." });
    }

    const date = req.query.date as string;
    if (!date) return res.status(400).json({ error: "Date is required" });

    // Count new users who signed up on that date (using created_at timestamp with date range)
    const result = await query(
      `SELECT COUNT(*) FROM users 
       WHERE created_at >= $1::date AND created_at < ($1::date + INTERVAL '1 day')`,
      [date]
    );
    const newMembersCount = parseInt(result.rows[0].count, 10);
    res.json({ newMembersCount });
  })
);

/*app.get(
  "/reports/visitors",
  authenticateToken,
  asyncHandler(async (req, res) => {
    if (!req.user?.isAdmin) {
      return res.status(403).json({ error: "Access denied. Admins only." });
    }

    const date = req.query.date as string;
    if (!date) return res.status(400).json({ error: "Date is required" });

    // Total visits from members
    const visitorsFromMembersResult = await query(
      `SELECT COUNT(*) AS count 
       FROM visitors
       WHERE visit_date >= $1::date AND visit_date < ($1::date + INTERVAL '1 day')
         AND user_id IS NOT NULL`,
      [date]
    );

    // Total visits from guests
    const visitorsFromGuestsResult = await query(
      `SELECT COUNT(*) AS count 
       FROM visitors
       WHERE visit_date >= $1::date AND visit_date < ($1::date + INTERVAL '1 day')
         AND user_id IS NULL`,
      [date]
    );

    // Unique member visits
    const uniqueMemberVisitsResult = await query(
      `SELECT COUNT(DISTINCT user_id) AS unique_count 
       FROM visitors
       WHERE visit_date >= $1::date AND visit_date < ($1::date + INTERVAL '1 day')
         AND user_id IS NOT NULL`,
      [date]
    );

    // Unique guest visits - assuming you log 'ip_address' or similar for guests
    const uniqueGuestVisitsResult = await query(
      `SELECT COUNT(DISTINCT ip_address) AS unique_guest_count
       FROM visitors
       WHERE visit_date >= $1::date AND visit_date < ($1::date + INTERVAL '1 day')
         AND user_id IS NULL`,
      [date]
    );

    res.json({
      visitorsFromMembers: Number(visitorsFromMembersResult.rows[0].count) || 0,
      visitorsFromGuests: Number(visitorsFromGuestsResult.rows[0].count) || 0,
      uniqueMemberVisits: Number(uniqueMemberVisitsResult.rows[0].unique_count) || 0,
      uniqueGuestVisits: Number(uniqueGuestVisitsResult.rows[0].unique_guest_count) || 0, // new field
    });
  })
); */
app.get(
  "/reports/visitors",
  authenticateToken,
  asyncHandler(async (req, res) => {
    if (!req.user?.isAdmin) {
      return res.status(403).json({ error: "Access denied. Admins only." });
    }

    const { date, from, to } = req.query as { date?: string; from?: string; to?: string };

    let where = "";
    let params: any[] = [];

    if (date) {
      where = "visit_date = $1::date";
      params = [date];
    } else if (from || to) {
      where = `
        visit_date >= COALESCE($1::date, (now() - interval '30 days')::date)
        AND visit_date <= COALESCE($2::date, now()::date)
      `;
      params = [from || null, to || null];
    } else {
      where = "visit_date >= (now() - interval '30 days')::date";
      params = [];
    }

    const visitorsFromMembers = await query(
      `SELECT COUNT(*)::int AS count
       FROM visitors
       WHERE ${where} AND user_id IS NOT NULL`,
      params
    );

    const visitorsFromGuests = await query(
      `SELECT COUNT(*)::int AS count
       FROM visitors
       WHERE ${where} AND user_id IS NULL`,
      params
    );

    const uniqueMemberVisits = await query(
      `SELECT COUNT(DISTINCT user_id)::int AS unique_count
       FROM visitors
       WHERE ${where} AND user_id IS NOT NULL`,
      params
    );

    const uniqueGuestVisits = await query(
      `SELECT COUNT(DISTINCT ip_address)::int AS unique_guest_count
       FROM visitors
       WHERE ${where} AND user_id IS NULL`,
      params
    );

    // Guests only — per-URL totals + unique IPs
    const topGuestUrls = await query(
      `SELECT
          COALESCE(page_url,'/') AS page_url,
          COUNT(*)::int AS total_visits,
          COUNT(DISTINCT ip_address)::int AS unique_guest_visits
       FROM visitors
       WHERE ${where} AND user_id IS NULL
       GROUP BY COALESCE(page_url,'/')
       ORDER BY unique_guest_visits DESC, total_visits DESC
       LIMIT 100`,
      params
    );

    res.json({
      visitorsFromMembers: visitorsFromMembers.rows[0]?.count ?? 0,
      visitorsFromGuests:  visitorsFromGuests.rows[0]?.count ?? 0,
      uniqueMemberVisits:  uniqueMemberVisits.rows[0]?.unique_count ?? 0,
      uniqueGuestVisits:   uniqueGuestVisits.rows[0]?.unique_guest_count ?? 0,
      topGuestUrls:        topGuestUrls.rows, // [{ page_url, total_visits, unique_guest_visits }]
    });
  })
);


// -------------------------

app.get(
  "/reports/members",
  authenticateToken,
  asyncHandler(async (req, res) => {
    if (!req.user?.isAdmin) {
      return res.status(403).json({ error: "Access denied. Admins only." });
    }

    const { date, from, to } = req.query as {
      date?: string;
      from?: string;
      to?: string;
    };

    // ---- 1) Total members (all-time) ----
    const countResult = await query("SELECT COUNT(*)::int AS cnt FROM users");
    const totalMembers = countResult.rows[0]?.cnt ?? 0;

    // ---- 2) New members in selected day or range ----
    let newWhere = "";
    let newParams: any[] = [];
    if (date) {
      newWhere = "created_at::date = $1::date";
      newParams = [date];
    } else if (from || to) {
      newWhere = `
        created_at::date >= COALESCE($1::date, (now() - interval '30 days')::date)
        AND created_at::date <= COALESCE($2::date, now()::date)
      `;
      newParams = [from || null, to || null];
    } else {
      // default last 30 days
      newWhere = "created_at >= (now() - interval '30 days')";
      newParams = [];
    }

    const newMembersSql = `SELECT COUNT(*)::int AS cnt FROM users WHERE ${newWhere}`;
    const newMembersResult = await query(newMembersSql, newParams);
    const newMembersCount = newMembersResult.rows[0]?.cnt ?? 0;

    // ---- 3) Members list ordered by newest sign-up first (all-time) ----
    // (If you prefer to filter this list by the selected range, replace WHERE TRUE with newWhere and pass newParams)
    const membersResult = await query(
      `SELECT id, name, email, created_at
       FROM users
       WHERE TRUE
       ORDER BY created_at DESC NULLS LAST`,
      []
    );

    res.json({
      totalMembers,
      newMembersCount,           // <— added field
      members: membersResult.rows,
    });
  })
);

//---------------Companies and Jobs posts reports------------------
// ====================== COMPANIES: DAILY CREATED ======================
app.get(
  "/reports/companies/daily",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user?.isAdmin) {
      return res.status(403).json({ error: "Access denied. Admins only." });
    }

    const { from, to } = req.query;

    const sql = `
      SELECT
        date_trunc('day', created_at)::date AS day,
        COUNT(*)::int                       AS companies
      FROM companies
      WHERE created_at::date >= COALESCE($1::date, (now() - interval '30 days')::date)
        AND created_at::date <= COALESCE($2::date, now()::date)
      GROUP BY 1
      ORDER BY 1 ASC
    `;

    const result = await query(sql, [from || null, to || null]);
    res.json(result.rows);
  })
);


// ====================== HELPERS (paid vs free CASE) ======================
const paidCase = `
  CASE
    WHEN (COALESCE(NULLIF(TRIM(LOWER(j.plan_type)), ''), 'free') <> 'free')
      OR (j.is_featured IS TRUE)
    THEN 1 ELSE 0
  END
`;

// NOTE: jobs considered only if active and within [from,to] by posted_at
const jobsDateFilter = `
  j.is_active IS TRUE
  AND j.posted_at::date >= COALESCE($1::date, (now() - interval '30 days')::date)
  AND j.posted_at::date <= COALESCE($2::date, now()::date)
`;


// ====================== JOBS Report: PER COMPANY (FREE vs PAID) ======================
app.get(
  "/reports/companies/jobs-by-company",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user?.isAdmin) {
      return res.status(403).json({ error: "Access denied. Admins only." });
    }

    // UPDATE your existing /reports/companies/jobs-by-company handler body:
const { from, to, q } = req.query;

const nameFilter = q ? `AND c.name ILIKE '%' || $3 || '%'` : ``;

const sql = `
  SELECT
    c.id                                   AS company_id,
    c.name                                 AS company_name,
    COUNT(*)::int                          AS total_jobs,
    SUM(${paidCase})::int                  AS paid_jobs,
    SUM(1 - ${paidCase})::int              AS free_jobs,
    MIN(j.posted_at)                       AS first_job_posted_at,
    MAX(j.posted_at)                       AS last_job_posted_at,
    COALESCE(cjl.free_jobs_used, 0)::int   AS free_jobs_used_total
  FROM jobs j
  JOIN companies c ON c.id = j.company_id
  LEFT JOIN company_job_limit cjl ON cjl.company_id = c.id
  WHERE ${jobsDateFilter}
  ${nameFilter}
  GROUP BY c.id, c.name, cjl.free_jobs_used
  ORDER BY total_jobs DESC, paid_jobs DESC
`;

const params: any[] = [from || null, to || null];
if (q) params.push(q);
const result = await query(sql, params);
res.json(result.rows);

  })
);


// ======================Companies JOBS: DAILY SPLIT report (TOTAL / FREE / PAID) ======================
app.get(
  "/reports/companies/jobs-daily",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user?.isAdmin) {
      return res.status(403).json({ error: "Access denied. Admins only." });
    }

    const { from, to } = req.query;

    const sql = `
      SELECT
        date_trunc('day', j.posted_at)::date AS day,
        COUNT(*)::int                        AS total_jobs,
        SUM(${paidCase})::int                AS paid_jobs,
        SUM(1 - ${paidCase})::int            AS free_jobs
      FROM jobs j
      WHERE ${jobsDateFilter}
      GROUP BY 1
      ORDER BY 1 ASC
    `;

    const result = await query(sql, [from || null, to || null]);
    res.json(result.rows);
  })
);


// ===== SUMMARY: companies & jobs (admin vs non-admin) within [from,to] + ALL-TIME COMPANY TOTALS =====
app.get(
  "/reports/companies/summary",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user?.isAdmin) {
      return res.status(403).json({ error: "Access denied. Admins only." });
    }

    const { from, to } = req.query;

    // Treat NULL dates as "today" so rows aren't dropped by the range filter.
    const companiesDateExpr = `COALESCE(c.created_at::date, now()::date)`;
    const jobsDateExpr      = `COALESCE(j.posted_at::date, now()::date)`;

    // "Paid" definition (your original logic).
    const paidCase = `
      CASE
        WHEN (COALESCE(NULLIF(TRIM(LOWER(j.plan_type)), ''), 'free') <> 'free')
             OR (j.is_featured IS TRUE)
        THEN 1 ELSE 0
      END
    `;

    // --- Companies summary (RANGE) ---
    const companiesRangeSql = `
      SELECT
        SUM(CASE WHEN COALESCE(u_owner.is_admin, FALSE) THEN 1 ELSE 0 END)::int AS companies_admin,
        SUM(CASE WHEN COALESCE(u_owner.is_admin, FALSE) THEN 0 ELSE 1 END)::int AS companies_non_admin
      FROM companies c
      LEFT JOIN users u_owner ON u_owner.id = c.user_id
      WHERE ${companiesDateExpr} >= COALESCE($1::date, (now() - interval '30 days')::date)
        AND ${companiesDateExpr} <= COALESCE($2::date, now()::date)
    `;

    // --- Companies summary (ALL-TIME, no date filter) ---
    const companiesAllTimeSql = `
      SELECT
        SUM(CASE WHEN COALESCE(u_owner.is_admin, FALSE) THEN 1 ELSE 0 END)::int AS companies_admin_all_time,
        SUM(CASE WHEN COALESCE(u_owner.is_admin, FALSE) THEN 0 ELSE 1 END)::int AS companies_non_admin_all_time
      FROM companies c
      LEFT JOIN users u_owner ON u_owner.id = c.user_id
    `;

    // --- Jobs summary (RANGE) ---
    // Admin job = (poster is admin) OR (company owner is admin)
    const jobsSql = `
      SELECT
        SUM(CASE WHEN (COALESCE(u_poster.is_admin, FALSE) OR COALESCE(u_owner.is_admin, FALSE)) AND ${paidCase}=1 THEN 1 ELSE 0 END)::int AS paid_jobs_admin,
        SUM(CASE WHEN (COALESCE(u_poster.is_admin, FALSE) OR COALESCE(u_owner.is_admin, FALSE)) AND ${paidCase}=0 THEN 1 ELSE 0 END)::int AS free_jobs_admin,
        SUM(CASE WHEN NOT (COALESCE(u_poster.is_admin, FALSE) OR COALESCE(u_owner.is_admin, FALSE)) AND ${paidCase}=1 THEN 1 ELSE 0 END)::int AS paid_jobs_non_admin,
        SUM(CASE WHEN NOT (COALESCE(u_poster.is_admin, FALSE) OR COALESCE(u_owner.is_admin, FALSE)) AND ${paidCase}=0 THEN 1 ELSE 0 END)::int AS free_jobs_non_admin
      FROM jobs j
      LEFT JOIN users     u_poster ON u_poster.id = j.posted_by
      LEFT JOIN companies c        ON c.id = j.company_id
      LEFT JOIN users     u_owner  ON u_owner.id = c.user_id
      WHERE ${jobsDateExpr} >= COALESCE($1::date, (now() - interval '30 days')::date)
        AND ${jobsDateExpr} <= COALESCE($2::date, now()::date)
        AND j.is_active IS TRUE
    `;

    const [companiesRangeRes, companiesAllTimeRes, jobsRes] = await Promise.all([
      query(companiesRangeSql, [from || null, to || null]),
      query(companiesAllTimeSql),
      query(jobsSql, [from || null, to || null]),
    ]);

    const cRange = companiesRangeRes.rows[0] || { companies_admin: 0, companies_non_admin: 0 };
    const cAll   = companiesAllTimeRes.rows[0] || { companies_admin_all_time: 0, companies_non_admin_all_time: 0 };
    const j      = jobsRes.rows[0] || {
      paid_jobs_admin: 0,
      free_jobs_admin: 0,
      paid_jobs_non_admin: 0,
      free_jobs_non_admin: 0,
    };

    res.json({
      // RANGE totals (respect the selected date period)
      non_admin: {
        companies_created: cRange.companies_non_admin,
        paid_jobs: j.paid_jobs_non_admin,
        free_jobs: j.free_jobs_non_admin,
      },
      admin: {
        companies_created: cRange.companies_admin,
        paid_jobs: j.paid_jobs_admin,
        free_jobs: j.free_jobs_admin,
      },
      // ALL-TIME company totals (ignore date filter) — useful to display alongside the range
      all_time_companies: {
        non_admin: cAll.companies_non_admin_all_time,
        admin:     cAll.companies_admin_all_time,
        total:     (cAll.companies_admin_all_time || 0) + (cAll.companies_non_admin_all_time || 0),
      },
    });
  })
);


//----------end of companies reports
//-------------------------------------------------------------------------
//------------------------END of Admin BackEnd routes----------------------------

//================= Amazon Affiliate YPropel shop ===================

// PUBLIC: list categories
app.get("/shop/categories", asyncHandler(async (req, res) => {
  try {
    const r = await query(`
      SELECT id, slug, name, description
      FROM shop_categories
      ORDER BY name ASC
    `);
    res.json(r.rows);
  } catch (e:any) {
    console.error("[SHOP] categories failed:", e?.message || e);
    res.status(500).json({ error: "Failed to load categories" });
  }
}));

// PUBLIC: list products by category slug
app.get("/shop/products", asyncHandler(async (req, res) => {
  const { category } = req.query; // slug
  if (!category) return res.status(400).json({ error: "category (slug) is required" });

  try {
    const r = await query(
      `
      SELECT p.id, p.title, p.note, p.price_text, p.image_url, p.affiliate_url
      FROM shop_products p
      JOIN shop_categories c ON c.id = p.category_id
      WHERE c.slug = $1
        AND p.is_active = TRUE
      ORDER BY p.created_at DESC NULLS LAST
      `,
      [String(category)]
    );
    res.json(r.rows);
  } catch (e:any) {
    console.error("[SHOP] products list failed:", e?.message || e);
    res.status(500).json({ error: "Failed to load products" });
  }
}));

// ADMIN: create product
app.post(
  "/admin/shop/products",
  authenticateToken,
  asyncHandler(async (req, res) => {
    if (!req.user?.isAdmin) {
      return res.status(403).json({ error: "Admins only" });
    }

    const { category_slug, title, note, price_text, image_url, affiliate_url } = req.body || {};
    if (!category_slug || !title || !image_url || !affiliate_url) {
      return res.status(400).json({ error: "category_slug, title, image_url, affiliate_url are required" });
    }

    try {
      const cat = await query(`SELECT id FROM shop_categories WHERE slug = $1`, [category_slug]);
      if (cat.rowCount === 0) return res.status(400).json({ error: "Invalid category_slug" });

      console.log("[SHOP] insert attempt", {
        by: req.user.userId,
        category_slug,
        title,
        has_note: !!note,
        has_price_text: !!price_text,
        image_url,
        affiliate_url,
      });

      const ins = await query(
        `
        INSERT INTO shop_products
          (category_id, title, note, price_text, image_url, affiliate_url, is_active, created_at)
        VALUES
          ($1, $2, $3, $4, $5, $6, TRUE, NOW())
        RETURNING id
        `,
        [cat.rows[0].id, title, note || null, price_text || null, image_url, affiliate_url]
      );

      console.log("[SHOP] insert OK id=", ins.rows[0].id);
      res.status(201).json({ success: true, id: ins.rows[0].id });
    } catch (e:any) {
      console.error("[SHOP] insert failed:", e?.message || e);
      res.status(500).json({ error: "Failed to create product" });
    }
  })
);

//================== End of YPropel shop Amazon ======================


//-------------------Companies Profiles and adding jobs---------------------------
//---------------------------------------------------------------------------------

// --- Create Company Profile (must be done before posting a job)
app.post(
  "/companies",
  uploadCompanyLogo.single("logo"), // Attach the logo upload middleware
  asyncHandler(async (req: Request, res: Response) => {
    const { name, description, location, industry, userId } = req.body;

    if (!name || !description || !location || !industry) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    if (!userId) {
      return res.status(400).json({ error: "User ID is required" });
    }

    // Get logo URL from uploaded file
    const logoUrl = req.file?.path || null;

    // Check if the user already has a company
    const existingCompany = await query(
      "SELECT id FROM companies WHERE user_id = $1",
      [userId]
    );

    if (existingCompany.rows.length > 0) {
      return res.status(400).json({ error: "You already have a company profile." });
    }

    try {
      const result = await query(
        `INSERT INTO companies (user_id, name, description, location, industry, logo_url, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
         RETURNING id, name, description, location, industry, logo_url`,
        [userId, name, description, location, industry, logoUrl]
      );

      const company = result.rows[0];
      res.status(201).json(company);
    } catch (error) {
      console.error("Error creating company profile:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  })
);


// GET route to fetch company details by companyId
app.get(
  "/companies/:companyId",
  asyncHandler(async (req: Request, res: Response) => {
    const { companyId } = req.params;

    try {
      const result = await query(
        `SELECT id, name, description, location, industry, logo_url,user_id, created_at, updated_at
         FROM companies WHERE id = $1`,
        [companyId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Company not found" });
      }

      const company = result.rows[0];
      res.status(200).json(company);
    } catch (error) {
      console.error("Error fetching company details:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  })
); 

// --- Delete Company Route
app.delete(
  "/companies/delete",
  asyncHandler(async (req: Request, res: Response) => {
    const { companyId, userId } = req.body; // Receive companyId and userId from the request body

    if (!companyId || !userId) {
      return res.status(400).json({ error: "Company ID and User ID are required" });
    }

    try {
      // Ensure the company belongs to the logged-in user
      const companyResult = await query(
        "SELECT id FROM companies WHERE id = $1 AND user_id = $2", 
        [companyId, userId]
      );

      if (companyResult.rows.length === 0) {
        return res.status(400).json({ error: "You do not have permission to delete this company." });
      }

      // Proceed to delete the company from the database
      await query("DELETE FROM companies WHERE id = $1", [companyId]);

      // Return a success message
      res.status(200).json({ success: true, message: "Company successfully deleted." });
    } catch (error) {
      console.error("Error deleting company:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  })
);

// --- Post a Job by a company user (linked to a company)
// --- Post a Job by a company user (linked to a company)
/*app.post(
  "/companies/post-job",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    const {
      title,
      description,
      category,
      location,
      requirements,
      applyUrl,
      salary,
      jobType,
      country,
      state,
      city,
    } = req.body;

    const posted_by = req.user.userId;

    if (!title || !description || !category || !jobType || !applyUrl || !location || !country || !state || !city) {
      return res.status(400).json({ error: "All required fields must be filled." });
    }

    const companyResult = await query(
      "SELECT id, name FROM companies WHERE user_id = $1",
      [posted_by]
    );

    if (companyResult.rows.length === 0) {
      return res.status(400).json({ error: "User is not associated with a company." });
    }

    const { id: company_id, name: companyName } = companyResult.rows[0];

    const ALLOWED_LOCATIONS = ["Remote", "Onsite", "Hybrid"];
    if (!ALLOWED_LOCATIONS.includes(location)) {
      return res.status(400).json({ error: "Invalid location value. Allowed: Remote, Onsite, Hybrid" });
    }

    // Check if the company already has an active job
    const existingJob = await query(
      "SELECT id FROM jobs WHERE company_id = $1 AND is_active = true AND expires_at > NOW()",
      [company_id]
    );

    if (existingJob.rows.length > 0) {
      return res.status(400).json({ error: "You already have an active free job posting. Please wait until it expires or switch to paid posting." });
    }

    // Set expiration to 3 days from now
    const expiresAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

    const result = await query(
      `INSERT INTO jobs
        (title, description, category, company_id, company, location, requirements, apply_url, salary, job_type, country, state, city, expires_at, is_active)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, true)
      RETURNING *`,
      [
        title,
        description,
        category,
        company_id,
        companyName,
        location,
        requirements,
        applyUrl,
        salary,
        jobType,
        country,
        state,
        city,
        expiresAt,
      ]
    );

    res.status(201).json({
      success: true,
      job: result.rows[0],
      companyId: company_id,
    });
  })
);*/

// Get all jobs posted by the company and display it on the page for user (owner)
app.get(
  "/companies/:companyId/jobs",  // Modify the route to use :companyId as a parameter
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    const { companyId } = req.params; // Get companyId from route parameters

    if (!companyId) {
      return res.status(400).json({ error: "Company ID is required" });
    }

    // Parse companyId as an integer
    const parsedCompanyId = parseInt(companyId, 10);  // Now using req.params.companyId

    if (isNaN(parsedCompanyId)) {
      return res.status(400).json({ error: "Invalid Company ID format" });
    }

    // Log to check the received companyId
    console.log("Received companyId:", parsedCompanyId);

     // ✅ Deactivate expired jobs (free or paid) before returning list
        await query(`
          UPDATE jobs
          SET is_active = false
          WHERE expires_at IS NOT NULL AND expires_at < NOW() AND is_active = true

        `);
      console.log("Deactivating expired jobs before returning company jobs...");

    // Fetch jobs for the given companyId
    const result = await query(
      "SELECT * FROM jobs WHERE company_id = $1 ORDER BY posted_at DESC",
      [parsedCompanyId] // Use parsed integer value
    );

    res.json(result.rows);
  })
); 
app.post(
  "/companies/post-job",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    const {
      title,
      description,
      category,
      location,
      requirements,
      applyUrl,
      salary,
      jobType,
      country,
      state,
      city,
      planType, // 'free', 'pay_per_post', or 'subscription'
    } = req.body;

    const posted_by = req.user.userId;

    if (!title || !description || !category || !jobType || !applyUrl || !location || !country || !state || !city || !planType) {
      return res.status(400).json({ error: "All required fields must be filled." });
    }

    const ALLOWED_PLANS = ["free", "pay_per_post", "subscription"];
    if (!ALLOWED_PLANS.includes(planType)) {
      return res.status(400).json({ error: "Invalid plan type." });
    }

    const ALLOWED_LOCATIONS = ["Remote", "Onsite", "Hybrid"];
    if (!ALLOWED_LOCATIONS.includes(location)) {
      return res.status(400).json({ error: "Invalid location value. Allowed: Remote, Onsite, Hybrid" });
    }

    // Get company info
    const companyResult = await query("SELECT id, name FROM companies WHERE user_id = $1", [posted_by]);
    if (companyResult.rows.length === 0) {
      return res.status(400).json({ error: "User is not associated with a company." });
    }
    const { id: company_id, name: companyName } = companyResult.rows[0];

    // Fetch company premium status from users table
    const userResult = await query(
      "SELECT is_company_premium FROM users WHERE id = $1",
      [posted_by]
    );
    const isCompanyPremium = userResult.rows[0]?.is_company_premium ?? false;

    // Restrict free plan to only one active job if NOT premium
    if (planType === "free" && !isCompanyPremium) {
      const existingJob = await query(
        "SELECT id FROM jobs WHERE company_id = $1 AND is_active = true AND plan_type = 'free'",
        [company_id]
      );
      if (existingJob.rows.length > 0) {
        return res.status(400).json({
          error:
            "You can have only one active free job post under the free plan. Delete current post or switch to paid plan.",
        });
      }
    }

    // Set expiration based on plan type
    let expiresAt: Date | null = null;
    const now = new Date();

    if (planType === "free") {
      expiresAt = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000); // 2 days
    } else if (planType === "pay_per_post") {
      expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days
    } else if (planType === "subscription") {
      expiresAt = null; // No expiration for subscription jobs
    }

    try {
      const result = await query(
        `INSERT INTO jobs
          (title, description, category, company_id, company, location, requirements, apply_url, salary, job_type, country, state, city, expires_at, is_active, plan_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, true, $15)
         RETURNING *`,
        [
          title,
          description,
          category,
          company_id,
          companyName,
          location,
          requirements,
          applyUrl,
          salary,
          jobType,
          country,
          state,
          city,
          expiresAt,
          planType,
        ]
      );

      res.status(201).json({
        success: true,
        job: result.rows[0],
        companyId: company_id,
      });
    } catch (error) {
      console.error("Error creating job:", error);
      res.status(500).json({ error: "Internal Server Error" });
    }
  })
);


app.delete(
  "/companies/jobs/:jobId",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    if (!req.user) {
      return res.status(401).json({ error: "User not authenticated" });
    }

    const { jobId } = req.params;  // Get jobId from the request parameters

    console.log("Deleting job with ID:", jobId);  // Log jobId for debugging

    // Ensure the job belongs to the logged-in user's company
    const companyResult = await query(
      "SELECT company_id FROM jobs WHERE id = $1",
      [jobId]
    );

    if (companyResult.rows.length === 0) {
      return res.status(404).json({ error: "Job not found" });
    }

    const companyId = companyResult.rows[0].company_id;

    console.log("Company ID associated with the job:", companyId); // Log the companyId for debugging

    // Ensure the user is authorized to delete the job
    const userCompanyResult = await query(
      "SELECT id AS company_id FROM companies WHERE user_id = $1",
      [req.user.userId]
    );

    if (userCompanyResult.rows.length === 0 || userCompanyResult.rows[0].company_id !== companyId) {
      return res.status(403).json({ error: "User is not authorized to delete this job" });
    }

    // Delete the job
    await query(
      "DELETE FROM jobs WHERE id = $1",
      [jobId]
    );

    res.status(200).json({ message: "Job deleted successfully" });
  })
);

//------Route to display all companies profiles to users (public)

app.get(
  "/companies",
  asyncHandler(async (req: Request, res: Response) => {
    try {
      const result = await query(
        `SELECT id, name, industry, location, description, logo_url FROM companies ORDER BY created_at DESC`
      );
      res.status(200).json(result.rows);
    } catch (error) {
      console.error("Error fetching companies:", error);
      res.status(500).json({ error: "Internal server error" });
    }
  })
);
//-------Payment for jobs ---------
//----------allow company users pay per job post
app.post(
  "/payment/create-checkout-session",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "YPropel Pay-Per-Post Job Plan",
              description: "One-time featured job post with 30-day visibility",
            },
            unit_amount: 7500, // $75.00 in cents
          },
          quantity: 1,
        },
      ],
      success_url: `https://www.ypropel.com/payment/success`,
      cancel_url: `https://www.ypropel.com/payment/cancel`,
    });

    res.json({ url: session.url });
  })
);
//-------------allow companies to subscribe to premium package-
app.post(
  "/payment/create-subscription-checkout-session",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req.user as { userId: number }).userId;

    const userResult = await query("SELECT email, company_subscription_id FROM users WHERE id = $1", [userId]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const customerEmail = userResult.rows[0].email;
    let stripeCustomerId = userResult.rows[0].stripe_customer_id;

    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({ email: customerEmail });
      stripeCustomerId = customer.id;
      await query("UPDATE users SET stripe_customer_id = $1 WHERE id = $2", [stripeCustomerId, userId]);
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      customer: stripeCustomerId,
      line_items: [
        {
          price: process.env.STRIPE_SUBSCRIPTION_PRICE_ID!,
          quantity: 1,
        },
      ],
      subscription_data: {
        metadata: {
          userId: userId.toString(),
          subscriptionType: "company",
        },
      },
      success_url: "https://www.ypropel.com/subscription-success",
      cancel_url: "https://www.ypropel.com/postjob",
    });

    res.json({ url: session.url });
  })
);


app.post(
  "/users/set-company-premium",
  authenticateToken, // checks JWT, populates req.user
  asyncHandler(async (req, res) => {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const result = await query(
      "UPDATE users SET is_company_premium = TRUE WHERE id = $1 RETURNING id, is_company_premium",
      [userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({ success: true, user: result.rows[0] });
  })
);

//--------allow companies to cancel premium subscriptions
app.post(
  "/payment/cancel-subscription",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });

    // Find the Stripe subscription ID for this user’s company subscription
    const userResult = await query(
      "SELECT company_subscription_id FROM users WHERE id = $1",
      [userId]
    );

    if (userResult.rows.length === 0 || !userResult.rows[0].company_subscription_id) {
      return res.status(404).json({ error: "Company subscription not found" });
    }

    const subscriptionId = userResult.rows[0].company_subscription_id;

    try {
      // Cancel subscription immediately at Stripe
      await stripe.subscriptions.del(subscriptionId);

      // Update user in DB: clear company subscription info and unset is_company_premium
      await query(
        `UPDATE users
         SET company_subscription_id = NULL,
             company_subscription_status = NULL,
             is_company_premium = FALSE
         WHERE id = $1`,
        [userId]
      );

      res.json({ message: "Company subscription canceled successfully" });
    } catch (error) {
      console.error("Error canceling company subscription:", error);
      res.status(500).json({ error: "Failed to cancel company subscription" });
    }
  })
);
//--------------end of companies profiles routes----------------
//-------------------------------------------------
//------Routes for students (Members) subscriptions (Premium)-------------------------

app.post(
  "/payment/create-student-subscription-checkout-session",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    const userId = (req.user as { userId: number }).userId;

    // Fetch user email from DB
    const userResult = await query("SELECT email FROM users WHERE id = $1", [userId]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const customerEmail = userResult.rows[0].email;

    // Create Stripe Checkout session
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      customer_email: customerEmail,
      line_items: [
        {
          price: process.env.STRIPE_STUDENT_SUBSCRIPTION_PRICE_ID, // your Stripe Price ID for student subscription
          quantity: 1,
        },
      ],
      success_url: "https://www.ypropel.com/student-checkout-success?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "https://www.ypropel.com/student-subscription-cancel",
    });

    res.json({ url: session.url });
  })
);


//------route to confirm  students subscription payment done on stripe so make user premium
// Route to confirm payment and update user status
// Test route to create checkout session
app.post(
  "/subscriptions/create-checkout-session",
  authenticateToken,
  asyncHandler(async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });

    // Fetch existing stripe_customer_id for user
    const userResult = await query(
      "SELECT stripe_customer_id FROM users WHERE id = $1",
      [req.user.userId]
    );

    let stripeCustomerId = userResult.rows[0]?.stripe_customer_id;

    // Create Stripe customer if not exists
    if (!stripeCustomerId) {
      const customer = await stripe.customers.create({
        email: req.user.email,
        metadata: {
          userId: req.user.userId.toString(),
        },
      });
      stripeCustomerId = customer.id;

      // Save stripe_customer_id in users table
      await query(
        "UPDATE users SET stripe_customer_id = $1 WHERE id = $2",
        [stripeCustomerId, req.user.userId]
      );
    }

    // Stripe price ID from env
    const priceId = process.env.STRIPE_MINI_COURSE_PRICE_ID!;
    if (!priceId) {
      return res.status(500).json({ error: "Missing Stripe price ID configuration" });
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      customer: stripeCustomerId,
      success_url:
        "https://www.ypropel.com/student-subscribe/confirmation?session_id={CHECKOUT_SESSION_ID}",
      cancel_url: "https://www.ypropel.com/student-subscribe",
      metadata: {
        userId: req.user.userId.toString(),
        userEmail: req.user.email,
      },
    });

    res.json({ url: session.url });
  })
);
//------verify subscription for students---
app.get(
  "/subscriptions/verify-session",
  authenticateToken,
  asyncHandler(async (req, res) => {
    const sessionId = req.query.session_id as string;
    if (!sessionId) return res.status(400).json({ error: "Missing session_id" });

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status === "paid" && session.status === "complete") {
      // Optionally: Update user is_premium flag in DB here or via webhook
      return res.json({ status: "complete" });
    } else {
      return res.json({ status: "incomplete" });
    }
  })
);

// Assuming you use Express, your auth middleware sets req.user with userId

app.post(
  "/users/set-premium",
  authenticateToken, // checks JWT, populates req.user
  asyncHandler(async (req, res) => {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    // Update user in your DB, assuming you use some 'query' helper function:
    const result = await query(
      "UPDATE users SET is_premium = TRUE WHERE id = $1 RETURNING id, is_premium",
      [userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({ success: true, user: result.rows[0] });
  })
);

// Cancel Stripe subscription for students 
app.post(
  "/stripe/cancel-subscription",
  authenticateToken,
  asyncHandler(async (req: Request, res: Response) => {
    const { subscriptionId } = req.body;

    if (!subscriptionId) {
      return res.status(400).json({ error: "Subscription ID is required" });
    }

    try {
      // Cancel at period end
      const canceledSubscription = await stripe.subscriptions.update(
        subscriptionId,
        { cancel_at_period_end: true }
      );

      res.json({
        message: "Subscription cancellation scheduled",
        subscription: canceledSubscription,
      });
    } catch (error) {
      console.error("Stripe cancellation error:", error);
      res.status(500).json({ error: "Failed to cancel subscription" });
    }
  })
);

//----------End of students subscription to premium routes-----
//--------------------------------------------------------
//_____Webhook for stripe to capture subscriptions and cancelations
const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET!;

app.post(
  "/webhooks/stripe",
  express.raw({ type: "application/json" }),
  async (req: Request, res: Response) => {
    const sig = req.headers["stripe-signature"];

    if (!sig) {
      console.error("Missing Stripe signature");
      res.status(400).send("Missing Stripe signature");
      return;
    }

    let event: Stripe.Event;

    try {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    } catch (err: any) {
      console.error("Webhook signature verification failed:", err.message);
      res.status(400).send(`Webhook Error: ${err.message}`);
      return;
    }

    try {
      switch (event.type) {
        case "customer.subscription.created":
        case "customer.subscription.updated":
        case "customer.subscription.deleted":
          const subscription = event.data.object as Stripe.Subscription;
          const customerId = subscription.customer as string;

          // Lookup user by Stripe customer ID
          const userResult = await query(
            "SELECT id FROM users WHERE stripe_customer_id = $1",
            [customerId]
          );

          if (userResult.rows.length === 0) {
            console.warn(`User not found for customer ID: ${customerId}`);
            break;
          }

          const userId = userResult.rows[0].id;
          const isActive = subscription.status === "active" || subscription.status === "trialing";

          // Determine subscription type from metadata
          const subscriptionType = subscription.metadata?.subscriptionType || "student";

         if (subscriptionType === "company") {
              // Update company subscription fields
              await query(
                `UPDATE users
                  SET company_subscription_id = $1,
                      company_subscription_status = $2,
                      is_company_premium = $3
                  WHERE id = $4`,
                [subscription.id, subscription.status, isActive, userId]
              );

                  console.log(
                    `Updated company subscription for user ${userId}: subscription_id=${subscription.id}, status=${subscription.status}, is_company_premium=${isActive}`
                  );
                } else {
                  // Default: update student subscription fields
                  await query(
                    `UPDATE users
                      SET subscription_id = $1,
                          subscription_status = $2,
                          is_premium = $3
                      WHERE id = $4`,
                    [subscription.id, subscription.status, isActive, userId]
                  );

                  console.log(
                    `Updated student subscription for user ${userId}: subscription_id=${subscription.id}, status=${subscription.status}, is_premium=${isActive}`
                  );
                }
                break;

                default:
                  console.log(`Unhandled event type: ${event.type}`);
              }
            } catch (err) {
              console.error("Error processing webhook event:", err);
              res.status(500).send("Internal Server Error");
              return;
            }

            res.status(200).send("Received");
          }
        );




//---------------------------------------------------------------
//---DB check block
(async () => {
  try {
    const result = await query("SELECT current_database();");
    console.log("Connected to DB:", result.rows[0].current_database);
  } catch (err) {
    console.error("Error checking DB:", err);
  }
})();
//-------------

app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
  console.log("✅ All routes registered. Ready to receive requests.");
});
