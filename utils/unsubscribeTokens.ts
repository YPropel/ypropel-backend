import jwt from "jsonwebtoken";

const UNSUBSCRIBE_SECRET = process.env.UNSUBSCRIBE_SECRET!;

export function generateUnsubscribeToken(userId: number): string {
  return jwt.sign(
    { userId, scope: "email_unsubscribe" },
    UNSUBSCRIBE_SECRET,
    { expiresIn: "90d" }
  );
}

export function verifyUnsubscribeToken(token: string): { userId: number } {
  const payload = jwt.verify(token, UNSUBSCRIBE_SECRET) as any;

  if (payload.scope !== "email_unsubscribe") {
    throw new Error("Invalid unsubscribe token");
  }

  return { userId: payload.userId };
}
