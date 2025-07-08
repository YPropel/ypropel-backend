import { pool } from "./db"; // adjust path
import fs from "fs";
import path from "path";

type UniversityUpdate = {
  title: string;
};

async function updateUniversityPhotos() {
  // Read your universities list JSON (assuming it has title fields)
  const filePath = path.join(__dirname, "../backend-usefiles/us_top3_universities.json");
  const rawData = fs.readFileSync(filePath, "utf-8");
  const universities: UniversityUpdate[] = JSON.parse(rawData);

  for (const uni of universities) {
    // Create a safe placeholder image URL with university title text (URL encoded)
    const safeText = encodeURIComponent(uni.title);
    const placeholderUrl = `https://via.placeholder.com/400x200?text=${safeText}`;

    try {
      await pool.query(
        `UPDATE universities SET cover_photo_url = $1 WHERE title = $2`,
        [placeholderUrl, uni.title]
      );
      console.log(`Updated photo for: ${uni.title}`);
    } catch (error) {
      console.error(`Failed to update photo for ${uni.title}:`, error);
    }
  }

  console.log("All photos updated.");
  await pool.end();
}

updateUniversityPhotos().catch((err) => {
  console.error("Error updating photos:", err);
  pool.end();
});
