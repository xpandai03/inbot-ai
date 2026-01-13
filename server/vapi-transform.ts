/**
 * Vapi Webhook Payload Transformation
 *
 * Transforms Vapi end-of-call-report payloads into partial IntakeRecord format.
 * Classification (intent/department) is handled by the AI intake classifier.
 */

import type { InsertIntakeRecord } from "@shared/schema";

// Partial record type without classification fields (added by classifier)
export type PartialIntakeRecord = Omit<InsertIntakeRecord, "intent" | "department" | "transcriptSummary">;

// Vapi webhook payload types (relevant fields only)
export interface VapiMessage {
  role: "user" | "bot" | "system";
  message: string;
  time: number;
}

export interface VapiCall {
  id: string;
  type: "webCall" | "inboundPhoneCall" | "outboundPhoneCall";
  customer?: {
    number?: string;
    numberE164?: string;
  };
  phoneNumber?: {
    number?: string;
    numberE164?: string;
  };
}

export interface VapiEndOfCallReport {
  type: "end-of-call-report";
  timestamp: number;
  startedAt: string;
  endedAt: string;
  endedReason: string;
  durationSeconds: number;
  cost: number;
  summary: string;
  transcript: string;
  call: VapiCall;
  artifact?: {
    messages: VapiMessage[];
  };
  analysis?: {
    summary: string;
    successEvaluation: string;
  };
}

export interface VapiWebhookPayload {
  message: VapiEndOfCallReport;
  // Top-level fields (outside message)
  customer?: {
    number?: string;
    numberE164?: string;
  };
  transport?: {
    callSid?: string;
  };
}

/**
 * Check if payload is a valid Vapi end-of-call-report
 */
export function isEndOfCallReport(payload: unknown): payload is VapiWebhookPayload {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as Record<string, unknown>;
  if (!p.message || typeof p.message !== "object") return false;
  const msg = p.message as Record<string, unknown>;
  return msg.type === "end-of-call-report";
}

/**
 * Extract caller name from transcript
 * Looks for patterns like "it's [Name]", "my name is [Name]", etc.
 */
export function extractName(messages: VapiMessage[]): string {
  const userMessages = messages.filter(m => m.role === "user");

  for (const msg of userMessages) {
    const text = msg.message;

    // Pattern: "it's [Name]", "name is [Name]", "I'm [Name]", "this is [Name]"
    const namePatterns = [
      /(?:it's|it is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
      /(?:my name is|name is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
      /(?:I'm|I am)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
      /(?:this is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
      // Pattern for "Yeah, it's [Name]" style responses
      /(?:yeah,?\s+)?(?:it's|it is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
    ];

    for (const pattern of namePatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        // Clean up the name (remove trailing punctuation)
        return match[1].replace(/[.,!?]$/, "").trim();
      }
    }
  }

  return "Unknown Caller";
}

/**
 * Extract street address from transcript
 * Looks for patterns containing street indicators
 */
export function extractAddress(messages: VapiMessage[]): string {
  const userMessages = messages.filter(m => m.role === "user");

  for (const msg of userMessages) {
    const text = msg.message;

    // Pattern for street addresses: numbers followed by street names
    const addressPatterns = [
      // "123 Main Street" or "123 Main St"
      /(\d+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s+(?:Street|St|Avenue|Ave|Drive|Dr|Road|Rd|Boulevard|Blvd|Lane|Ln|Way|Court|Ct|Place|Pl))/i,
      // "twelve sixty five Stearns Drive" (spelled out numbers)
      /((?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)[\s\w]*(?:Street|St|Avenue|Ave|Drive|Dr|Road|Rd|Boulevard|Blvd|Lane|Ln|Way|Court|Ct|Place|Pl))/i,
    ];

    for (const pattern of addressPatterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        return match[1].replace(/[.,!?]$/, "").trim();
      }
    }
  }

  return "Not provided";
}

/**
 * Build raw issue text from user messages
 */
export function buildRawIssueText(messages: VapiMessage[]): string {
  return messages
    .filter(m => m.role === "user")
    .map(m => m.message)
    .join(" ")
    .trim() || "No issue description provided";
}

// NOTE: classifyDepartment and classifyIntent have been moved to
// server/intake-classifier.ts which uses LLM-based classification

/**
 * Detect language from transcript (simple heuristic)
 */
export function detectLanguage(messages: VapiMessage[]): string {
  const userText = messages
    .filter(m => m.role === "user")
    .map(m => m.message)
    .join(" ");

  // Simple Spanish detection - check for common Spanish words
  const spanishIndicators = /\b(hola|gracias|por favor|calle|donde|necesito|problema|ayuda)\b/i;
  if (spanishIndicators.test(userText)) {
    return "Spanish";
  }

  return "English";
}

/**
 * Extract phone number from Vapi payload
 * Checks multiple possible locations - top-level and nested
 */
export function extractPhoneNumber(payload: VapiWebhookPayload): string {
  // Try TOP-LEVEL customer first (actual Vapi structure)
  const topLevelCustomer = payload.customer?.numberE164 || payload.customer?.number;
  if (topLevelCustomer) return topLevelCustomer;

  // Try nested call.customer (older Vapi versions)
  const call = payload.message?.call;
  if (call) {
    const nestedCustomer = call.customer?.numberE164 || call.customer?.number;
    if (nestedCustomer) return nestedCustomer;

    // Try phoneNumber object
    const phoneNumber = call.phoneNumber?.numberE164 || call.phoneNumber?.number;
    if (phoneNumber) return phoneNumber;

    // Web calls don't have phone numbers
    if (call.type === "webCall") return "(Web Call)";
  }

  return "(Unknown)";
}

/**
 * Transform Vapi end-of-call-report into partial IntakeRecord
 * Returns record without intent/department/summary - those are added by the classifier
 */
export function transformVapiToIntakeRecord(payload: VapiWebhookPayload): PartialIntakeRecord & { rawText: string } {
  const msg = payload.message;
  const messages = msg.artifact?.messages || [];

  // Extract fields from transcript
  const name = extractName(messages);
  const address = extractAddress(messages);
  const language = detectLanguage(messages);

  // Build raw text from multiple sources (fallback chain)
  let rawIssueText = buildRawIssueText(messages);
  if (!rawIssueText || rawIssueText === "No issue description provided") {
    // Try transcript string directly
    rawIssueText = msg.transcript || "";
  }
  if (!rawIssueText && msg.analysis?.summary) {
    // Use analysis summary as last resort
    rawIssueText = msg.analysis.summary;
  }

  // Get phone number from FULL payload (not just msg.call)
  const phone = extractPhoneNumber(payload);

  console.log("[vapi-transform] Extracted - name:", name, "phone:", phone, "rawText length:", rawIssueText?.length);

  return {
    name,
    phone,
    address,
    channel: "Voice",
    language,
    durationSeconds: Math.round(msg.durationSeconds || 0),
    cost: msg.cost || 0,
    timestamp: msg.endedAt || new Date().toISOString(),
    clientId: "client_demo", // Hardcoded for Phase 1
    // Raw text for classification (not stored, used by classifier)
    rawText: rawIssueText || "No description provided",
  };
}

/**
 * Get call ID for idempotency checks
 * Checks transport.callSid (top-level) and message.call.id (nested)
 */
export function getCallId(payload: VapiWebhookPayload): string | null {
  // Try transport.callSid first (actual Vapi structure)
  if (payload.transport?.callSid) {
    return payload.transport.callSid;
  }
  // Fallback to nested call.id
  return payload.message?.call?.id || null;
}
