import type { CountryCode } from "../country-code/index.js";

export type LoginProvider = "local" | "google" | "github" | "facebook";
export type UserRole = "user" | "admin";
export type RiskLevel = "low" | "medium" | "high";
export type ClientPlatform = "browser" | "ios" | "android" | "cli" | "other";

export interface AuthProfile {
  userId: string;
  name: string;
  email: string | null;
  phone: string | null;
  emailVerified: boolean;
  phoneVerified: boolean;
  countryCode: CountryCode | null;
  role: UserRole;
  status: "pending" | "active" | "deletion-pending" | "deleted";
  deletionRequestedAt: Date | null;
  deletionScheduledFor: Date | null;
  profileImageUrl: string | null;
  profileImageSource: "provider" | "user" | null;
}

export interface AuthRequestContext {
  correlationId: string;
  ipAddress: string;
  countryCode?: CountryCode;
  userAgent?: string;
  deviceId?: string;
  platform: ClientPlatform;
  cloudFront?: {
    ja3?: string;
    ja4?: string;
    asn?: string;
    device?: "desktop" | "mobile" | "tablet" | "smart-tv" | "unknown";
  };
}

export interface AuthSession {
  token: string;
  expiresAt: Date;
  idleExpiresAt: Date;
  profile: AuthProfile;
  permissions: readonly string[];
  riskLevel: RiskLevel;
  reauthenticationRequired: boolean;
}

export interface LoginAuditRecord {
  userId: string | null;
  provider: LoginProvider;
  outcome: "succeeded" | "rejected";
  riskLevel: RiskLevel;
  reason: string;
  context: AuthRequestContext;
  occurredAt: Date;
}
