import fs from "fs";
import path from "path";
import { pool } from "./db"; // adjust path if needed

type University = {
  external_id: string;
  title: string;
  state: string;
  country: string;
  description: string;
};

async function importTop3Universities() {
  await pool.query("SET search_path TO public");

  const filePath = path.join(__dirname, "../backend-usefiles/us_top3_universities_full.json");
  console.log("Reading JSON file from:", filePath);

  const rawData = fs.readFileSync(filePath, "utf-8");
  const universities: University[] = JSON.parse(rawData);

  for (const uni of universities) {
    try {
      await pool.query(
        `INSERT INTO universities (external_id, title, state, country, description)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (external_id) DO UPDATE 
           SET title = EXCLUDED.title,
               state = EXCLUDED.state,
               country = EXCLUDED.country,
               description = EXCLUDED.description`,
        [uni.external_id, uni.title, uni.state, uni.country, uni.description]
      );
      console.log(`Inserted/Updated: ${uni.title}`);
    } catch (error) {
      console.error(`Failed to insert/update university ${uni.title}:`, error);
    }
  }

  console.log("Import complete.");
  await pool.end();
}

importTop3Universities().catch((err) => {
  console.error("Error during import:", err);
  pool.end();
});
