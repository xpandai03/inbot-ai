/**
 * Twilio SMS Integration
 *
 * Handles SMS intake via Twilio webhooks.
 * Provides client initialization and TwiML response helpers.
 *
 * Outbound SMS: Only send when record.smsConsent === true.
 * Use canSendSms(record) from @shared/schema to filter recipients (broadcast, follow-ups, manual).
 */

import twilio from "twilio";
import type { Twilio } from "twilio";

// Lazy-initialized Twilio client
let twilioClient: Twilio | null = null;

export function getTwilioClient(): Twilio | null {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    return null;
  }
  if (!twilioClient) {
    twilioClient = twilio(
      process.env.TWILIO_ACCOUNT_SID,
      process.env.TWILIO_AUTH_TOKEN
    );
    console.log("[twilio] Client initialized");
  }
  return twilioClient;
}

// Twilio webhook payload interface (form-urlencoded fields)
export interface TwilioSmsPayload {
  MessageSid: string;
  AccountSid: string;
  From: string;
  To: string;
  Body: string;
  NumMedia?: string;
  NumSegments?: string;
}

/**
 * Parse Twilio webhook form data
 */
export function parseTwilioPayload(body: Record<string, string>): TwilioSmsPayload | null {
  // Required fields
  if (!body.MessageSid || !body.From || !body.Body) {
    console.error("[twilio] Missing required fields in payload");
    return null;
  }

  return {
    MessageSid: body.MessageSid,
    AccountSid: body.AccountSid || "",
    From: body.From,
    To: body.To || "",
    Body: body.Body,
    NumMedia: body.NumMedia,
    NumSegments: body.NumSegments,
  };
}

/**
 * Validate Twilio request signature
 * Optional in Phase 1, but recommended for production
 */
export function validateTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string
): boolean {
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (!authToken) {
    console.warn("[twilio] No auth token, skipping signature validation");
    return true; // Skip validation if no token (dev mode)
  }

  try {
    return twilio.validateRequest(authToken, signature, url, params);
  } catch (error) {
    console.error("[twilio] Signature validation error:", error);
    return false;
  }
}

/**
 * Generate TwiML response for SMS auto-reply
 */
export function generateTwimlResponse(message?: string): string {
  const response = new twilio.twiml.MessagingResponse();

  if (message) {
    response.message(message);
  }

  return response.toString();
}

/**
 * Generate thank-you TwiML with reference ID
 */
export function generateThankYouTwiml(referenceId: number | string): string {
  const message = `Thank you for your report. Reference #${referenceId}. A city representative will follow up.`;
  return generateTwimlResponse(message);
}

/**
 * Generate empty TwiML (no auto-reply)
 */
export function generateEmptyTwiml(): string {
  return generateTwimlResponse();
}

/**
 * Format phone number for display
 */
export function formatPhoneNumber(phone: string): string {
  // Already formatted E.164
  if (phone.startsWith("+")) {
    return phone;
  }
  // Add US country code if missing
  if (phone.length === 10) {
    return `+1${phone}`;
  }
  return phone;
}

/**
 * Check if Twilio is configured
 */
export function isTwilioConfigured(): boolean {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN);
}
