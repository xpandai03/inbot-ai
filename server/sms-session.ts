/**
 * SMS Session Management for Guided Intake
 *
 * Implements an order-agnostic, multi-turn SMS intake agent that collects
 * name, address, and issue regardless of message order.
 *
 * Key behaviors:
 * - Order-agnostic: extracts all fields from every message
 * - Last message wins: corrections overwrite previous values
 * - Only completes when name + address + issue are all present
 * - Asks for ONE missing field at a time (issue → address → name)
 * - Minimal confirmation: "Got it.", "Updated.", no read-backs
 * - TTL and max-message safety guards prevent runaway sessions
 */

import { extractSmsFields, type SmsExtractionResult } from "./vapi-transform";

// ============================================================
// FEATURE FLAG
// ============================================================

export function isGuidedSmsEnabled(): boolean {
  return process.env.SMS_GUIDED_INTAKE_ENABLED === "true";
}

// ============================================================
// SESSION INTERFACE
// ============================================================

export type SmsFieldName = "name" | "address" | "issue";

export interface SmsSession {
  phoneNumber: string;        // E.164 format, session key
  createdAt: Date;
  lastActivityAt: Date;
  name: string | null;
  address: string | null;
  issue: string | null;
  messageHistory: string[];   // raw messages for classification
  messageCount: number;
  askedFields: Set<SmsFieldName>;
  completed: boolean;
}

// ============================================================
// SESSION STORAGE (In-Memory)
// ============================================================

const sessionStore = new Map<string, SmsSession>();

// Configuration
const SESSION_TTL_MS = 20 * 60 * 1000;     // 20 minutes
const MAX_MESSAGES_PER_SESSION = 5;
const MAX_SESSIONS = 10000;                 // Memory safeguard
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

// ============================================================
// FOLLOW-UP TEMPLATES (minimal, no read-backs)
// ============================================================

const FOLLOW_UP_ISSUE = "Thanks for reaching out! What issue would you like to report?";
const FOLLOW_UP_ADDRESS = "Got it. What's the street address where this is happening?";
const FOLLOW_UP_NAME = "Thanks. Could you share your full name for our records?";
const THANK_YOU_TEMPLATE = (refId: string) =>
  `Thank you. Your report has been recorded. Reference #${refId}.`;

// ============================================================
// RESULT TYPES
// ============================================================

export type SmsFlowResult =
  | { action: "ask_followup"; message: string; session: SmsSession }
  | { action: "complete"; session: SmsSession; reason: "all_fields" | "max_messages" }
  | { action: "timeout"; session: SmsSession; hadData: boolean }
  | { action: "cancelled"; session: SmsSession };

export interface SmsSessionDebugInfo {
  phoneLast4: string;
  createdAt: string;
  lastActivityAt: string;
  hasName: boolean;
  hasAddress: boolean;
  hasIssue: boolean;
  askedFields: string[];
  messageCount: number;
  ageMs: number;
  completed: boolean;
}

// ============================================================
// SESSION MANAGEMENT
// ============================================================

/**
 * Get or create a session for a phone number
 * Phone numbers are normalized to E.164 format
 */
export function getOrCreateSession(phoneNumber: string): SmsSession {
  const normalizedPhone = normalizePhoneNumber(phoneNumber);

  let session = sessionStore.get(normalizedPhone);

  if (session) {
    // Check if session has expired
    const age = Date.now() - session.lastActivityAt.getTime();
    if (age > SESSION_TTL_MS) {
      console.log(`[sms-session] EXPIRED phone=*${normalizedPhone.slice(-4)} age=${Math.round(age / 1000)}s`);
      // Don't delete here - let the caller handle timeout completion
      return session;
    }

    session.lastActivityAt = new Date();
    console.log(`[sms-session] GET phone=*${normalizedPhone.slice(-4)} messageCount=${session.messageCount}`);
    return session;
  }

  // Create new session
  session = {
    phoneNumber: normalizedPhone,
    createdAt: new Date(),
    lastActivityAt: new Date(),
    name: null,
    address: null,
    issue: null,
    messageHistory: [],
    messageCount: 0,
    askedFields: new Set(),
    completed: false,
  };

  // Memory safeguard: if we hit max sessions, remove oldest
  if (sessionStore.size >= MAX_SESSIONS) {
    const oldestKey = findOldestSession();
    if (oldestKey) {
      console.log(`[sms-session] MAX_SESSIONS reached, removing oldest: *${oldestKey.slice(-4)}`);
      sessionStore.delete(oldestKey);
    }
  }

  sessionStore.set(normalizedPhone, session);
  console.log(`[sms-session] CREATE phone=*${normalizedPhone.slice(-4)}`);

  return session;
}

