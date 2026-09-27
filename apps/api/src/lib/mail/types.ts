export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: Array<{
    filename: string;
    content: Buffer;
    contentType?: string;
  }>;
}

export interface MailResult {
  delivered: boolean;
  transport: string;
  /** Provider message id when there is one. */
  id?: string;
}

export interface MailTransport {
  readonly name: string;
  send(message: MailMessage): Promise<MailResult>;
}
