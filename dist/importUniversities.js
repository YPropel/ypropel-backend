"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const db_1 = require("./db"); // Adjust if your db.ts is elsewhere
async function importUniversities() {
    const filePath = path_1.default.join(__dirname, "../backend-usefiles/us_top3_universities.json");
    const rawData = fs_1.default.readFileSync(filePath, "utf-8");
    const universities = JSON.parse(rawData);
    console.log(`Importing ${universities.length} universities into database...`);
    for (const uni of universities) {
        try {
            await db_1.pool.query(`INSERT INTO universities (title, state, country, description, website, cover_photo_url)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (title) DO UPDATE SET
           state = EXCLUDED.state,
           country = EXCLUDED.country,
           description = EXCLUDED.description,
           website = EXCLUDED.website,
           cover_photo_url = EXCLUDED.cover_photo_url`, [
                uni.title,
                uni.state,
                uni.country,
                uni.description,
                uni.website,
                uni.cover_photo_url,
            ]);
            console.log(`Inserted/Updated: ${uni.title}`);
        }
        catch (error) {
            console.error(`Failed to insert/update university ${uni.title}:`, error);
        }
    }
    console.log("Import complete.");
    await db_1.pool.end();
}
importUniversities().catch((err) => {
    console.error("Error during import:", err);
    db_1.pool.end();
});
//# sourceMappingURL=importUniversities.js.map