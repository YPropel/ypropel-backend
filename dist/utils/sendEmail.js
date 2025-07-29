"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendEmail = sendEmail;
const nodemailer_1 = __importDefault(require("nodemailer"));
const transporter = nodemailer_1.default.createTransport({
    host: process.env.EMAIL_HOST,
    port: Number(process.env.EMAIL_PORT),
    secure: false, // true for 465, false for other ports
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
    },
});
async function sendEmail(to, subject, html) {
    const mailOptions = {
        from: `"YPropel" <${process.env.EMAIL_USER}>`,
        to,
        subject,
        html,
    };
    try {
        await transporter.sendMail(mailOptions);
        console.log(`Email sent to ${to}`);
    }
    catch (error) {
        console.error("Error sending email:", error);
        throw error;
    }
}
//# sourceMappingURL=sendEmail.js.map