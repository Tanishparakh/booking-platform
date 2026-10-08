import nodemailer from 'nodemailer';
import { config } from '../config';
import { query } from '../db/pool';

const transport = config.mail.host
  ? nodemailer.createTransport({ host: config.mail.host, port: config.mail.port, secure: false, ignoreTLS: true })
  : null;

/**
 * Sends an email through SMTP (MailHog locally). Every email is also written to email_log,
 * so the app keeps working, and mail can be inspected, when no SMTP server is available.
 */
export async function sendEmail(to: string, subject: string, body: string): Promise<void> {
  let delivered = false;
  if (transport) {
    try {
      await transport.sendMail({ from: config.mail.from, to, subject, text: body });
      delivered = true;
    } catch (err: any) {
      console.warn(`Email to ${to} could not be delivered: ${err.message}`);
    }
  }
  await query('INSERT INTO email_log (to_email, subject, body, delivered) VALUES ($1,$2,$3,$4)', [to, subject, body, delivered]);
}
