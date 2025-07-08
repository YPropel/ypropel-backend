import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

pool.on('connect', (client) => {
  client.query('SET search_path TO public')
    .then(() => console.log('Search path set to public'))
    .catch((err) => console.error('Failed to set search_path:', err));
});

export const query = (text: string, params?: any[]) => pool.query(text, params);
