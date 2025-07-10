"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const db_1 = require("./db");
async function updateUniversityLogos() {
    try {
        // Fetch all universities with website and external_id
        const res = await db_1.pool.query("SELECT external_id, website FROM universities");
        for (const uni of res.rows) {
            try {
                if (!uni.website) {
                    console.log(`Skipping ${uni.external_id}: No website`);
                    continue;
                }
                // Extract domain from website URL
                const url = new URL(uni.website);
                const domain = url.hostname;
                // Build Clearbit logo URL
                const logoUrl = `https://logo.clearbit.com/${domain}`;
                // Update cover_photo_url for this university
                await db_1.pool.query("UPDATE universities SET cover_photo_url = $1 WHERE external_id = $2", [logoUrl, uni.external_id]);
                console.log(`Updated logo for ${uni.external_id} (${domain})`);
            }
            catch (innerErr) {
                console.error(`Failed to update logo for ${uni.external_id}:`, innerErr);
            }
        }
    }
    catch (err) {
        console.error("Error fetching universities:", err);
    }
    finally {
        await db_1.pool.end();
        console.log("Update process completed.");
    }
}
updateUniversityLogos();
//# sourceMappingURL=updateUniversityLogos.js.map