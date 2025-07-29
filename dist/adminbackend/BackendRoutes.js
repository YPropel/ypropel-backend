"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const axios_1 = __importDefault(require("axios"));
const cheerio = require("cheerio");
const db_1 = require("../db");
const googleapis_1 = require("googleapis");
const puppeteer_1 = __importDefault(require("puppeteer"));
const rss_parser_1 = __importDefault(require("rss-parser"));
const parser = new rss_parser_1.default({
    headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; x64)...",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.5",
        "Connection": "keep-alive"
    }
});
const router = express_1.default.Router();
const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret_key";
function toSingleString(value) {
    if (!value)
        return "";
    if (Array.isArray(value))
        return value[0] || "";
    if (typeof value === "string")
        return value;
    return String(value);
}
// Helper: Infer category based on job title keywords (mapped to your job_categories)
function inferCategoryFromTitle(title) {
    if (!title)
        return null;
    const lowerTitle = title.toLowerCase();
    if (lowerTitle.includes("engineer") ||
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
        lowerTitle.includes("cloud"))
        return "Engineering";
    if (lowerTitle.includes("marketing") ||
        lowerTitle.includes("social media") ||
        lowerTitle.includes("content") ||
        lowerTitle.includes("brand") ||
        lowerTitle.includes("public relations"))
        return "Marketing";
    if (lowerTitle.includes("sales") ||
        lowerTitle.includes("business development") ||
        lowerTitle.includes("account manager"))
        return "Sales";
    if (lowerTitle.includes("designer") ||
        lowerTitle.includes("graphic") ||
        lowerTitle.includes("ux") ||
        lowerTitle.includes("ui"))
        return "Design";
    if (lowerTitle.includes("operations") ||
        lowerTitle.includes("project manager") ||
        lowerTitle.includes("logistics") ||
        lowerTitle.includes("procurement") ||
        lowerTitle.includes("supply chain"))
        return "Operations";
    if (lowerTitle.includes("customer support") ||
        lowerTitle.includes("customer service") ||
        lowerTitle.includes("customer success"))
        return "Customer Support";
    if (lowerTitle.includes("finance") ||
        lowerTitle.includes("accountant") ||
        lowerTitle.includes("controller") ||
        lowerTitle.includes("tax") ||
        lowerTitle.includes("payroll") ||
        lowerTitle.includes("analyst") ||
        lowerTitle.includes("investment"))
        return "Finance";
    if (lowerTitle.includes("human resources") ||
        lowerTitle.includes("hr") ||
        lowerTitle.includes("recruiter"))
        return "Human Resources";
    if (lowerTitle.includes("product manager") ||
        lowerTitle.includes("product owner") ||
        lowerTitle.includes("scrum master"))
        return "Product Management";
    if (lowerTitle.includes("data analyst") ||
        lowerTitle.includes("data science") ||
        lowerTitle.includes("business intelligence"))
        return "Data Science";
    return null;
}
// Map inferred category to valid categories fetched from DB
function mapCategoryToValid(inferredCategory, validCategories) {
    if (!inferredCategory)
        return null;
    const match = validCategories.find(cat => cat.toLowerCase() === inferredCategory.toLowerCase());
    return match || null;
}
// Fetch job categories from the database
async function fetchJobCategories() {
    const result = await (0, db_1.query)("SELECT name FROM job_categories");
    return result.rows.map(row => row.name);
}
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
// Admin-only middleware
function adminOnly(req, res, next) {
    if (!req.user?.isAdmin) {
        res.status(403).json({ error: "Access denied. Admins only." });
        return;
    }
    next();
}
// Protect all routes below this middleware with authentication
router.use(authenticateToken);
// ----------------- ADZUNA IMPORT -------------------
router.post("/import-entry-jobs", adminOnly, asyncHandler(async (req, res) => {
    // Your existing Adzuna import code here
}));
// ----------------- CAREERJET IMPORT -------------------
router.post("/import-careerjet-jobs", adminOnly, asyncHandler(async (req, res) => {
    // Your existing Careerjet import code here
}));
// ----------------- SIMPLYHIRED IMPORT -------------------
router.post("/import-simplyhired-jobs", adminOnly, asyncHandler(async (req, res) => {
    // Your existing SimplyHired import code here
}));
// ----------------- REDDIT IMPORT -------------------
router.post("/import-reddit-internships", adminOnly, asyncHandler(async (req, res) => {
    // Your existing Reddit import code here
}));
// ----------------- REMOTIVE IMPORT -------------------
router.post("/import-remotive-internships", adminOnly, asyncHandler(async (req, res) => {
    // Your existing Remotive import code here
}));
router.post("/import-linkedin-detailed-jobs", adminOnly, asyncHandler(async (req, res) => {
    const { emailHtml, seeAllJobsUrl } = req.body;
    let urlToFetch = seeAllJobsUrl;
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
    console.log(`Launching Puppeteer to scrape LinkedIn jobs from: ${urlToFetch}`);
    const browser = await puppeteer_1.default.launch({
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
        headless: true,
    });
    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36");
    await page.goto(urlToFetch, { waitUntil: "networkidle2" });
    await page.waitForSelector(".jobs-search-results__list", { timeout: 15000 }).catch(() => { });
    const jobs = await page.evaluate(() => {
        const jobElements = document.querySelectorAll(".jobs-search-results__list-item");
        const jobList = [];
        jobElements.forEach((jobEl) => {
            const titleEl = jobEl.querySelector("a.job-card-list__title, a.base-card__full-link");
            const companyEl = jobEl.querySelector("a.job-card-container__company-name, h4.base-search-card__subtitle");
            const locationEl = jobEl.querySelector(".job-card-container__metadata-item, span.job-search-card__location");
            const descriptionEl = jobEl.querySelector(".job-card-list__snippet, p.job-snippet, div.job-card-container__description");
            if (titleEl) {
                jobList.push({
                    title: titleEl.textContent?.trim() || "",
                    company: companyEl?.textContent?.trim() || "",
                    location: locationEl?.textContent?.trim() || "",
                    description: descriptionEl?.textContent?.trim() || "",
                    applyUrl: titleEl.getAttribute("href") || "",
                });
            }
        });
        return jobList;
    });
    await browser.close();
    console.log(`Puppeteer scraped ${jobs.length} jobs.`);
    const validCategories = await fetchJobCategories();
    let insertedCount = 0;
    for (const job of jobs) {
        try {
            const exists = await (0, db_1.query)("SELECT id FROM jobs WHERE title = $1 AND apply_url = $2", [
                job.title,
                job.applyUrl,
            ]);
            if (exists.rows.length > 0) {
                console.log(`Skipping duplicate job: ${job.title}`);
                continue;
            }
            const inferredCategoryRaw = inferCategoryFromTitle(job.title);
            const inferredCategory = mapCategoryToValid(inferredCategoryRaw, validCategories);
            console.log(`Inserting job: ${job.title} at ${job.company}`);
            await (0, db_1.query)(`INSERT INTO jobs (
            title, description, category, company, location,
            apply_url, posted_at, is_active, job_type, country, state, city
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [
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
            ]);
            insertedCount++;
        }
        catch (error) {
            console.error(`Failed to insert job ${job.title}:`, error);
        }
    }
    res.json({ message: `Imported ${insertedCount} new jobs from LinkedIn detailed.` });
}));
console.log("Registering /fetch-gmail-emails route");
router.post("/fetch-gmail-emails", authenticateToken, adminOnly, asyncHandler(async (req, res) => {
    try {
        const tokenJsonStr = process.env.GOOGLE_OAUTH_TOKEN_JSON;
        if (!tokenJsonStr) {
            return res.status(500).json({ error: "No Google OAuth token found in environment variables." });
        }
        let tokens;
        try {
            tokens = JSON.parse(tokenJsonStr);
        }
        catch (e) {
            console.error("Failed to parse GOOGLE_OAUTH_TOKEN_JSON:", e);
            return res.status(500).json({ error: "Invalid Google OAuth token JSON format." });
        }
        const oauth2Client = new googleapis_1.google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
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
        const gmail = googleapis_1.google.gmail({ version: "v1", auth: oauth2Client });
        const listResponse = await gmail.users.messages.list({
            userId: "me",
            maxResults: 10,
            q: "label:INBOX",
        });
        const messages = listResponse.data.messages || [];
        const emailData = [];
        for (const message of messages) {
            const msg = await gmail.users.messages.get({
                userId: "me",
                id: message.id,
                format: "full",
            });
            emailData.push({
                id: message.id,
                snippet: msg.data.snippet,
                payload: msg.data.payload,
                internalDate: msg.data.internalDate || null,
                threadId: msg.data.threadId || null,
            });
        }
        res.json({ emails: emailData });
    }
    catch (error) {
        console.error("Error fetching Gmail emails:", error);
        res.status(500).json({ error: "Failed to fetch Gmail emails" });
    }
}));
router.post("/import-wayup-detailed-jobs", adminOnly, asyncHandler(async (req, res) => {
    const { emailHtml, seeAllJobsUrl } = req.body;
    let htmlToParse = "";
    if (seeAllJobsUrl) {
        // Fetch WayUp jobs page HTML
        try {
            const response = await axios_1.default.get(seeAllJobsUrl, {
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
                },
            });
            htmlToParse = response.data;
        }
        catch (error) {
            console.error("Failed to fetch WayUp jobs page:", error);
            return res.status(500).json({ error: "Failed to fetch WayUp jobs page" });
        }
    }
    else if (emailHtml) {
        htmlToParse = emailHtml;
    }
    else {
        return res.status(400).json({ error: "Either emailHtml or seeAllJobsUrl is required" });
    }
    const $ = cheerio.load(htmlToParse);
    const validCategories = await fetchJobCategories();
    const jobs = [];
    // Selector example based on WayUp’s jobs page HTML structure - adjust if needed
    $(".job-listing, .job-card").each((_, el) => {
        const el$ = $(el);
        const title = el$.find(".job-title, h3").text().trim();
        const company = el$.find(".company-name").text().trim();
        const location = el$.find(".job-location").text().trim();
        const description = el$.find(".job-description").text().trim();
        const applyUrl = el$.find("a.apply-button, a.job-link").attr("href") || "";
        if (title && applyUrl) {
            jobs.push({ title, company, location, description, applyUrl });
        }
    });
    console.log(`Parsed ${jobs.length} jobs from WayUp.`);
    let insertedCount = 0;
    for (const job of jobs) {
        try {
            const exists = await (0, db_1.query)("SELECT id FROM jobs WHERE title = $1 AND apply_url = $2", [
                job.title,
                job.applyUrl,
            ]);
            if (exists.rows.length > 0) {
                console.log(`Skipping duplicate job: ${job.title}`);
                continue;
            }
            const inferredCategoryRaw = inferCategoryFromTitle(job.title);
            const inferredCategory = mapCategoryToValid(inferredCategoryRaw, validCategories);
            await (0, db_1.query)(`INSERT INTO jobs (
            title, description, category, company, location,
            apply_url, posted_at, is_active, job_type, country, state, city
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [
                job.title,
                job.description,
                inferredCategory,
                job.company || "WayUp",
                job.location || "Unknown",
                job.applyUrl,
                new Date(),
                true,
                "wayup_detailed",
                "United States",
                null,
                null,
            ]);
            insertedCount++;
        }
        catch (error) {
            console.error(`Failed to insert job ${job.title}:`, error);
        }
    }
    res.json({ message: `Imported ${insertedCount} new jobs from WayUp.` });
}));
function parseJobsFromEmailText(text) {
    const jobs = [];
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
router.post("/import-linkedin-detailed-jobs", adminOnly, asyncHandler(async (req, res) => {
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
    const response = await axios_1.default.get(urlToFetch, {
        headers: {
            // Mimic a browser user agent
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
            // Add any LinkedIn cookies or auth headers here if needed to access the page
        },
    });
    const $ = cheerio.load(response.data);
    const validCategories = await fetchJobCategories();
    const jobs = [];
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
        const exists = await (0, db_1.query)("SELECT id FROM jobs WHERE title = $1 AND apply_url = $2", [job.title, job.applyUrl]);
        if (exists.rows.length > 0)
            continue;
        const inferredCategoryRaw = inferCategoryFromTitle(job.title);
        const inferredCategory = mapCategoryToValid(inferredCategoryRaw, validCategories);
        await (0, db_1.query)(`INSERT INTO jobs (
          title, description, category, company, location,
          apply_url, posted_at, is_active, job_type, country, state, city
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [
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
        ]);
        insertedCount++;
    }
    res.json({ message: `Imported ${insertedCount} new detailed jobs from LinkedIn.` });
}));
router.post("/import-jobs-from-email", adminOnly, asyncHandler(async (req, res) => {
    const { emailText } = req.body;
    if (!emailText) {
        return res.status(400).json({ error: "emailText is required in the body" });
    }
    const validCategories = await fetchJobCategories();
    const jobsToImport = parseJobsFromEmailText(emailText);
    let insertedCount = 0;
    for (const job of jobsToImport) {
        const existing = await (0, db_1.query)("SELECT id FROM jobs WHERE title = $1 AND company = $2 AND location = $3", [job.title, job.company, job.location]);
        if (existing.rows.length > 0) {
            continue;
        }
        const inferredCategoryRaw = inferCategoryFromTitle(job.title);
        const inferredCategory = mapCategoryToValid(inferredCategoryRaw, validCategories);
        try {
            await (0, db_1.query)(`INSERT INTO jobs (
            title, description, category, company, location,
            apply_url, posted_at, is_active, job_type, country, state, city
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [
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
            ]);
            insertedCount++;
        }
        catch (error) {
            console.error(`Error inserting job ${job.title}:`, error);
        }
    }
    res.json({ message: `Imported ${insertedCount} new jobs from email text.` });
}));
exports.default = router;
//# sourceMappingURL=BackendRoutes.js.map