"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.query = exports.pool = void 0;
// ypropel-backend/db.ts
const pg_1 = require("pg");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
exports.pool = new pg_1.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});
// Helper query function to keep usage consistent
const query = (text, params) => {
    return exports.pool.query(text, params);
};
exports.query = query;
//# sourceMappingURL=db.js.map