"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const axios_1 = __importDefault(require("axios"));
const db_1 = require("../db");
const router = express_1.default.Router();
const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret_key";
// Async wrapper to catch errors
function asyncHandler(fn) {
    return function (req, res, next) {
        fn(req, res, next).catch(next);
    };
}
// Authentication middleware
function authenticateToken(req, res, next) {
    const authHeader = req.headers["authorization"];
    const token = authHeader?.split(" ")[1];
    if (!token) {
        res.status(401).json({ error: "Unauthorized: No token provided" });
        return;
    }
    jsonwebtoken_1.default.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            res.status(403).json({ error: "Forbidden: Invalid token" });
            return;
        }
        const payload = user;
        req.user = {
            userId: payload.userId,
            email: payload.email,
            isAdmin: payload.is_admin || false,
        };
        next();
    });
}
// Admin-only middleware (returns void)
function adminOnly(req, res, next) {
    if (!req.user?.isAdmin) {
        res.status(403).json({ error: "Access denied. Admins only." });
        return;
    }
    next();
}
// Protect all routes below this middleware with authentication
router.use(authenticateToken);
// Admin-only import entry-level jobs route
router.post("/import-entry-jobs", adminOnly, asyncHandler(async (req, res) => {
    const ADZUNA_APP_ID = process.env.ADZUNA_APP_ID;
    const ADZUNA_APP_KEY = process.env.ADZUNA_APP_KEY;
    const ADZUNA_COUNTRY = "us";
    const { keyword = "", location = "", page = 1 } = req.body;
    const includeKeywords = [
        "product manager",
        "software engineer",
        "data scientist",
        "data analyst",
        "developer",
        "business analyst",
        "product owner",
        "machine learning engineer",
        "ux designer",
    ];
    const excludeKeywords = [
        "cook",
        "customer support",
        "technician",
        "cashier",
        "driver",
        "security",
    ];
    function isValidJobTitle(title) {
        const lowerTitle = title.toLowerCase();
        if (excludeKeywords.some((kw) => lowerTitle.includes(kw)))
            return false;
        return includeKeywords.some((kw) => lowerTitle.includes(kw));
    }
    console.log(`Starting import with keyword='${keyword}', location='${location}', page=${page}`);
    const adzunaUrl = `https://api.adzuna.com/v1/api/jobs/${ADZUNA_COUNTRY}/search/${page}?app_id=${ADZUNA_APP_ID}&app_key=${ADZUNA_APP_KEY}&results_per_page=50&max_days_old=30&content-type=application/json${keyword ? `&what=${encodeURIComponent(keyword)}` : ""}${location ? `&where=${encodeURIComponent(location)}` : ""}`;
    const response = await axios_1.default.get(adzunaUrl);
    const jobs = response.data.results;
    console.log(`Fetched ${jobs.length} jobs from Adzuna.`);
    let insertedCount = 0;
    for (const job of jobs) {
        console.log(`Processing job: ${job.title}`);
        if (!job.title || !isValidJobTitle(job.title)) {
            console.log(`Skipped job due to invalid title: ${job.title}`);
            continue;
        }
        const existing = await (0, db_1.query)("SELECT id FROM jobs WHERE title = $1 AND company = $2 AND location = $3", [job.title, job.company?.display_name || null, job.location?.display_name || null]);
        if (existing.rows.length > 0) {
            console.log(`Job already exists: ${job.title} at ${job.company?.display_name}`);
            continue;
        }
        const loc = job.location || {};
        const city = loc.area ? loc.area[1] || null : null;
        const state = loc.area ? loc.area[2] || null : null;
        const country = loc.area ? loc.area[0] || null : null;
        try {
            await (0, db_1.query)(`INSERT INTO jobs (
            title, description, category, company, location, requirements,
            apply_url, posted_at, is_active, job_type, country, state, city
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, [
                job.title,
                job.description,
                job.category?.label || null,
                job.company?.display_name || null,
                job.location?.display_name || null,
                null,
                job.redirect_url,
                job.created,
                true,
                "entry_level",
                country,
                state,
                city,
            ]);
            insertedCount++;
            console.log(`Inserted job: ${job.title}`);
        }
        catch (error) {
            console.error(`Error inserting job ${job.title}:`, error);
        }
    }
    console.log(`Import completed. Total inserted jobs: ${insertedCount}`);
    res.json({ success: true, inserted: insertedCount });
}));
exports.default = router;
//# sourceMappingURL=index.js.map