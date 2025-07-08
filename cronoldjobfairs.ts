// -------this page is to delete old and expired job fairs from the dtabase
//automatically - we called it in index.ts
//cleanup cron will run every day at 2:00 AM (server time), 
// deleting job fairs older than one day.

import cron from "node-cron";
import { query } from "./db";

// Run every day at 2:00 AM server time
cron.schedule("0 2 * * *", async () => {
  console.log("⏰ Running job to delete expired job fairs...");

  try {
    const result = await query(
      "DELETE FROM job_fairs WHERE start_datetime < NOW() - INTERVAL '1 day'"
    );
    console.log("✅ Deleted expired job fairs");
  } catch (error) {
    console.error("❌ Error deleting expired job fairs:", error);
  }
});