/**
 * Delete a session (called after completion)
 */
export function deleteSession(phoneNumber: string): void {
  const normalizedPhone = normalizePhoneNumber(phoneNumber);
  sessionStore.delete(normalizedPhone);
  console.log(`[sms-session] DELETE phone=*${normalizedPhone.slice(-4)}`);
}

/**
 * Check if a session exists for a phone number
 */
export function hasSession(phoneNumber: string): boolean {
  return sessionStore.has(normalizePhoneNumber(phoneNumber));
}

/**
 * Check if a session has expired
 */
export function isSessionExpired(session: SmsSession): boolean {
  const age = Date.now() - session.lastActivityAt.getTime();
  return age > SESSION_TTL_MS;
}

// ============================================================
// CANCEL / STOP DETECTION
// ============================================================

const CANCEL_PATTERNS = /^\s*(cancel|stop|quit|end|nevermind|never\s*mind)\s*[.!]?\s*$/i;

function isCancelMessage(text: string): boolean {
  return CANCEL_PATTERNS.test(text.trim());
}

// ============================================================
// ISSUE DETECTION
// ============================================================

/**
 * Detect if a message contains an issue/problem description.
 * Returns the issue text if found, null otherwise.
 *
 * An issue is anything that describes a problem, complaint, or report —
 * NOT just a name or address response.
 */
function detectIssue(rawMessage: string, extraction: SmsExtractionResult): string | null {
  const trimmed = rawMessage.trim();
  if (!trimmed) return null;

  // If extraction found both name and address, the rest is likely context
  // but the whole message describes the issue
  const hasExtractedName = extraction.nameSource !== "default";
  const hasExtractedAddress = extraction.addressSource !== "default";

  // If the message is ONLY a name (short, no address-like content, no verbs),
  // it's probably a response to "What's your name?" — NOT an issue.
  if (hasExtractedName && !hasExtractedAddress && trimmed.split(/\s+/).length <= 3 && !looksLikeIssue(trimmed)) {
    return null;
  }

  // If the message is ONLY an address, it's not an issue.
  if (hasExtractedAddress && !hasExtractedName && !looksLikeIssue(trimmed)) {
    return null;
  }

  // If the message contains issue-like language, it's an issue
  if (looksLikeIssue(trimmed)) {
    return trimmed;
  }

  // If extraction found name+address in a longer message, the full message is the issue
  if (hasExtractedName && hasExtractedAddress && trimmed.length > 30) {
    return trimmed;
  }

  // Long messages (>50 chars) that aren't pure name/address are likely issues
  if (trimmed.length > 50) {
    return trimmed;
  }

  return null;
}

/**
 * Heuristic: does the text look like it describes a problem/issue?
 */
function looksLikeIssue(text: string): boolean {
  // NOTE: "street", "road", "park", "alley" removed — they are address components
  // that cause false positives (e.g. "3344 Fantastic Street" detected as issue)
  const issuePatterns = /\b(report|pothole|leak|flood|broken|damage|trash|garbage|graffiti|noise|homeless|abandoned|fire|smoke|sewer|drain|water|light|pole|cable|hanging|down|out|blocked|clogged|someone|person|backyard|front\s*yard|sidewalk|problem|issue|complaint|hazard|danger|emergency|smell|odor|animal|dog|cat|rat|mice|roach|bed\s*bug|mold|code\s*violation|illegal|dumping|construction|tree|branch|fallen|overgrown|weed|sign|signal|crosswalk|speed|loud|music|party|fight|suspicious|vehicle|car|parking|tow|abandon|vacant|boarded)\b/i;
  // Spanish issue keywords
  const spanishIssuePatterns = /\b(reportar|bache|fuga|inundaci[oó]n|roto|basura|grafiti|ruido|incendio|humo|drenaje|agua|luz|poste|cable|colgando|ca[ií]do|bloqueado|alguien|persona|problema|queja|peligro|emergencia|olor|animal|perro|gato|rata|cucaracha|moho|violaci[oó]n|ilegal|construcci[oó]n|[aá]rbol|rama|maleza|se[nñ]al)\b/i;

  return issuePatterns.test(text) || spanishIssuePatterns.test(text);
}

