/**
 * Recording Proxy — HMAC Token Generation & Validation
 *
 * Generates deterministic HMAC-SHA256 tokens for recording URLs
 * so emails link to inbot.ai/api/recordings/:id?tok=<hmac>
 * instead of exposing raw Vapi storage URLs.
 */

import { createHmac, timingSafeEqual } from "crypto";

function getSecret(): string {
  const secret = process.env.RECORDING_SECRET;
  if (!secret) {
    throw new Error(
      "RECORDING_SECRET environment variable is required. " +
      "Generate one with: openssl rand -hex 32"
    );
  }
  return secret;
}

export function generateRecordingToken(recordId: string): string {
  return createHmac("sha256", getSecret()).update(recordId).digest("hex");
}

export function verifyRecordingToken(recordId: string, token: string): boolean {
  const expected = generateRecordingToken(recordId);
  if (expected.length !== token.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(token));
}
