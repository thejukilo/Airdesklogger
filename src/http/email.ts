/**
 * Outbound email over SMTP, used to deliver one-time signing links.
 *
 * The SMTP settings come from the environment, so a deployment without them
 * simply does not send (the caller still returns the shareable link). nodemailer
 * is pure JavaScript, so it bundles into a serverless function without native
 * dependencies.
 *
 * Environment:
 *   SMTP_HOST, SMTP_PORT (default 587), SMTP_SECURE ("true" for implicit TLS on
 *   465), SMTP_USER, SMTP_PASS, SMTP_FROM (e.g. "AirdeskLogger <no-reply@...>").
 */

import nodemailer from "nodemailer";

export function emailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_FROM);
}

export async function sendSignoffEmail(to: string, link: string, holderName: string): Promise<boolean> {
  if (!emailConfigured()) return false;
  try {
    const transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT ?? "587"),
      secure: process.env.SMTP_SECURE === "true",
      ...(process.env.SMTP_USER
        ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS ?? "" } }
        : {}),
    });
    await transport.sendMail({
      from: process.env.SMTP_FROM,
      to,
      subject: "Request to countersign a flight logbook entry",
      text:
        `${holderName} has asked you to countersign a flight logbook entry.\n\n` +
        `Open this single-use link to review and sign it:\n${link}\n\n` +
        `The link can be used once and will expire.`,
      html:
        `<p>${escapeHtml(holderName)} has asked you to countersign a flight logbook entry.</p>` +
        `<p><a href="${link}">Open the signing page</a> to review and sign it.</p>` +
        `<p>The link can be used once and will expire.</p>`,
    });
    return true;
  } catch (err) {
    console.error("sign-off email failed:", err);
    return false;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
