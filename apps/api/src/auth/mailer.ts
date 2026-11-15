import { Logger } from '@nestjs/common';
import { appendFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

export const MAILER = Symbol('MAILER');

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  /** Machine-readable kind, e.g. "password_reset". */
  kind: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

export const maskEmail = (email: string): string => {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}***@${domain}`;
};

/**
 * DEVELOPMENT ONLY. Prints emails to the API console so links can be clicked locally.
 * Not a delivery integration — real email arrives with the communication module (Phase 11).
 */
export class ConsoleMailer implements Mailer {
  private readonly logger = new Logger('DevMail');
  /** Repository root/.dev-mail (git-ignored), so links can be opened during development. */
  private readonly dir = resolve(import.meta.dirname, '../../../../.dev-mail');

  async send(m: MailMessage): Promise<void> {
    this.logger.warn(
      `[not delivered — dev only] to=${maskEmail(m.to)} subject="${m.subject}"\n${m.text}`,
    );
    try {
      await mkdir(this.dir, { recursive: true });
      await appendFile(
        resolve(this.dir, 'outbox.log'),
        `--- ${new Date().toISOString()} ${m.kind}\nTo: ${m.to}\nSubject: ${m.subject}\n${m.text}\n\n`,
      );
    } catch {
      // Best effort: the console copy above is enough.
    }
  }
}

/** TESTS ONLY. Keeps messages in memory for assertions. */
export class CaptureMailer implements Mailer {
  readonly sent: MailMessage[] = [];

  async send(m: MailMessage): Promise<void> {
    this.sent.push(m);
  }

  lastTo(to: string, kind?: string): MailMessage | undefined {
    return [...this.sent].reverse().find((m) => m.to === to && (!kind || m.kind === kind));
  }
}

/** Production has no mail transport until Phase 11: fail loudly instead of pretending. */
export class UnconfiguredMailer implements Mailer {
  async send(): Promise<void> {
    throw new Error('No email transport is configured (planned for the communication module).');
  }
}

/** Extracts the token from a link in an email body (tests and dev tooling). */
export const tokenFromMail = (m: MailMessage | undefined): string => {
  const match = m?.text.match(/token=([A-Za-z0-9_-]+)/);
  if (!match?.[1]) throw new Error('No token in message');
  return match[1];
};