// ============================================================
// GUIDED FLOW LOGIC
// ============================================================

/**
 * Process an incoming SMS with session state.
 *
 * Order-agnostic flow:
 * 1. Check for cancel/stop
 * 2. Extract ALL fields from current message
 * 3. Merge into session (last message wins)
 * 4. If all fields present → COMPLETE
 * 5. Ask for next missing field (issue → address → name)
 */
export async function processSmsWithSession(
  phoneNumber: string,
  messageBody: string
): Promise<SmsFlowResult> {
  const session = getOrCreateSession(phoneNumber);

  // Check for timeout first
  if (isSessionExpired(session)) {
    const hadData = !!(session.name || session.address || session.issue);
    return { action: "timeout", session, hadData };
  }

  // Check for cancel/stop
  if (isCancelMessage(messageBody)) {
    console.log(`[sms-session] CANCEL phone=*${phoneNumber.slice(-4)}`);
    session.completed = true;
    return { action: "cancelled", session };
  }

  // Update session
  session.lastActivityAt = new Date();
  session.messageCount++;
  session.messageHistory.push(messageBody);

  console.log(`[sms-session] PROCESS phone=*${phoneNumber.slice(-4)} msgNum=${session.messageCount}`);

  // Check max messages — but NEVER complete without all 3 fields
  if (session.messageCount > MAX_MESSAGES_PER_SESSION) {
    const hasAll = !!session.name && !!session.address && !!session.issue;
    if (hasAll) {
      console.log(`[sms-session] MAX_MESSAGES phone=*${phoneNumber.slice(-4)} — all fields present, completing`);
      return { action: "complete", session, reason: "max_messages" };
    }
    console.log(`[sms-session] MAX_MESSAGES phone=*${phoneNumber.slice(-4)} — fields missing (name=${!!session.name} addr=${!!session.address} issue=${!!session.issue}), continuing`);
    // Fall through to extraction + ask for missing field
  }

  // Extract fields from current message
  const extraction = await extractSmsFields(messageBody);
  console.log(`[sms-session] EXTRACT name=${extraction.name}(${extraction.nameSource}) address=${extraction.address}(${extraction.addressSource})`);

  // Merge extracted fields into session (last message wins)
  mergeExtractionIntoSession(session, extraction, messageBody);

  // Determine next action
  const result = determineNextAction(session, messageBody, extraction);
  console.log(`[sms-session] ACTION=${result.action} phone=*${phoneNumber.slice(-4)} name=${!!session.name} addr=${!!session.address} issue=${!!session.issue}`);

  return result;
}

/**
 * Merge extraction results into session state.
 * LAST MESSAGE WINS — corrections overwrite previous values.
 */
