import nodemailer from "nodemailer";
import { env } from "./config.ts";
export const CONTACT_EMAIL = "contact@scharade.jp";
export function mailTransport() {
  const pass = env("GMAIL_PASS");
  if (!pass) throw new Error("Mail is not configured");
  return nodemailer.createTransport({
    service: "gmail",
    port: 587,
    secure: false,
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 15000,
    auth: { user: CONTACT_EMAIL, pass },
  });
}
