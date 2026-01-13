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

// Words to ignore when extracting bare names
const IGNORE_WORDS = new Set([
  "hello", "hi", "hey", "yeah", "yes", "no", "okay", "ok", "um", "uh",
  "well", "so", "like", "just", "actually", "basically", "please", "thanks",
  "thank", "you", "the", "a", "an", "is", "are", "was", "were", "be",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "must", "can", "need", "want", "got", "get",
  "there", "here", "this", "that", "it", "i", "my", "me", "we", "our",
  "nothing", "something", "anything", "everything", "none", "all"
]);

/**
 * Check if a word looks like a valid name component
 */
function isValidNameWord(word: string): boolean {
  if (!word || word.length < 2) return false;
  if (IGNORE_WORDS.has(word.toLowerCase())) return false;
  // Must start with a letter and contain only letters/hyphens
  return /^[A-Za-z][A-Za-z'-]*$/.test(word);
}

/**
 * Extract caller name from text using multiple patterns
 * Returns { name, source } for logging
 */
function extractNameFromText(text: string): { name: string | null; pattern: string } {
  if (!text) return { name: null, pattern: "empty" };

  // Pattern 1: Explicit name phrases (highest confidence)
  const explicitPatterns = [
    { regex: /(?:my name is|name is)\s+([A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){0,2})/i, name: "my name is" },
    { regex: /(?:i'm|i am)\s+([A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){0,2})/i, name: "i'm" },
    { regex: /(?:this is)\s+([A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){0,2})/i, name: "this is" },
    { regex: /(?:it's|it is)\s+([A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){0,2})/i, name: "it's" },
    { regex: /(?:yeah,?\s*)?(?:it's|it is)\s+([A-Za-z][A-Za-z'-]*(?:\s+[A-Za-z][A-Za-z'-]*){0,2})/i, name: "yeah it's" },
  ];

  for (const { regex, name: patternName } of explicitPatterns) {
    const match = text.match(regex);
    if (match && match[1]) {
      const candidate = match[1].replace(/[.,!?]$/, "").trim();
      const words = candidate.split(/\s+/).filter(isValidNameWord);
      if (words.length >= 1 && words.length <= 3) {
        return { name: words.join(" "), pattern: patternName };
      }
    }
  }

  // Pattern 2: Bare name at start of sentence (e.g., "Johnny Snow. There's a...")
  // Look for 1-3 capitalized words followed by a period or sentence break
  const bareNameMatch = text.match(/^([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})[.,]/);
  if (bareNameMatch && bareNameMatch[1]) {
    const words = bareNameMatch[1].split(/\s+/).filter(isValidNameWord);
    if (words.length >= 1 && words.length <= 3) {
      return { name: words.join(" "), pattern: "bare name" };
    }
  }

  return { name: null, pattern: "no match" };
}

/**
 * Extract caller name from transcript (two-pass)
 * Pass A: artifact.messages (structured)
 * Pass B: transcript string (fallback)
 */
export function extractName(messages: VapiMessage[], transcript?: string): { name: string; source: string } {
  // Pass A: Try artifact.messages
  const userMessages = messages.filter(m => m.role === "user");
  for (const msg of userMessages) {
    const result = extractNameFromText(msg.message);
    if (result.name) {
      return { name: result.name, source: `messages/${result.pattern}` };
    }
  }

  // Pass B: Try transcript string
  if (transcript) {
    const result = extractNameFromText(transcript);
    if (result.name) {
      return { name: result.name, source: `transcript/${result.pattern}` };
    }
  }

  return { name: "Unknown Caller", source: "default" };
}

// Street type suffixes
const STREET_TYPES = "Street|St|Avenue|Ave|Drive|Dr|Road|Rd|Boulevard|Blvd|Lane|Ln|Way|Court|Ct|Place|Pl|Circle|Cir|Terrace|Ter|Trail|Trl|Parkway|Pkwy|Highway|Hwy";

// Spoken number words
const SPOKEN_NUMBERS = "zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand";

/**
 * Extract address from text using multiple patterns
 * Returns { address, source } for logging
 */
function extractAddressFromText(text: string): { address: string | null; pattern: string } {
  if (!text) return { address: null, pattern: "empty" };

  // Pattern 1: Numeric address "123 Main Street"
  const numericPattern = new RegExp(
    `(\\d{1,6}\\s+[A-Za-z][A-Za-z'-]*(?:\\s+[A-Za-z][A-Za-z'-]*){0,3}\\s+(?:${STREET_TYPES}))`,
    "i"
  );
  const numericMatch = text.match(numericPattern);
  if (numericMatch && numericMatch[1]) {
    return { address: numericMatch[1].replace(/[.,!?]$/, "").trim(), pattern: "numeric" };
  }

  // Pattern 2: Spoken number address "fifty four eighty four Main Street"
  const spokenPattern = new RegExp(
    `(((?:${SPOKEN_NUMBERS})(?:\\s+(?:${SPOKEN_NUMBERS}))*)[\\s,]+([A-Za-z][A-Za-z'-]*(?:\\s+[A-Za-z][A-Za-z'-]*){0,3})\\s+(${STREET_TYPES}))`,
    "i"
  );
  const spokenMatch = text.match(spokenPattern);
  if (spokenMatch && spokenMatch[1]) {
    // Store the spoken address as-is (no conversion needed for now)
    return { address: spokenMatch[1].replace(/[.,!?]$/, "").trim(), pattern: "spoken" };
  }

  // Pattern 3: "address is..." or "at..." followed by address-like text
  const prefixPatterns = [
    /(?:address is|my address is|i(?:'m| am) at|i live at|located at)\s+(\d{1,6}\s+[\w\s]+(?:Street|St|Avenue|Ave|Drive|Dr|Road|Rd|Boulevard|Blvd|Lane|Ln|Way|Court|Ct|Place|Pl|Circle|Cir))/i,
    /(?:address is|my address is|i(?:'m| am) at|i live at|located at)\s+([\w\s]+(?:Street|St|Avenue|Ave|Drive|Dr|Road|Rd|Boulevard|Blvd|Lane|Ln|Way|Court|Ct|Place|Pl|Circle|Cir))/i,
  ];

  for (const pattern of prefixPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return { address: match[1].replace(/[.,!?]$/, "").trim(), pattern: "prefix" };
    }
  }

  // Pattern 4: Any text ending in a street type (less confident)
  const anyStreetPattern = new RegExp(
    `([A-Za-z0-9][A-Za-z0-9\\s'-]{3,40}\\s+(?:${STREET_TYPES}))(?:[.,\\s]|$)`,
    "i"
  );
  const anyMatch = text.match(anyStreetPattern);
  if (anyMatch && anyMatch[1]) {
    const candidate = anyMatch[1].replace(/[.,!?]$/, "").trim();
    // Must have at least 2 words
    if (candidate.split(/\s+/).length >= 2) {
      return { address: candidate, pattern: "any-street" };
    }
  }

  return { address: null, pattern: "no match" };
}

/**
 * Extract street address from transcript (two-pass)
 * Pass A: artifact.messages (structured)
 * Pass B: transcript string (fallback)
 */
export function extractAddress(messages: VapiMessage[], transcript?: string): { address: string; source: string } {
  // Pass A: Try artifact.messages
  const userMessages = messages.filter(m => m.role === "user");
  for (const msg of userMessages) {
    const result = extractAddressFromText(msg.message);
    if (result.address) {
      return { address: result.address, source: `messages/${result.pattern}` };
    }
  }

  // Pass B: Try transcript string
  if (transcript) {
    const result = extractAddressFromText(transcript);
    if (result.address) {
      return { address: result.address, source: `transcript/${result.pattern}` };
    }
  }

  return { address: "Not provided", source: "default" };
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
  const transcript = msg.transcript || "";

  console.log("[vapi-transform] ====== EXTRACTION START ======");
  console.log("[vapi-transform] artifact.messages count:", messages.length);
  console.log("[vapi-transform] transcript length:", transcript.length);
  console.log("[vapi-transform] transcript preview:", transcript.substring(0, 200));

  // Extract name with two-pass strategy
  const nameResult = extractName(messages, transcript);
  console.log("[vapi-transform] NAME extracted:", nameResult.name, "| source:", nameResult.source);

  // Extract address with two-pass strategy
  const addressResult = extractAddress(messages, transcript);
  console.log("[vapi-transform] ADDRESS extracted:", addressResult.address, "| source:", addressResult.source);

  // Detect language
  const language = detectLanguage(messages);

  // Build raw text from multiple sources (fallback chain)
  let rawIssueText = buildRawIssueText(messages);
  if (!rawIssueText || rawIssueText === "No issue description provided") {
    rawIssueText = transcript;
  }
  if (!rawIssueText && msg.analysis?.summary) {
    rawIssueText = msg.analysis.summary;
  }

  // Get phone number from FULL payload
  const phone = extractPhoneNumber(payload);

  console.log("[vapi-transform] PHONE extracted:", phone);
  console.log("[vapi-transform] rawText length:", rawIssueText?.length || 0);
  console.log("[vapi-transform] ====== EXTRACTION END ======");

  return {
    name: nameResult.name,
    phone,
    address: addressResult.address,
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