function mergeExtractionIntoSession(
  session: SmsSession,
  extraction: SmsExtractionResult,
  rawMessage: string
): void {
  const phoneLast4 = session.phoneNumber.slice(-4);

  // Name: always overwrite if extraction found a real name
  if (extraction.nameSource !== "default") {
    const prev = session.name;
    session.name = extraction.name;
    if (prev && prev !== extraction.name) {
      console.log(`[sms-session] OVERWRITE phone=*${phoneLast4} field=name "${prev}" → "${extraction.name}"`);
    } else if (!prev) {
      console.log(`[sms-session] SET phone=*${phoneLast4} field=name value="${extraction.name}"`);
    }
  }

  // Address: always overwrite if extraction found a real address
  if (extraction.addressSource !== "default") {
    const prev = session.address;
    session.address = extraction.address;
    if (prev && prev !== extraction.address) {
      console.log(`[sms-session] OVERWRITE phone=*${phoneLast4} field=address "${prev}" → "${extraction.address}"`);
    } else if (!prev) {
      console.log(`[sms-session] SET phone=*${phoneLast4} field=address value="${extraction.address}"`);
    }
  }

  // Issue: detect from message content (not auto-set from history)
  const detectedIssue = detectIssue(rawMessage, extraction);
  if (detectedIssue) {
    const prev = session.issue;
    session.issue = detectedIssue;
    if (prev && prev !== detectedIssue) {
      console.log(`[sms-session] OVERWRITE phone=*${phoneLast4} field=issue "${prev.substring(0, 40)}..." → "${detectedIssue.substring(0, 40)}..."`);
    } else if (!prev) {
      console.log(`[sms-session] SET phone=*${phoneLast4} field=issue value="${detectedIssue.substring(0, 60)}..."`);
    }
  }

  // Follow-up acceptance: if we asked for a specific field and the user replied
  // with something the extractor didn't recognize, accept it leniently.
  if (session.messageCount > 1) {
    const trimmed = rawMessage.trim();
    if (trimmed.length === 0) return;

    // Asked for name, extraction didn't find one, short non-address response → accept as name
    if (session.askedFields.has("name") && !session.name && extraction.nameSource === "default") {
      if (trimmed.length < 50 && !looksLikeAddress(trimmed) && !looksLikeIssue(trimmed)) {
        session.name = trimmed;
        console.log(`[sms-session] ACCEPT_RAW phone=*${phoneLast4} field=name value="${trimmed}"`);
      }
    }

    // Asked for address, extraction didn't find one → accept if it has some structure
    if (session.askedFields.has("address") && !session.address && extraction.addressSource === "default") {
      if (trimmed.length >= 3 && trimmed.length < 100) {
        session.address = trimmed;
        console.log(`[sms-session] ACCEPT_RAW phone=*${phoneLast4} field=address value="${trimmed}"`);
      }
    }

    // Asked for issue, nothing detected → accept any substantive text as issue
    if (session.askedFields.has("issue") && !session.issue) {
      if (trimmed.length >= 5) {
        session.issue = trimmed;
        console.log(`[sms-session] ACCEPT_RAW phone=*${phoneLast4} field=issue value="${trimmed.substring(0, 60)}..."`);
      }
    }
  }
}

/**
 * Determine the next action based on session state.
 *
 * Ask priority (most natural for texting):
 *   1. issue (people text about problems first)
 *   2. address (tied to the issue)
 *   3. name (least natural to volunteer)
 *
 * Only asks for ONE field at a time.
 * Never repeats a question already asked.
 * Completes ONLY when all three fields are present.
 */
function determineNextAction(
  session: SmsSession,
  rawMessage: string,
  extraction: SmsExtractionResult,
): SmsFlowResult {
  const hasName = !!session.name;
  const hasAddress = !!session.address;
  const hasIssue = !!session.issue;

  // All fields present → COMPLETE
  if (hasName && hasAddress && hasIssue) {
    session.completed = true;
    return { action: "complete", session, reason: "all_fields" };
  }

  // Build prefix acknowledgement based on what was just captured
  const justCapturedFields: string[] = [];
  if (extraction.nameSource !== "default") justCapturedFields.push("name");
  if (extraction.addressSource !== "default") justCapturedFields.push("address");
  if (session.issue && session.messageCount === 1) justCapturedFields.push("issue");

  // Check if a field was overwritten (correction)
  const wasCorrection = rawMessage.toLowerCase().includes("wrong") ||
    rawMessage.toLowerCase().includes("actually") ||
    rawMessage.toLowerCase().includes("correction") ||
    rawMessage.toLowerCase().includes("update");

  let prefix = "";
  if (wasCorrection) {
    prefix = "Updated. ";
  } else if (justCapturedFields.length > 0 && session.messageCount > 1) {
    prefix = "Got it. ";
  }

  // Ask for missing fields in priority order: issue → address → name
  if (!hasIssue && !session.askedFields.has("issue")) {
    session.askedFields.add("issue");
    return { action: "ask_followup", message: prefix + FOLLOW_UP_ISSUE, session };
  }

  if (!hasAddress && !session.askedFields.has("address")) {
    session.askedFields.add("address");
    return { action: "ask_followup", message: prefix + FOLLOW_UP_ADDRESS, session };
  }

  if (!hasName && !session.askedFields.has("name")) {
    session.askedFields.add("name");
    return { action: "ask_followup", message: prefix + FOLLOW_UP_NAME, session };
  }

  // We've asked for all missing fields at least once.
  // If a field is STILL missing, ask again (one more chance).
  // This handles: user ignored the question and sent something else.
  if (!hasIssue) {
    return { action: "ask_followup", message: prefix + FOLLOW_UP_ISSUE, session };
  }
  if (!hasAddress) {
    return { action: "ask_followup", message: prefix + FOLLOW_UP_ADDRESS, session };
  }
  if (!hasName) {
    return { action: "ask_followup", message: prefix + FOLLOW_UP_NAME, session };
  }

  // Shouldn't reach here (all fields check above), but safety net
  session.completed = true;
  return { action: "complete", session, reason: "all_fields" };
}

