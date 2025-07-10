"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const db_1 = require("./db"); // adjust path if needed
async function importTop3Universities() {
    await db_1.pool.query("SET search_path TO public");
    const filePath = path_1.default.join(__dirname, "../backend-usefiles/us_top3_universities_full.json");
    console.log("Reading JSON file from:", filePath);
    const rawData = fs_1.default.readFileSync(filePath, "utf-8");
    const universities = JSON.parse(rawData);
    for (const uni of universities) {
        try {
            await db_1.pool.query(`INSERT INTO universities (external_id, title, state, country, description)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (external_id) DO UPDATE 
           SET title = EXCLUDED.title,
               state = EXCLUDED.state,
               country = EXCLUDED.country,
               description = EXCLUDED.description`, [uni.external_id, uni.title, uni.state, uni.country, uni.description]);
            console.log(`Inserted/Updated: ${uni.title}`);
        }
        catch (error) {
            console.error(`Failed to insert/update university ${uni.title}:`, error);
        }
    }
    console.log("Import complete.");
    await db_1.pool.end();
}
importTop3Universities().catch((err) => {
    console.error("Error during import:", err);
    db_1.pool.end();
});
//# sourceMappingURL=importTop3Universities.js.map