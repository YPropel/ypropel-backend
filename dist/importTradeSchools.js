"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const db_1 = require("./db");
async function importTradeSchools() {
    try {
        // Go up one directory, then into backend-usefiles
        const filePath = path_1.default.join(__dirname, "..", "backend-usefiles", "us_top3_tradeschool.json");
        console.log("Using JSON file path:", filePath);
        if (!fs_1.default.existsSync(filePath)) {
            console.error("File not found:", filePath);
            return;
        }
        const rawData = fs_1.default.readFileSync(filePath, "utf-8");
        const tradeSchools = JSON.parse(rawData);
        for (const school of tradeSchools) {
            const { title, state, city, country, description, website, cover_photo_url } = school;
            const existing = await (0, db_1.query)("SELECT id FROM trade_schools WHERE title = $1 AND state = $2", [title, state]);
            if (existing.rows.length > 0) {
                console.log(`Skipping duplicate: ${title} (${state})`);
                continue;
            }
            await (0, db_1.query)(`INSERT INTO trade_schools
         (title, state, city, country, description, website, cover_photo_url, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`, [title, state, city || null, country || null, description || null, website || null, cover_photo_url || null]);
            console.log(`Inserted: ${title} (${state})`);
        }
        console.log("Import completed successfully!");
    }
    catch (error) {
        console.error("Error importing trade schools:", error);
    }
}
importTradeSchools();
//# sourceMappingURL=importTradeSchools.js.map