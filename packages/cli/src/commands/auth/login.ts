import { z } from "zod";
import { CliError } from "../../errors/cli-error.js";
import { defineCommand } from "../../framework/define-command.js";

const responseSchema = z.object({
  token: z.string().min(20),
  expiresAt: z.string(),
  profile: z.object({ email: z.string().nullable(), name: z.string() }),
});

export default defineCommand({
  name: "auth login",
  summary: "Log in to the API with a hidden password prompt",
  effect: "write",
  options: {
    email: { type: "string", description: "Account email" },
    "api-url": { type: "string", description: "Edu Service API base URL" },
  },
  input: z.object({ email: z.email().max(320), apiUrl: z.url().optional() }),
  async run(input, ctx) {
    const apiUrl = input.apiUrl ?? ctx.config.apiUrl;
    if (!apiUrl)
      throw new CliError({
        code: "CONFIG",
        message: "No API URL is configured.",
        hint: "Pass --api-url https://api.example.com on the first login.",
      });
    const endpoint = secureApiUrl(apiUrl);
    const password = await ctx.io.readSecret("Password: ");
    let response: Response;
    try {
      response = await fetch(new URL("/auth/login", endpoint), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-client-platform": "cli",
        },
        body: JSON.stringify({ email: input.email, password, client: "cli" }),
      });
    } catch (cause) {
      throw new CliError({
        code: "UNAVAILABLE",
        message: "The authentication service is unavailable.",
        retryable: true,
        cause,
      });
    }
    if (response.status === 401)
      throw new CliError({
        code: "AUTH_REQUIRED",
        message: "The email or password was not accepted.",
      });
    if (!response.ok)
      throw new CliError({
        code: "UNAVAILABLE",
        message: `Authentication failed with status ${response.status}.`,
        retryable: response.status >= 500,
      });
    const raw = await response.text();
    if (raw.length > 65_536)
      throw new CliError({
        code: "UNAVAILABLE",
        message: "The authentication service returned an oversized response.",
      });
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      payload = null;
    }
    const parsed = responseSchema.safeParse(payload);
    if (!parsed.success)
      throw new CliError({
        code: "UNAVAILABLE",
        message: "The authentication service returned an invalid response.",
      });
    await ctx.configStore.update({
      apiUrl: endpoint.origin,
      sessionToken: parsed.data.token,
    });
    return {
      name: parsed.data.profile.name,
      email: parsed.data.profile.email,
      expiresAt: parsed.data.expiresAt,
    };
  },
  human: (result) =>
    `Signed in as ${result.name}${result.email ? ` (${result.email})` : ""}.\nSession expires ${result.expiresAt}.`,
});

function secureApiUrl(value: string): URL {
  const url = new URL(value);
  if (
    url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      (url.hostname === "localhost" ||
        url.hostname === "127.0.0.1" ||
        url.hostname === "::1")
    )
  ) {
    throw new CliError({
      code: "CONFIG",
      message: "The API URL must use HTTPS outside localhost.",
    });
  }
  return url;
}
