// ypropel-backend/db.ts
import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

// Helper query function to keep usage consistent
export const query = (text: string, params?: any[]) => {
  return pool.query(text, params);
};
