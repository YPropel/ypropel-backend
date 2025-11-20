import { generateUnsubscribeToken } from "../utils/unsubscribeTokens";

export function wrapWithUnsubscribe(userId: number, html: string) {
  const token = generateUnsubscribeToken(userId);
  const link = `${process.env.FRONTEND_BASE_URL}/unsubscribe?token=${encodeURIComponent(token)}`;

  return `
    ${html}

    <hr />
    <p style="font-size:12px;color:#666;text-align:center;">
      You’re receiving this email because you have a YPropel account.<br />
      <a href="${link}">Unsubscribe</a>
    </p>
  `;
}
