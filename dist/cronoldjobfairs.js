"use strict";
// -------this page is to delete old and expired job fairs from the dtabase
//automatically - we called it in index.ts
//cleanup cron will run every day at 2:00 AM (server time), 
// deleting job fairs older than one day.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_cron_1 = __importDefault(require("node-cron"));
const db_1 = require("./db");
// Run every day at 2:00 AM server time
node_cron_1.default.schedule("0 2 * * *", async () => {
    console.log("⏰ Running job to delete expired job fairs...");
    try {
        const result = await (0, db_1.query)("DELETE FROM job_fairs WHERE start_datetime < NOW() - INTERVAL '1 day'");
        console.log("✅ Deleted expired job fairs");
    }
    catch (error) {
        console.error("❌ Error deleting expired job fairs:", error);
    }
});
//# sourceMappingURL=cronoldjobfairs.js.map