import type { EmailPresentation } from "./presentation.js";

/** Mirrors EmailTemplate without importing the service barrel (avoids a cycle). */
interface EmailTemplateRecord {
  id: string;
  subjectTemplate: string;
  headerPartial: string;
  mainTemplate: string;
  footerPartial: string;
  textTemplate: string;
  createdAt: Date;
  updatedAt: Date;
}

const FONT =
  "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;";
const MUTED = "#666666";
const INK = "#111111";
const RULE = "#eaeaea";
const LINK = "#0066cc";

/** Shared header: brand mark + name. */
export function emailHeaderPartial(presentation: EmailPresentation): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin:0 0 28px">
  <tr>
    <td style="${FONT}">
      <img src="${escapeAttr(presentation.logoUrl)}" alt="${escapeAttr(presentation.brandName)}" width="36" height="36" style="display:block;border:0;border-radius:8px" />
      <p style="margin:12px 0 0;font-size:13px;line-height:1.4;color:${MUTED};letter-spacing:0.02em">${escapeHtml(presentation.brandName)}</p>
    </td>
  </tr>
</table>`;
}

/**
 * Transactional footer for auth and account mail.
 * No unsubscribe control — marketing opt-out must not appear on reset/confirm mail.
 */
export function transactionalFooterPartial(
  presentation: EmailPresentation,
): string {
  return footerContent(presentation, false);
}

/**
 * Marketing footer for newsletters and notices.
 * Unsubscribe uses the opaque token URL; never put the recipient email in the link.
 */
export function marketingFooterPartial(
  presentation: EmailPresentation,
): string {
  return footerContent(presentation, true);
}

function footerContent(
  presentation: EmailPresentation,
  includeUnsubscribe: boolean,
): string {
  const unsubscribeHref = `${escapeAttr(presentation.clientBaseUrl)}/unsubscribe?token={{unsubscribeToken}}`;
  const unsubscribeBlock = includeUnsubscribe
    ? `<p style="margin:0 0 10px"><a href="${unsubscribeHref}" style="color:${LINK};text-decoration:underline">Unsubscribe from these emails</a></p>`
    : "";
  return `<div style="${FONT}margin-top:28px;padding-top:18px;border-top:1px solid ${RULE};color:${MUTED};font-size:12px;line-height:1.6">
  <p style="margin:0 0 10px">Need help? <a href="mailto:${escapeAttr(presentation.supportEmail)}" style="color:${LINK};text-decoration:underline">${escapeHtml(presentation.supportEmail)}</a></p>
  ${unsubscribeBlock}
  <p style="margin:0 0 10px">
    <a href="${escapeAttr(presentation.termsUrl)}" style="color:${LINK};text-decoration:underline">Terms</a>
    &nbsp;·&nbsp;
    <a href="${escapeAttr(presentation.privacyUrl)}" style="color:${LINK};text-decoration:underline">Privacy Policy</a>
  </p>
  <p style="margin:0;color:#999999">© {{year}} ${escapeHtml(presentation.brandName)}</p>
