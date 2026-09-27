import nodemailer, { type Transporter } from "nodemailer";
import { env } from "../env";
import type { MailMessage, MailResult, MailTransport } from "./types";

/** Real delivery through any SMTP server (including Resend/SES/SendGrid SMTP). */
export class SmtpMailTransport implements MailTransport {
  readonly name = "smtp";
  private readonly transporter: Transporter;

  constructor() {
    if (!env.smtp.host) {
      throw new Error("MAIL_DRIVER=smtp requires SMTP_HOST to be set.");
    }
    this.transporter = nodemailer.createTransport({
      host: env.smtp.host,
      port: env.smtp.port,
      secure: env.smtp.secure,
      ...(env.smtp.user
        ? { auth: { user: env.smtp.user, pass: env.smtp.pass } }
        : {}),
    });
  }

  async send(message: MailMessage): Promise<MailResult> {
    const info = await this.transporter.sendMail({
      from: env.mailFrom,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    return { delivered: true, transport: this.name, id: info.messageId };
  }
}
