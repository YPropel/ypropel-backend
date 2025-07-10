"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.query = exports.pool = void 0;
const pg_1 = require("pg");
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
exports.pool = new pg_1.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false,
    },
});
exports.pool.on('connect', (client) => {
    client.query('SET search_path TO public')
        .then(() => console.log('Search path set to public'))
        .catch((err) => console.error('Failed to set search_path:', err));
});
const query = (text, params) => exports.pool.query(text, params);
exports.query = query;
//# sourceMappingURL=db.js.map