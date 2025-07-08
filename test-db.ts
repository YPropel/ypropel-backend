// test-db.ts
import { query } from './db';

async function testConnection() {
  try {
    const res = await query('SELECT NOW()');
    console.log('Database connected successfully at:', res.rows[0].now);
    process.exit(0); // Exit after test
  } catch (error) {
    console.error('Database connection error:', error);
    process.exit(1);
  }
}

testConnection();
