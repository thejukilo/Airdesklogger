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

const ROLE_LABELS: Record<string, string> = {
  INSTRUCTOR: "instructor",
  EXAMINER: "examiner",
  SUPERVISING_PIC: "supervising pilot-in-command",
  ATO: "ATO",
  DTO: "DTO",
  HOT: "head of training",
  AIRPORT: "airport",
  OTHER: "authorised party",
};

export interface SignoffEmail {
  to: string;
  link: string;
  holderName: string;
  signerName: string;
  capacity: string;
  flight: { date: string; route: string; aircraft: string; total: string };
  replyTo?: string;
}

/**
 * A personalised, plain transactional message. A real greeting, the flight it
 * concerns, and a footer identifying the sender read as legitimate to spam
 * filters far better than a bare link, and give the signer the context they need.
 */
export async function sendSignoffEmail(m: SignoffEmail): Promise<boolean> {
  if (!emailConfigured()) return false;
  const role = ROLE_LABELS[m.capacity] ?? "authorised party";
  const greetingName = m.signerName?.trim() || "there";

  const text =
    `Hello ${greetingName},\n\n` +
    `${m.holderName} has asked you to countersign a flight logbook entry as ${role}.\n\n` +
    `Flight details:\n` +
    `  Date:     ${m.flight.date}\n` +
    `  Aircraft: ${m.flight.aircraft}\n` +
    `  Route:    ${m.flight.route}\n` +
    `  Total:    ${m.flight.total}\n\n` +
    `To review the entry and add your signature, open this link:\n${m.link}\n\n` +
    `The link works once and will expire. If you were not expecting this, you can ignore the message.\n\n` +
    `Sent by AirdeskLogger on behalf of ${m.holderName}.`;

  const html =
    `<div style="font-family:system-ui,Arial,sans-serif;font-size:15px;color:#1a1a1a;line-height:1.5">` +
    `<p>Hello ${escapeHtml(greetingName)},</p>` +
    `<p>${escapeHtml(m.holderName)} has asked you to countersign a flight logbook entry as <strong>${escapeHtml(role)}</strong>.</p>` +
    `<table style="border-collapse:collapse;margin:12px 0">` +
    row("Date", m.flight.date) +
    row("Aircraft", m.flight.aircraft) +
    row("Route", m.flight.route) +
    row("Total", m.flight.total) +
    `</table>` +
    `<p><a href="${m.link}" style="color:#1a1a1a">Review the entry and add your signature</a></p>` +
    `<p style="color:#666;font-size:13px">The link works once and will expire. If you were not expecting this, you can ignore the message.</p>` +
    `<p style="color:#666;font-size:13px">Sent by AirdeskLogger on behalf of ${escapeHtml(m.holderName)}.</p>` +
    `</div>`;

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
      to: m.to,
      ...(m.replyTo ? { replyTo: m.replyTo } : {}),
      subject: `${m.holderName} asks you to countersign a flight on ${m.flight.date}`,
      text,
      html,
    });
    return true;
  } catch (err) {
    console.error("sign-off email failed:", err);
    return false;
  }
}

function row(label: string, value: string): string {
  return `<tr><td style="padding:2px 16px 2px 0;color:#666">${label}</td><td style="padding:2px 0">${escapeHtml(value)}</td></tr>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}
