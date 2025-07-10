"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const db_1 = require("../db");
const router = express_1.default.Router();
const JWT_SECRET = process.env.JWT_SECRET || "your_jwt_secret_key";
// Async wrapper to catch errors and forward them to Express error handler
function asyncHandler(fn) {
    return function (req, res, next) {
        fn(req, res, next).catch(next);
    };
}
function authenticateToken(req, res, next) {
    const authHeader = req.headers["authorization"];
    const token = authHeader?.split(" ")[1];
    if (!token) {
        res.sendStatus(401);
        return;
    }
    jsonwebtoken_1.default.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            res.sendStatus(403);
            return;
        }
        const payload = user;
        req.user = {
            userId: payload.userId,
            email: payload.email,
            isAdmin: payload.is_admin || false,
        };
        next();
    });
}
// Protect all admin routes with authentication middleware
router.use(authenticateToken);
router.delete("/news/:id", asyncHandler(async (req, res) => {
    if (!req.user?.isAdmin) {
        return res.status(403).json({ error: "Access denied. Admins only." });
    }
    const newsId = parseInt(req.params.id);
    if (isNaN(newsId)) {
        return res.status(400).json({ error: "Invalid news ID" });
    }
    await (0, db_1.query)("DELETE FROM news WHERE id = $1", [newsId]);
    res.json({ message: "News item deleted successfully" });
}));
exports.default = router;
//# sourceMappingURL=BackendRoutes.js.map