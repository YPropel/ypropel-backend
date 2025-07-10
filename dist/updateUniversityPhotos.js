"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const db_1 = require("./db"); // adjust path
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
async function updateUniversityPhotos() {
    // Read your universities list JSON (assuming it has title fields)
    const filePath = path_1.default.join(__dirname, "../backend-usefiles/us_top3_universities.json");
    const rawData = fs_1.default.readFileSync(filePath, "utf-8");
    const universities = JSON.parse(rawData);
    for (const uni of universities) {
        // Create a safe placeholder image URL with university title text (URL encoded)
        const safeText = encodeURIComponent(uni.title);
        const placeholderUrl = `https://via.placeholder.com/400x200?text=${safeText}`;
        try {
            await db_1.pool.query(`UPDATE universities SET cover_photo_url = $1 WHERE title = $2`, [placeholderUrl, uni.title]);
            console.log(`Updated photo for: ${uni.title}`);
        }
        catch (error) {
            console.error(`Failed to update photo for ${uni.title}:`, error);
        }
    }
    console.log("All photos updated.");
    await db_1.pool.end();
}
updateUniversityPhotos().catch((err) => {
    console.error("Error updating photos:", err);
    db_1.pool.end();
});
//# sourceMappingURL=updateUniversityPhotos.js.map