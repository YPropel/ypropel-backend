import fs from "fs";
import path from "path";
import { pool } from "./db"; // Adjust if your db.ts is elsewhere

type University = {
  title: string;
  state: string;
  country: string;
  description: string;
  website: string;
  cover_photo_url: string;
};

async function importUniversities() {
  const filePath = path.join(__dirname, "../backend-usefiles/us_top3_universities.json");
  const rawData = fs.readFileSync(filePath, "utf-8");
  const universities: University[] = JSON.parse(rawData);

  console.log(`Importing ${universities.length} universities into database...`);

  for (const uni of universities) {
    try {
      await pool.query(
        `INSERT INTO universities (title, state, country, description, website, cover_photo_url)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (title) DO UPDATE SET
           state = EXCLUDED.state,
           country = EXCLUDED.country,
           description = EXCLUDED.description,
           website = EXCLUDED.website,
           cover_photo_url = EXCLUDED.cover_photo_url`,
        [
          uni.title,
          uni.state,
          uni.country,
          uni.description,
          uni.website,
          uni.cover_photo_url,
        ]
      );
      console.log(`Inserted/Updated: ${uni.title}`);
    } catch (error) {
      console.error(`Failed to insert/update university ${uni.title}:`, error);
    }
  }

  console.log("Import complete.");
  await pool.end();
}

importUniversities().catch((err) => {
  console.error("Error during import:", err);
  pool.end();
});
