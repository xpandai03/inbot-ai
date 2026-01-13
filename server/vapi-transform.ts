/**
 * Vapi Webhook Payload Transformation
 *
 * Transforms Vapi end-of-call-report payloads into IntakeRecord format
 * for storage in Supabase.
 */

import type { InsertIntakeRecord } from "@shared/schema";

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

/**
 * Classify department based on issue keywords
 */
export function classifyDepartment(rawIssueText: string): string {
  const text = rawIssueText.toLowerCase();

  // Public Works - infrastructure issues
  if (/pothole|road|street|sidewalk|light|lamp|traffic|sign|drain|sewer|water main|pavement/.test(text)) {
    return "Public Works";
  }

  // Public Safety - safety and emergency
  if (/safety|emergency|crime|police|fire|danger|accident|threat|suspicious/.test(text)) {
    return "Public Safety";
  }

  // Finance / Revenue - billing and payments
  if (/tax|bill|payment|fee|permit|license|fine|revenue/.test(text)) {
    return "Finance";
  }

  // Parks & Public Property
  if (/park|playground|recreation|facility|building|property|trash|garbage|litter/.test(text)) {
    return "Parks & Recreation";
  }

  // Sanitation
  if (/trash|garbage|pickup|collection|waste|recycl/.test(text)) {
    return "Sanitation";
  }

  return "General";
}

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
 * Transform Vapi end-of-call-report into IntakeRecord
 */
export function transformVapiToIntakeRecord(payload: VapiWebhookPayload): InsertIntakeRecord {
  const msg = payload.message;
  const messages = msg.artifact?.messages || [];

  // Extract fields from transcript
  const name = extractName(messages);
  const address = extractAddress(messages);
  const rawIssueText = buildRawIssueText(messages);
  const department = classifyDepartment(rawIssueText);
  const language = detectLanguage(messages);

  // Get phone number (only available for phone calls, not web calls)
  const phone = msg.call?.customer?.number || "(Web Call)";

  // Use summary from analysis or top-level
  const summary = msg.analysis?.summary || msg.summary || "Call completed";

  return {
    name,
    phone,
    address,
    intent: rawIssueText,
    department,
    channel: "Voice",
    language,
    durationSeconds: Math.round(msg.durationSeconds || 0),
    cost: msg.cost || 0,
    timestamp: msg.endedAt || new Date().toISOString(),
    transcriptSummary: summary,
    clientId: "client_demo", // Hardcoded for Phase 1
  };
}

/**
 * Get call ID for idempotency checks
 */
export function getCallId(payload: VapiWebhookPayload): string | null {
  return payload.message?.call?.id || null;
}
