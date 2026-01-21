/**
 * SMS Session Management for Guided Intake
 *
 * Implements a lightweight, goal-oriented SMS intake agent that collects
 * name, address, and issue through a minimal guided flow.
 *
 * Key behaviors:
 * - At most ONE follow-up per missing field
 * - Terminates cleanly after completion or max follow-ups
 * - Session state is phone-scoped and ephemeral (in-memory only)
 * - TTL-based cleanup prevents memory leaks
 */

import { extractSmsFields, type SmsExtractionResult } from "./vapi-transform";

// ============================================================
// FEATURE FLAG
// ============================================================
// Set SMS_GUIDED_INTAKE_ENABLED=true to enable guided SMS flow
// When disabled, old single-pass behavior is used
// ============================================================

export function isGuidedSmsEnabled(): boolean {
  return process.env.SMS_GUIDED_INTAKE_ENABLED === "true";
}

// ============================================================
// SESSION INTERFACE
// ============================================================

export interface SmsSession {
  phoneNumber: string;        // E.164 format, session key
  createdAt: Date;
  lastActivityAt: Date;
  name: string | null;
  address: string | null;
  issue: string | null;
  askedForName: boolean;      // true = already asked once
  askedForAddress: boolean;
  messageHistory: string[];   // raw messages for classification
  messageCount: number;       // track number of messages in session
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
// FOLLOW-UP TEMPLATES
// ============================================================

const FOLLOW_UP_NAME = "Thanks! To help us serve you, could you share your name?";
const FOLLOW_UP_ADDRESS = "Got it! What's the street address for this issue?";
const THANK_YOU_TEMPLATE = (refId: string) =>
  `Thank you for your report. Reference #${refId}. A representative will follow up.`;

// ============================================================
// RESULT TYPES
// ============================================================

export type SmsFlowResult =
  | { action: "ask_followup"; message: string; session: SmsSession }
  | { action: "complete"; session: SmsSession; reason: "all_fields" | "followups_exhausted" | "max_messages" }
  | { action: "timeout"; session: SmsSession; hadData: boolean };

export interface SmsSessionDebugInfo {
  phoneLast4: string;
  createdAt: string;
  lastActivityAt: string;
  hasName: boolean;
  hasAddress: boolean;
  hasIssue: boolean;
  askedForName: boolean;
  askedForAddress: boolean;
  messageCount: number;
  ageMs: number;
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
    askedForName: false,
    askedForAddress: false,
    messageHistory: [],
    messageCount: 0,
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
// GUIDED FLOW LOGIC
// ============================================================

/**
 * Process an incoming SMS with session state
 *
 * Flow logic:
 * 1. Get/create session for phone number
 * 2. Extract fields from current message (reuse extractSmsFields)
 * 3. Merge extracted fields into session
 * 4. If all fields present -> COMPLETE
 * 5. If missing field AND not yet asked -> ASK (mark as asked)
 * 6. If missing field AND already asked -> COMPLETE with defaults
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

  // Update session
  session.lastActivityAt = new Date();
  session.messageCount++;
  session.messageHistory.push(messageBody);

  console.log(`[sms-session] PROCESS phone=*${phoneNumber.slice(-4)} msgNum=${session.messageCount}`);

  // Check max messages
  if (session.messageCount > MAX_MESSAGES_PER_SESSION) {
    console.log(`[sms-session] MAX_MESSAGES phone=*${phoneNumber.slice(-4)}`);
    return { action: "complete", session, reason: "max_messages" };
  }

  // Extract fields from current message
  const extraction = await extractSmsFields(messageBody);
  console.log(`[sms-session] EXTRACT name=${extraction.name} address=${extraction.address}`);

  // Merge extracted fields into session
  mergeExtractionIntoSession(session, extraction, messageBody);

  // Check completion state
  const result = determineNextAction(session);

  console.log(`[sms-session] ACTION=${result.action} phone=*${phoneNumber.slice(-4)}`);

  return result;
}

/**
 * Merge extraction results into session state
 * Only updates fields that weren't already set
 */
function mergeExtractionIntoSession(
  session: SmsSession,
  extraction: SmsExtractionResult,
  rawMessage: string
): void {
  // Update name if we got a real one (not default)
  if (extraction.nameSource !== "default" && !session.name) {
    session.name = extraction.name;
    console.log(`[sms-session] UPDATE phone=*${session.phoneNumber.slice(-4)} field=name value=${extraction.name}`);
  }

  // Update address if we got a real one (not default)
  if (extraction.addressSource !== "default" && !session.address) {
    session.address = extraction.address;
    console.log(`[sms-session] UPDATE phone=*${session.phoneNumber.slice(-4)} field=address value=${extraction.address}`);
  }

  // Issue is always the combined message history
  // For classification, we'll use all messages
  session.issue = session.messageHistory.join(" | ");

  // Special case: If this is a follow-up response and we asked for something,
  // accept the raw message as that field (even if extraction didn't find it)
  if (session.messageCount > 1) {
    // If we asked for name and didn't extract one, accept raw message as name
    if (session.askedForName && !session.name && rawMessage.trim().length > 0) {
      // Only accept if it looks like a name response (short, not an address)
      const trimmed = rawMessage.trim();
      if (trimmed.length < 50 && !looksLikeAddress(trimmed)) {
        session.name = trimmed;
        console.log(`[sms-session] UPDATE phone=*${session.phoneNumber.slice(-4)} field=name value=${trimmed} (accepted as-is)`);
      }
    }

    // If we asked for address and didn't extract one, accept raw message as address
    if (session.askedForAddress && !session.address && rawMessage.trim().length > 0) {
      session.address = rawMessage.trim();
      console.log(`[sms-session] UPDATE phone=*${session.phoneNumber.slice(-4)} field=address value=${rawMessage.trim()} (accepted as-is)`);
    }
  }
}

/**
 * Determine the next action based on session state
 */
function determineNextAction(session: SmsSession): SmsFlowResult {
  const hasName = !!session.name;
  const hasAddress = !!session.address;
  const hasIssue = !!session.issue;

  // All fields present -> COMPLETE
  if (hasName && hasAddress && hasIssue) {
    return { action: "complete", session, reason: "all_fields" };
  }

  // Missing name, haven't asked yet -> ASK
  if (!hasName && !session.askedForName) {
    session.askedForName = true;
    return { action: "ask_followup", message: FOLLOW_UP_NAME, session };
  }

  // Missing address, haven't asked yet -> ASK
  if (!hasAddress && !session.askedForAddress) {
    session.askedForAddress = true;
    return { action: "ask_followup", message: FOLLOW_UP_ADDRESS, session };
  }

  // All follow-ups exhausted -> COMPLETE with defaults
  return { action: "complete", session, reason: "followups_exhausted" };
}

/**
 * Simple heuristic to check if text looks like an address
 */
function looksLikeAddress(text: string): boolean {
  const streetTypes = /\b(street|st|avenue|ave|drive|dr|road|rd|boulevard|blvd|lane|ln|way|court|ct|place|pl|circle|cir)\b/i;
  const hasNumber = /^\d+\s+/.test(text);
  return streetTypes.test(text) || hasNumber;
}

// ============================================================
// RECORD CREATION HELPERS
// ============================================================

/**
 * Get finalized session data for record creation
 * Applies defaults for any missing fields
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
      askedForName: session.askedForName,
      askedForAddress: session.askedForAddress,
      messageCount: session.messageCount,
      ageMs: now - session.lastActivityAt.getTime(),
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
    askedForName: session.askedForName,
    askedForAddress: session.askedForAddress,
    messageCount: session.messageCount,
    ageMs: now - session.lastActivityAt.getTime(),
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
