// src/services/emailService.ts
import sgMail from "@sendgrid/mail";
// or your provider of choice

const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY!;
const FROM_EMAIL = "no-reply@ypropel.com"; // update to your verified sender

sgMail.setApiKey(SENDGRID_API_KEY);

/**
 * Basic email sender.
 * You can expand this later with templates, variables, etc.
 */
export async function sendEmail(to: string, subject: string, html: string) {
  const msg = {
    to,
    from: FROM_EMAIL,
    subject,
    html,
  };

  await sgMail.send(msg);
}
