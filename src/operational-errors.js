import { randomUUID } from "node:crypto";

export const FAILURE_CODES = new Set([
  "invalid_identifier", "provider_no_match", "provider_unavailable",
  "cover_no_text", "cover_no_match", "homebox_failure"
]);

export class OperationalError extends Error {
  constructor(code, message, { status = 422, attempts = [], details, cause } = {}) {
    super(message, { cause });
    this.name = "OperationalError";
    this.code = code;
    this.status = status;
    this.attempts = attempts;
    this.details = details;
  }
}

export function correlationId() {
  return randomUUID();
}

export function providerAttempt(provider, outcome) {
  return { provider: String(provider), outcome: String(outcome) };
}

export function safeError(error, fallbackCode = "provider_unavailable") {
  if (error instanceof OperationalError) return error;
  return new OperationalError(fallbackCode, "An integration is temporarily unavailable", {
    status: 502, cause: error
  });
}
