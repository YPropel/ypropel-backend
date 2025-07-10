"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// test-db.ts
const db_1 = require("./db");
async function testConnection() {
    try {
        const res = await (0, db_1.query)('SELECT NOW()');
        console.log('Database connected successfully at:', res.rows[0].now);
        process.exit(0); // Exit after test
    }
    catch (error) {
        console.error('Database connection error:', error);
        process.exit(1);
    }
}
testConnection();
//# sourceMappingURL=test-db.js.map