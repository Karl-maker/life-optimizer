import nodemailer from "nodemailer";
import type { EmailTransport } from "@edu-service/email";

export function createSmtpEmailTransport(
  environment: NodeJS.ProcessEnv,
): EmailTransport {
  const client = smtpClient(environment);
  return {
    id: "smtp",
    async send({ configuration, recipient, rendered, headers }) {
      const result = await client.sendMail({
        from: configuration.fromName
          ? `${configuration.fromName} <${configuration.fromEmail}>`
          : configuration.fromEmail,
        to: recipient,
        ...(configuration.replyTo === null
          ? {}
          : { replyTo: configuration.replyTo }),
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        headers,
      });
      return result.messageId === undefined
        ? {}
        : { providerMessageId: result.messageId };
    },
  };
}
export async function verifySmtpConfiguration(
  environment: NodeJS.ProcessEnv,
): Promise<void> {
  await smtpClient(environment).verify();
}
function smtpClient(environment: NodeJS.ProcessEnv) {
  const host = required(environment.EDU_SMTP_HOST, "EDU_SMTP_HOST");
  const port = positivePort(environment.EDU_SMTP_PORT);
  const username = optional(environment.EDU_SMTP_USERNAME);
  const password = optional(environment.EDU_SMTP_PASSWORD);
  if ((username === undefined) !== (password === undefined))
    throw new Error(
      "EDU_SMTP_USERNAME and EDU_SMTP_PASSWORD must be supplied together.",
    );
  const secure = boolean(
    environment.EDU_SMTP_SECURE,
    "EDU_SMTP_SECURE",
    port === 465,
  );
  return nodemailer.createTransport({
    host,
    port,
    secure,
    ...(username === undefined
      ? {}
      : { auth: { user: username, pass: password! } }),
  });
}

function required(value: string | undefined, name: string): string {
  const normalized = optional(value);
  if (!normalized) throw new Error(`${name} is required for SMTP delivery.`);
  return normalized;
}

function optional(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

function positivePort(value: string | undefined): number {
  const port = Number(optional(value) ?? "587");
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535)
    throw new Error("EDU_SMTP_PORT must be a valid TCP port.");
  return port;
}

function boolean(
  value: string | undefined,
  name: string,
  fallback: boolean,
): boolean {
  const normalized = optional(value)?.toLowerCase();
  if (!normalized) return fallback;
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  throw new Error(`${name} must be true or false.`);
}