/**
 * Simple heuristic to check if text looks like an address
 */
function looksLikeAddress(text: string): boolean {
  const streetTypes = /\b(street|st|avenue|ave|drive|dr|road|rd|boulevard|blvd|lane|ln|way|court|ct|place|pl|circle|cir|calle|avenida)\b/i;
  const hasNumber = /^\d+\s+/.test(text);
  return streetTypes.test(text) || hasNumber;
}

// ============================================================
// RECORD CREATION HELPERS
// ============================================================

/**
 * HARD GUARD: Check if session has all 3 required fields.
 * Must be called before record creation.
 */
export function isSessionComplete(session: SmsSession): boolean {
  return !!session.name && !!session.address && !!session.issue;
}

/**
 * Get finalized session data for record creation.
 * Applies defaults for any missing fields.
 * IMPORTANT: Only call this AFTER verifying isSessionComplete() for normal completion.
 * Timeout/abandoned sessions may call this with missing fields — that's expected.
 */
export function getFinalizedSessionData(session: SmsSession): {
  name: string;
  address: string;
  issue: string;
} {
  return {
    name: session.name || "Unknown (SMS)",
    address: session.address || "Not provided",
    issue: session.issue || session.messageHistory.join(" | ") || "No description provided",
  };
}

/**
 * Generate thank you message with reference ID
 */
export function getThankYouMessage(referenceId: string): string {
  return THANK_YOU_TEMPLATE(referenceId.substring(0, 8));
}

// ============================================================
// TIMEOUT & CLEANUP
// ============================================================

/**
 * Get all expired sessions for batch processing
 */
export function getExpiredSessions(): SmsSession[] {
  const expired: SmsSession[] = [];
  const now = Date.now();

  Array.from(sessionStore.values()).forEach((session) => {
    const age = now - session.lastActivityAt.getTime();
    if (age > SESSION_TTL_MS) {
      expired.push(session);
    }
  });

  return expired;
}

/**
 * Run cleanup of expired sessions
 * Returns sessions that were cleaned up (for timeout record creation)
 */
export function cleanupExpiredSessions(): SmsSession[] {
  const expired = getExpiredSessions();

  for (const session of expired) {
    const hadData = !!(session.name || session.address || session.issue);
    console.log(`[sms-session] TIMEOUT phone=*${session.phoneNumber.slice(-4)} hadData=${hadData}`);
    sessionStore.delete(session.phoneNumber);
  }

  if (expired.length > 0 || sessionStore.size > 0) {
    console.log(`[sms-session] Session count: ${sessionStore.size}`);
  }

  return expired;
}

/**
 * Find the oldest session (for memory safeguard)
 */
function findOldestSession(): string | null {
  let oldestKey: string | null = null;
  let oldestTime: number = Infinity;

  const entries = Array.from(sessionStore.entries());
  for (let i = 0; i < entries.length; i++) {
    const [key, session] = entries[i];
    const time = session.lastActivityAt.getTime();
    if (time < oldestTime) {
      oldestTime = time;
      oldestKey = key;
    }
  }

  return oldestKey;
}

