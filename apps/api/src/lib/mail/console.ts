import type { MailMessage, MailResult, MailTransport } from "./types";

/**
 * Default transport: renders the email to the server log instead of sending
 * it, so the whole share flow is exercisable with no provider account.
 * Swap in SMTP by setting MAIL_DRIVER=smtp.
 */
export class ConsoleMailTransport implements MailTransport {
  readonly name = "console";
  /** Kept in memory so the API (and tests) can confirm what would be sent. */
  readonly outbox: MailMessage[] = [];

  async send(message: MailMessage): Promise<MailResult> {
    this.outbox.push(message);
    // eslint-disable-next-line no-console
    console.log(
      [
        "",
        "──────────────────────────────────────────────",
        `📧 [mail:console] to: ${message.to}`,
        `   subject: ${message.subject}`,
        "──────────────────────────────────────────────",
        message.text,
        "──────────────────────────────────────────────",
        "",
      ].join("\n"),
    );
    return { delivered: true, transport: this.name, id: `console-${Date.now()}` };
  }
}
