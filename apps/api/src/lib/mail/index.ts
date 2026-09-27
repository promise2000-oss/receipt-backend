import { env } from "../env";
import type { MailTransport } from "./types";
import { ConsoleMailTransport } from "./console";
import { SmtpMailTransport } from "./smtp";

export * from "./types";

let transport: MailTransport | null = null;

export function getMailer(): MailTransport {
  if (transport) return transport;
  transport = env.mailDriver === "smtp" ? new SmtpMailTransport() : new ConsoleMailTransport();
  return transport;
}

/** Test hook. */
export function setMailer(next: MailTransport | null): void {
  transport = next;
}