// ============================================================
// CLEANUP TIMER
// ============================================================

let cleanupTimerId: ReturnType<typeof setInterval> | null = null;

/**
 * Start the background cleanup timer
 * Called on server startup
 */
export function startCleanupTimer(
  onTimeout?: (session: SmsSession) => Promise<void>
): void {
  if (cleanupTimerId) {
    console.log("[sms-session] Cleanup timer already running");
    return;
  }

  cleanupTimerId = setInterval(async () => {
    const expired = cleanupExpiredSessions();

    // If callback provided, process timeouts
    if (onTimeout) {
      for (const session of expired) {
        try {
          await onTimeout(session);
        } catch (error) {
          console.error(`[sms-session] Error processing timeout for *${session.phoneNumber.slice(-4)}:`, error);
        }
      }
    }
  }, CLEANUP_INTERVAL_MS);

  console.log(`[sms-session] Cleanup timer started (interval: ${CLEANUP_INTERVAL_MS / 1000}s)`);
}

/**
 * Stop the background cleanup timer
 * Called on server shutdown
 */
export function stopCleanupTimer(): void {
  if (cleanupTimerId) {
    clearInterval(cleanupTimerId);
    cleanupTimerId = null;
    console.log("[sms-session] Cleanup timer stopped");
  }
}

// ============================================================
// DEBUG & OBSERVABILITY
// ============================================================

/**
 * Get all active sessions for debugging
 * Returns sanitized session info (no full phone numbers)
 */
export function getAllActiveSessions(): SmsSessionDebugInfo[] {
  const sessions: SmsSessionDebugInfo[] = [];
  const now = Date.now();

  Array.from(sessionStore.values()).forEach((session) => {
    sessions.push({
      phoneLast4: session.phoneNumber.slice(-4),
      createdAt: session.createdAt.toISOString(),
      lastActivityAt: session.lastActivityAt.toISOString(),
      hasName: !!session.name,
      hasAddress: !!session.address,
      hasIssue: !!session.issue,
      askedFields: Array.from(session.askedFields),
      messageCount: session.messageCount,
      ageMs: now - session.lastActivityAt.getTime(),
      completed: session.completed,
    });
  });

  return sessions;
}

/**
 * Get session count
 */
export function getSessionCount(): number {
  return sessionStore.size;
}

/**
 * Get session by phone number for debugging
 */
export function getSessionDebugInfo(phoneNumber: string): SmsSessionDebugInfo | null {
  const session = sessionStore.get(normalizePhoneNumber(phoneNumber));
  if (!session) return null;

  const now = Date.now();
  return {
    phoneLast4: session.phoneNumber.slice(-4),
    createdAt: session.createdAt.toISOString(),
    lastActivityAt: session.lastActivityAt.toISOString(),
    hasName: !!session.name,
    hasAddress: !!session.address,
    hasIssue: !!session.issue,
    askedFields: Array.from(session.askedFields),
    messageCount: session.messageCount,
    ageMs: now - session.lastActivityAt.getTime(),
    completed: session.completed,
  };
}

/**
 * Clear session by phone number (for debugging)
 */
export function clearSession(phoneNumber: string): boolean {
  const normalizedPhone = normalizePhoneNumber(phoneNumber);
  const existed = sessionStore.has(normalizedPhone);
  sessionStore.delete(normalizedPhone);
  if (existed) {
    console.log(`[sms-session] CLEAR phone=*${normalizedPhone.slice(-4)} (manual)`);
  }
  return existed;
}

// ============================================================
// UTILITIES
// ============================================================

/**
 * Normalize phone number to E.164 format
 * Simple normalization - strips non-digit chars and ensures + prefix
 */
function normalizePhoneNumber(phone: string): string {
  // Remove all non-digit characters except +
  let normalized = phone.replace(/[^\d+]/g, "");

  // Ensure + prefix
  if (!normalized.startsWith("+")) {
    // Assume US number if 10 digits
    if (normalized.length === 10) {
      normalized = "+1" + normalized;
    } else if (normalized.length === 11 && normalized.startsWith("1")) {
      normalized = "+" + normalized;
    }
  }

  return normalized;
}
