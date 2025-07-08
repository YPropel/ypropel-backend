import fs from "fs";
import path from "path";
import { query } from "./db";

interface TradeSchool {
  title: string;
  state: string;
  city?: string;
  country?: string;
  description?: string;
  website?: string;
  cover_photo_url?: string;
}

async function importTradeSchools() {
  try {
    // Go up one directory, then into backend-usefiles
    const filePath = path.join(__dirname, "..", "backend-usefiles", "us_top3_tradeschool.json");
    console.log("Using JSON file path:", filePath);

    if (!fs.existsSync(filePath)) {
      console.error("File not found:", filePath);
      return;
    }

    const rawData = fs.readFileSync(filePath, "utf-8");
    const tradeSchools: TradeSchool[] = JSON.parse(rawData);

    for (const school of tradeSchools) {
      const { title, state, city, country, description, website, cover_photo_url } = school;

      const existing = await query(
        "SELECT id FROM trade_schools WHERE title = $1 AND state = $2",
        [title, state]
      );

      if (existing.rows.length > 0) {
        console.log(`Skipping duplicate: ${title} (${state})`);
        continue;
      }

      await query(
        `INSERT INTO trade_schools
         (title, state, city, country, description, website, cover_photo_url, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [title, state, city || null, country || null, description || null, website || null, cover_photo_url || null]
      );

      console.log(`Inserted: ${title} (${state})`);
    }

    console.log("Import completed successfully!");
  } catch (error) {
    console.error("Error importing trade schools:", error);
  }
}

importTradeSchools();