</div>`;
}

/** Stable template ids seeded by the API composition when email presentation is configured. */
export const EMAIL_TEMPLATE_IDS = {
  forgetPassword: "forget-password",
  confirmation: "confirmation",
  deleteAccount: "auth-delete-account",
  undoDeletion: "auth-undo-deletion",
  upcomingPolicyChange: "upcoming-policy-change",
  welcome: "welcome",
  newsletter: "newsletter",
  generalNotice: "general-notice",
} as const;

export function createStandardEmailTemplates(
  presentation: EmailPresentation,
  now = new Date(),
): readonly EmailTemplateRecord[] {
  const header = cardShellOpen() + emailHeaderPartial(presentation);
  const transactionalFooter =
    transactionalFooterPartial(presentation) + cardShellClose();
  const marketingFooter =
    marketingFooterPartial(presentation) + cardShellClose();
  const brandText = presentation.brandName;
  const brandHtml = escapeHtml(presentation.brandName);
  // Query tokens survive mail clients/click-trackers; URL fragments often do not.
  const confirmHref = `${escapeAttr(presentation.clientBaseUrl)}/confirm?token={{token}}`;
  const resetHref = `${escapeAttr(presentation.clientBaseUrl)}/reset-password?token={{token}}`;

  return [
    template({
      id: EMAIL_TEMPLATE_IDS.forgetPassword,
      subjectTemplate: `Reset your password — ${brandText}`,
      headerPartial: header,
      footerPartial: transactionalFooter,
      mainTemplate: `
  <h1 style="margin:0 0 12px;${FONT}font-size:22px;line-height:1.3;font-weight:650;color:${INK}">Reset your password</h1>
  <p style="margin:0 0 8px;${FONT}font-size:15px;line-height:1.6;color:${INK}">Hello{{#if recipientName}}, {{recipientName}}{{/if}}.</p>
  <p style="margin:0 0 24px;${FONT}font-size:15px;line-height:1.6;color:${INK}">We received a request to reset your ${brandHtml} password. Choose a new one with the button below.</p>
  ${cta(resetHref, "Reset password")}
  <p style="margin:20px 0 0;${FONT}font-size:13px;line-height:1.5;color:${MUTED}">This link expires {{expiresAt}}. If you did not request a reset, you can ignore this email.</p>`,
      textTemplate: `Reset your ${brandText} password.\n\nOpen: ${presentation.clientBaseUrl}/reset-password?token={{token}}\nExpires {{expiresAt}}.\n\nIf you did not request this, ignore this email.\nSupport: ${presentation.supportEmail}`,
      now,
    }),
    template({
      id: EMAIL_TEMPLATE_IDS.confirmation,
      subjectTemplate: `Confirm your email — ${brandText}`,
      headerPartial: header,
      footerPartial: transactionalFooter,
      mainTemplate: `
  <h1 style="margin:0 0 12px;${FONT}font-size:22px;line-height:1.3;font-weight:650;color:${INK}">Confirm your email</h1>
  <p style="margin:0 0 8px;${FONT}font-size:15px;line-height:1.6;color:${INK}">Hello{{#if recipientName}}, {{recipientName}}{{/if}}.</p>
  <p style="margin:0 0 24px;${FONT}font-size:15px;line-height:1.6;color:${INK}">Confirm this address to finish setting up your ${brandHtml} account.</p>
  ${cta(confirmHref, "Confirm email")}
  <p style="margin:20px 0 0;${FONT}font-size:13px;line-height:1.5;color:${MUTED}">This link expires {{expiresAt}}. If you did not create an account, you can ignore this email.</p>`,
      textTemplate: `Confirm your ${brandText} email.\n\nOpen: ${presentation.clientBaseUrl}/confirm?token={{token}}\nExpires {{expiresAt}}.\n\nIf you did not create an account, ignore this email.\nSupport: ${presentation.supportEmail}`,
      now,
    }),
    template({
      id: EMAIL_TEMPLATE_IDS.deleteAccount,
      subjectTemplate: `Confirm account deletion — ${brandText}`,
      headerPartial: header,
      footerPartial: transactionalFooter,
      mainTemplate: `
  <h1 style="margin:0 0 12px;${FONT}font-size:22px;line-height:1.3;font-weight:650;color:${INK}">Confirm account deletion</h1>
  <p style="margin:0 0 8px;${FONT}font-size:15px;line-height:1.6;color:${INK}">Hello{{#if recipientName}}, {{recipientName}}{{/if}}.</p>
  <p style="margin:0 0 16px;${FONT}font-size:15px;line-height:1.6;color:${INK}">Use this one-time code to confirm deleting your ${brandHtml} account:</p>
  ${codeBlock("{{token}}")}
  <p style="margin:16px 0 0;${FONT}font-size:13px;line-height:1.5;color:${MUTED}">This code expires {{expiresAt}}.</p>`,
      textTemplate: `Confirm ${brandText} account deletion.\nCode: {{token}}\nExpires {{expiresAt}}.\nSupport: ${presentation.supportEmail}`,
      now,
    }),
    template({
      id: EMAIL_TEMPLATE_IDS.undoDeletion,
      subjectTemplate: `Undo account deletion — ${brandText}`,
      headerPartial: header,
      footerPartial: transactionalFooter,
      mainTemplate: `
  <h1 style="margin:0 0 12px;${FONT}font-size:22px;line-height:1.3;font-weight:650;color:${INK}">Keep your account</h1>
  <p style="margin:0 0 8px;${FONT}font-size:15px;line-height:1.6;color:${INK}">Hello{{#if recipientName}}, {{recipientName}}{{/if}}.</p>
  <p style="margin:0 0 16px;${FONT}font-size:15px;line-height:1.6;color:${INK}">You can still cancel deletion of your ${brandHtml} account with this one-time code:</p>
  ${codeBlock("{{token}}")}
  <p style="margin:16px 0 0;${FONT}font-size:13px;line-height:1.5;color:${MUTED}">This code expires {{expiresAt}}.</p>`,
      textTemplate: `Undo ${brandText} account deletion.\nCode: {{token}}\nExpires {{expiresAt}}.\nSupport: ${presentation.supportEmail}`,
      now,
    }),
    template({
      id: EMAIL_TEMPLATE_IDS.upcomingPolicyChange,
      subjectTemplate: `Upcoming policy update — ${brandText}`,
      headerPartial: header,
      footerPartial: marketingFooter,
      mainTemplate: `
  <h1 style="margin:0 0 12px;${FONT}font-size:22px;line-height:1.3;font-weight:650;color:${INK}">Policy update</h1>
  <p style="margin:0 0 8px;${FONT}font-size:15px;line-height:1.6;color:${INK}">Hello{{#if recipientName}}, {{recipientName}}{{/if}}.</p>
  <p style="margin:0 0 16px;${FONT}font-size:15px;line-height:1.6;color:${INK}">{{summary}}</p>
  <p style="margin:0;${FONT}font-size:13px;line-height:1.5;color:${MUTED}">Effective {{effectiveDate}}.</p>`,
      textTemplate: `Upcoming ${brandText} policy update.\n\n{{summary}}\nEffective {{effectiveDate}}.\n\nUnsubscribe: ${presentation.clientBaseUrl}/unsubscribe?token={{unsubscribeToken}}`,
      now,
    }),
    template({
      id: EMAIL_TEMPLATE_IDS.welcome,
      subjectTemplate: `Welcome to ${brandText}`,
      headerPartial: header,
      footerPartial: marketingFooter,
      mainTemplate: `
  <h1 style="margin:0 0 12px;${FONT}font-size:22px;line-height:1.3;font-weight:650;color:${INK}">Welcome to ${brandHtml}</h1>
  <p style="margin:0 0 8px;${FONT}font-size:15px;line-height:1.6;color:${INK}">Hello{{#if recipientName}}, {{recipientName}}{{/if}}.</p>
  <p style="margin:0 0 24px;${FONT}font-size:15px;line-height:1.6;color:${INK}">{{#if summary}}{{summary}}{{else}}Your account is ready. Start exploring whenever you like.{{/if}}</p>
  ${cta(`${escapeAttr(presentation.clientBaseUrl)}/`, "Get started")}`,
      textTemplate: `Welcome to ${brandText}.\n\n{{#if summary}}{{summary}}\n\n{{/if}}Open: ${presentation.clientBaseUrl}/\nUnsubscribe: ${presentation.clientBaseUrl}/unsubscribe?token={{unsubscribeToken}}`,
      now,
    }),
    template({
      id: EMAIL_TEMPLATE_IDS.newsletter,
      subjectTemplate: "{{subject}}",
      headerPartial: header,
      footerPartial: marketingFooter,
      mainTemplate: `
  <h1 style="margin:0 0 12px;${FONT}font-size:22px;line-height:1.3;font-weight:650;color:${INK}">{{subject}}</h1>
  <p style="margin:0 0 8px;${FONT}font-size:15px;line-height:1.6;color:${INK}">Hello{{#if recipientName}}, {{recipientName}}{{/if}}.</p>
  <p style="margin:0;${FONT}font-size:15px;line-height:1.6;color:${INK}">{{body}}</p>`,
      textTemplate: `{{subject}}\n\n{{body}}\n\nUnsubscribe: ${presentation.clientBaseUrl}/unsubscribe?token={{unsubscribeToken}}`,
      now,
    }),
    template({
      id: EMAIL_TEMPLATE_IDS.generalNotice,
      subjectTemplate: "{{subject}}",
      headerPartial: header,
      footerPartial: marketingFooter,
      mainTemplate: `
  <h1 style="margin:0 0 12px;${FONT}font-size:22px;line-height:1.3;font-weight:650;color:${INK}">{{subject}}</h1>
  <p style="margin:0 0 8px;${FONT}font-size:15px;line-height:1.6;color:${INK}">Hello{{#if recipientName}}, {{recipientName}}{{/if}}.</p>
  <p style="margin:0 0 24px;${FONT}font-size:15px;line-height:1.6;color:${INK}">{{body}}</p>
  {{#if ctaUrl}}
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;border:1px solid ${RULE};border-radius:10px">
    <tr>
      <td style="padding:16px 18px;${FONT}font-size:14px;line-height:1.4;color:${INK}">{{#if ctaLabel}}{{ctaLabel}}{{else}}Continue{{/if}}</td>
      <td style="padding:12px 18px;text-align:right;white-space:nowrap">
        <a href="{{ctaUrl}}" style="display:inline-block;background:${INK};color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:8px;font-size:14px;font-weight:600;${FONT}">{{#if ctaLabel}}{{ctaLabel}}{{else}}Continue{{/if}}</a>
      </td>
    </tr>
  </table>
  {{/if}}`,
      textTemplate: `{{subject}}\n\n{{body}}\n{{#if ctaUrl}}\n{{#if ctaLabel}}{{ctaLabel}}{{else}}Continue{{/if}}: {{ctaUrl}}\n{{/if}}\nUnsubscribe: ${presentation.clientBaseUrl}/unsubscribe?token={{unsubscribeToken}}`,
      now,
    }),
  ];
}

/**
 * Maps auth challenge kinds onto seeded template ids.
 * Marketing templates are never used for transactional auth challenges.
 */
export function templateIdForAuthChallenge(
  kind: "confirm-email" | "reset-password" | "delete-account" | "undo-deletion",
): string {
  switch (kind) {
    case "confirm-email":
      return EMAIL_TEMPLATE_IDS.confirmation;
    case "reset-password":
      return EMAIL_TEMPLATE_IDS.forgetPassword;
    case "delete-account":
      return EMAIL_TEMPLATE_IDS.deleteAccount;
    case "undo-deletion":
      return EMAIL_TEMPLATE_IDS.undoDeletion;
  }
}

function cardShellOpen(): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#f4f4f5;margin:0;padding:0">
<tr>
<td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;max-width:520px;background:#ffffff;border:1px solid ${RULE};border-radius:12px">
<tr>
<td style="padding:32px">`;
}

function cardShellClose(): string {
  return `</td>
</tr>
</table>
</td>
</tr>
</table>`;
}

function cta(href: string, label: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
  <tr>
    <td style="border-radius:8px;background:${INK}">
      <a href="${href}" style="display:inline-block;padding:12px 20px;color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;line-height:1.2;${FONT}">${escapeHtml(label)}</a>
    </td>
  </tr>
</table>`;
}

function codeBlock(tokenExpr: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#fafafa;border:1px solid ${RULE};border-radius:10px">
  <tr>
    <td style="padding:16px 18px;${FONT}font-size:20px;letter-spacing:0.08em;font-weight:650;color:${INK};text-align:center">${tokenExpr}</td>
  </tr>
</table>`;
}

function template(input: {
  id: string;
  subjectTemplate: string;
  headerPartial: string;
  mainTemplate: string;
  footerPartial: string;
  textTemplate: string;
  now: Date;
}): EmailTemplateRecord {
  return {
    id: input.id,
    subjectTemplate: input.subjectTemplate,
    headerPartial: input.headerPartial,
    mainTemplate: input.mainTemplate,
    footerPartial: input.footerPartial,
    textTemplate: input.textTemplate,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}
