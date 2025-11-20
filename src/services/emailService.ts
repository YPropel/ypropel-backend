// src/services/emailService.ts
// Clean version using ONLY Nodemailer (utils/sendEmail.ts)

import { sendEmail as smtpSendEmail } from "../../utils/sendEmail";

/**
 * Sends an email using the Nodemailer wrapper in utils/sendEmail.ts
 * This keeps a clean separation and allows for templates later.
 */
export async function sendEmail(to: string, subject: string, html: string) {
  try {
    await smtpSendEmail(to, subject, html);
    console.log(`Email sent to ${to}`);
  } catch (err) {
    console.error("Failed to send email:", err);
    throw err;
  }
}
