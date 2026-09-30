import nodemailer from 'nodemailer';
import type { Env } from './env';
import type { Logger } from './logger';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Sends email. Only exists when SMTP is configured. */
export interface Mailer {
  send(mail: Mail): Promise<void>;
}

export function createMailer(env: Env, logger: Logger): Mailer | null {
  if (!env.SMTP_URL) return null;
  const transport = nodemailer.createTransport(env.SMTP_URL);
  return {
    async send(mail) {
      await transport.sendMail({ from: env.MAIL_FROM, ...mail });
      logger.debug({ to: mail.to, subject: mail.subject }, 'email sent');
    },
  };
}
