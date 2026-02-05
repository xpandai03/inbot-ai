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
 * Call metadata extracted from Vapi webhook for email notifications
 * This data is NOT persisted to the database - only passed to email function
 */
export interface VapiCallMetadata {
  recordingUrl: string | null;
  stereoRecordingUrl: string | null;
  transcript: string | null;
  analysisSuccess: boolean;
  endedReason: string;
}

/**
 * Extract call metadata from Vapi webhook payload
 * Used to include recording links and transcripts in department emails
 */
export function extractCallMetadata(payload: VapiWebhookPayload): VapiCallMetadata {
  const msg = payload.message;

  // Cast message to unknown first to safely access optional properties
  // Recording URL can be in multiple locations depending on Vapi version
  const msgAny = msg as unknown as Record<string, unknown>;
  const artifact = msg.artifact as Record<string, unknown> | undefined;
  const recording = artifact?.recording as Record<string, unknown> | undefined;
  const monoRecording = recording?.mono as Record<string, unknown> | undefined;

  const recordingUrl =
    (msgAny.recordingUrl as string | undefined) ||
    (monoRecording?.combinedUrl as string | undefined) ||
    null;

  const stereoRecordingUrl =
    (msgAny.stereoRecordingUrl as string | undefined) ||
    (recording?.stereoUrl as string | undefined) ||
    null;

  const metadata: VapiCallMetadata = {
    recordingUrl,
    stereoRecordingUrl,
    transcript: msg.transcript || null,
    analysisSuccess: msg.analysis?.successEvaluation === "true",
    endedReason: msg.endedReason || "unknown",
  };

  console.log("[extractCallMetadata] Recording URL:", metadata.recordingUrl ? "present" : "none");
  console.log("[extractCallMetadata] Stereo URL:", metadata.stereoRecordingUrl ? "present" : "none");
  console.log("[extractCallMetadata] Transcript length:", metadata.transcript?.length || 0);
  console.log("[extractCallMetadata] Analysis success:", metadata.analysisSuccess);
  console.log("[extractCallMetadata] Ended reason:", metadata.endedReason);

  return metadata;
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

// ============================================================
// TRANSCRIPT PRE-PROCESSING (Phase 2 Remediation - Fix 4)
// ============================================================
// Removes speech artifacts that break regex extraction patterns
// Applied to transcript BEFORE extraction, not stored in database
// ============================================================

/**
 * Clean transcript text for better extraction accuracy
 * Removes hesitation markers, filler words, and speech artifacts
 * Supports English and Spanish filler words (Phase 1 Spanish Hardening)
 *
 * Examples:
 *   "uh one two three four Main Street" → "one two three four Main Street"
 *   "I... um... live at 123 Oak" → "I live at 123 Oak"
 *   "my name is... uh... John" → "my name is John"
 *   "eh pues me llamo Carlos" → "me llamo Carlos"
 *   "este... vivo en la calle Oak" → "vivo en la calle Oak"
 */
export function cleanTranscriptForExtraction(text: string): string {
  if (!text) return text;

  let cleaned = text;

  // Remove English filler words at word boundaries (preserve in middle of words)
  // \b ensures we don't match "thumb" when looking for "um"
  cleaned = cleaned.replace(/\b(uh|um|er|ah|eh|hmm|hm|mm)\b/gi, " ");

  // Remove Spanish filler words (Phase 1 Spanish Hardening)
  // Common Spanish hesitation markers and discourse fillers
  // Note: "bueno" at sentence start is a filler, but can be meaningful mid-sentence
  // Using word boundary to preserve when it's part of a phrase
  cleaned = cleaned.replace(/\b(este|pues|bueno|entonces|o sea|a ver|mira|oye|verdad|sabes)\b/gi, " ");

  // Remove ellipses (multiple dots) → single space
  cleaned = cleaned.replace(/\.{2,}/g, " ");

  // Remove stutters: "I-I" → "I", "the-the" → "the"
  cleaned = cleaned.replace(/\b(\w+)-\1\b/gi, "$1");

  // Remove repeated words: "I I live" → "I live", "the the street" → "the street"
  cleaned = cleaned.replace(/\b(\w+)\s+\1\b/gi, "$1");

  // Normalize multiple spaces → single space
  cleaned = cleaned.replace(/\s{2,}/g, " ");

  // Trim leading/trailing whitespace
  cleaned = cleaned.trim();

  // Only log if we actually changed something
  if (cleaned !== text) {
    console.log(`[clean-transcript] Cleaned: "${text.substring(0, 50)}..." → "${cleaned.substring(0, 50)}..."`);
  }

  return cleaned;
}

/**
 * Clean VapiMessage array for extraction
 * Returns new array with cleaned message content
 */
export function cleanMessagesForExtraction(messages: VapiMessage[]): VapiMessage[] {
  return messages.map(msg => ({
    ...msg,
    message: cleanTranscriptForExtraction(msg.message),
  }));
}

// Words to ignore when extracting bare names
const IGNORE_WORDS = new Set([
  // Greetings and fillers
  "hello", "hi", "hey", "yeah", "yes", "no", "okay", "ok", "um", "uh",
  "well", "so", "like", "just", "actually", "basically", "please", "thanks",
  "thank", "you", "the", "a", "an", "is", "are", "was", "were", "be",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "must", "can", "need", "want", "got", "get",
  "there", "here", "this", "that", "it", "i", "my", "me", "we", "our",
  "nothing", "something", "anything", "everything", "none", "all",
  // VERB PHRASES that commonly follow "I'm" (Fix 1: prevents "calling because" as name)
  "calling", "reporting", "looking", "trying", "asking", "wondering",
  "hoping", "needing", "having", "following", "checking", "inquiring",
  "phoning", "contacting", "reaching", "going", "getting", "making",
  "seeing", "letting", "telling", "saying", "speaking", "talking",
  "texting", "emailing", "waiting", "writing",
  // Common non-name words that slip through
  "still", "also", "very", "really", "currently", "probably", "definitely",
  "concerned", "worried", "frustrated", "happy", "glad", "sorry",
  // Common nouns/prepositions that are NOT names
  "about", "soda", "snow", "water", "phone", "help", "issue", "problem",
  "street", "road", "pothole", "light", "tree", "sign", "garbage", "trash",
  "car", "house", "home", "work", "today", "tomorrow", "yesterday",
  "morning", "afternoon", "evening", "night", "week", "month", "year",
]);

/**
 * Check if a word looks like a valid name component
 * Supports English and Spanish accented characters (á é í ó ú ñ Á É Í Ó Ú Ñ)
 */
function isValidNameWord(word: string): boolean {
  if (!word || word.length < 2) return false;
  if (IGNORE_WORDS.has(word.toLowerCase())) return false;
  // Must start with a letter and contain only letters/hyphens/accents
  // Unicode range \u00C0-\u00FF covers Latin-1 Supplement (accented chars)
  return /^[A-Za-z\u00C0-\u00FF][A-Za-z\u00C0-\u00FF'-]*$/.test(word);
}

// ============================================================
// POST-EXTRACTION VALIDATION (Phase 1 Remediation)
// ============================================================
// Safety net that catches garbage values AFTER regex extraction
// Does NOT block record creation - converts bad values to defaults
// ============================================================

// Patterns that indicate a verb phrase, not a name
// Includes English and Spanish verb forms (Phase 1 Spanish Hardening)
const VERB_PHRASE_PATTERNS = [
  // English verb phrases
  /^calling\b/i,
  /^reporting\b/i,
  /^looking\b/i,
  /^trying\b/i,
  /^asking\b/i,
  /^wondering\b/i,
  /^hoping\b/i,
  /^checking\b/i,
  /^inquiring\b/i,
  /^following\b/i,
  /^reaching\b/i,
  /^contacting\b/i,
  /^phoning\b/i,
  /^going\b/i,
  /^getting\b/i,
  /^making\b/i,
  /^having\b/i,
  /^needing\b/i,
  // Spanish verb phrases (gerund forms "-ando"/"-iendo" = English "-ing")
  /^llamando\b/i,     // calling
  /^reportando\b/i,   // reporting
  /^buscando\b/i,     // looking for
  /^tratando\b/i,     // trying
  /^preguntando\b/i,  // asking
  /^esperando\b/i,    // hoping/waiting
  /^revisando\b/i,    // checking
  /^contactando\b/i,  // contacting
  /^teniendo\b/i,     // having
  /^necesitando\b/i,  // needing
  /^queriendo\b/i,    // wanting
  /^pidiendo\b/i,     // requesting
  /^hablando\b/i,     // speaking/talking
];

// Common phrase patterns that are definitely not names
// Includes English and Spanish phrases (Phase 1 Spanish Hardening)
const NON_NAME_PHRASE_PATTERNS = [
  // English phrases
  /^calling\s+(about|because|on|to|for|regarding|in|from)/i,
  /^calling\s+on\s+reference/i,
  /^calling\s+on\s+behalf/i,
  /^calling\s+to\s+(report|ask|check|follow|inquire)/i,
  /^the\s+(pothole|issue|problem|street|road|light)/i,
  /^my\s+(street|road|address|house|property)/i,
  /^this\s+(is|issue|problem)/i,
  /^just\s+(calling|wanted|checking)/i,
  /^still\s+(having|waiting|here)/i,
  // Additional phrases that slip through as names
  /^texting\s+(about|you|to|for)/i,
  /^texting$/i,
  /^to\s+(help|report|ask|call|check)/i,
  /^about\s+(a|the|my|this|that)/i,
  /^about$/i,
  /^soda$/i,
  /^help$/i,
  /^here\s+(to|about|for)/i,
  /^\w+ing\s+about\s+\w+/i,  // Catches "texting about snow", "calling about issue", etc.
  // Spanish non-name phrases (Phase 1 Spanish Hardening)
  /^llamando\s+(para|por|sobre|porque)/i,  // calling about/for/because
  /^es\s+(un|una|el|la|mi)/i,              // it's a/the/my
  /^el\s+(bache|problema|asunto|poste)/i,  // the pothole/problem/issue/post
  /^la\s+(calle|luz|basura|factura)/i,     // the street/light/trash/bill
  /^mi\s+(calle|casa|problema|dirección)/i, // my street/house/problem/address
  /^un\s+(bache|problema|asunto)/i,        // a pothole/problem/issue
  /^una\s+(luz|calle)/i,                   // a light/street
  /^solo\s+(llamando|quería|preguntando)/i, // just calling/wanted/asking
  /^aquí\s+(para|por)/i,                   // here for
  /^tengo\s+(un|una|problema)/i,           // I have a/problem
  /^hay\s+(un|una)/i,                      // there is a
  /^\w+ando\s+(sobre|por|para)\s+\w+/i,    // Spanish gerund patterns "-ando sobre/por/para"
  /^\w+iendo\s+(sobre|por|para)\s+\w+/i,   // Spanish gerund patterns "-iendo sobre/por/para"
];

/**
 * Validate extracted name - catches garbage that regex missed
 * Returns null if name is invalid (caller should use default)
 *
 * Validation rules (Phase 1 Hardening):
 * - Reject verb phrases (calling, reporting, looking, etc.)
 * - Reject common non-name phrases
 * - Reject names < 2 chars or > 50 chars
 * - Reject numeric-only values
 * - Reject single common words
 * - CRITICAL: Reject organization/entity/brand names
 * - CRITICAL: Reject system/AI/department names
 */
export function validateExtractedName(name: string): string | null {
  if (!name || name.trim().length === 0) return null;

  const trimmed = name.trim();
  const words = trimmed.toLowerCase().split(/\s+/);

  // ============================================================
  // ORGANIZATION / ENTITY REJECTION LAYER (CRITICAL - Phase 1 Hardening)
  // ============================================================
  // These keywords indicate the candidate is an organization, department,
  // system name, or brand - NOT a human name. Must reject immediately.
  // ============================================================
  
  const ORGANIZATION_KEYWORDS = new Set([
    // Civic / government terms
    "city", "county", "state", "federal", "municipal", "government", "gov",
    "department", "dept", "division", "bureau", "agency", "office",
    "public", "works", "utilities", "utility", "safety", "services", "service",
    "authority", "district", "commission", "board", "council", "committee",
    "administration", "admin", "management", "operations",
    // Infrastructure / municipal services
    "water", "sewer", "sanitation", "waste", "recycling", "parks", "recreation",
    "transportation", "transit", "traffic", "roads", "streets", "highways",
    "police", "fire", "emergency", "ems", "ambulance", "rescue",
    "planning", "zoning", "building", "permits", "inspection", "code",
    "housing", "development", "economic", "community",
    // System / AI / technology terms
    "ai", "bot", "assistant", "system", "systems", "platform", "software",
    "intake", "automated", "automation", "digital", "virtual", "voice",
    "inbot", "vapi", "twilio", "openai", "chatgpt", "alexa", "siri",
    // Corporate / business terms
    "inc", "llc", "corp", "corporation", "company", "co", "ltd", "limited",
    "enterprise", "enterprises", "group", "holdings", "partners", "associates",
    "solutions", "consulting", "industries", "international", "global",
    // Brand names commonly misheard/captured (add as discovered)
    "coca", "cola", "pepsi", "amazon", "google", "microsoft", "apple",
    "facebook", "meta", "twitter", "uber", "lyft", "doordash", "grubhub",
    // Location/place indicators (not person names)
    "union", "center", "centre", "plaza", "square", "tower", "building",
    "station", "terminal", "airport", "hospital", "clinic", "school",
    "university", "college", "institute", "foundation", "museum",
  ]);

  // Check if ANY word in the candidate is an organization keyword
  // This catches "Union City AI", "Public Works", "Coca Cola", etc.
  for (const word of words) {
    if (ORGANIZATION_KEYWORDS.has(word)) {
      console.log(`[validate-name] REJECTED (organization keyword "${word}"): "${trimmed}"`);
      return null;
    }
  }

  // Additional organization pattern checks (multi-word patterns)
  const ORGANIZATION_PATTERNS = [
    /city\s+of\s+/i,           // "City of X"
    /county\s+of\s+/i,         // "County of X"
    /department\s+of\s+/i,     // "Department of X"
    /\w+\s+department$/i,      // "X Department"
    /\w+\s+services?$/i,       // "X Services" or "X Service"
    /\w+\s+authority$/i,       // "X Authority"
    /\w+\s+district$/i,        // "X District"
    /\w+\s+commission$/i,      // "X Commission"
    /\w+\s+inc\.?$/i,          // "X Inc" or "X Inc."
    /\w+\s+llc\.?$/i,          // "X LLC"
    /\w+\s+corp\.?$/i,         // "X Corp"
    /\w+\s+ai$/i,              // "X AI" - catches "Union City AI", "Inbot AI"
    /\w+\s+bot$/i,             // "X Bot"
    /\w+\s+assistant$/i,       // "X Assistant"
    /\w+\s+system$/i,          // "X System"
  ];

  for (const pattern of ORGANIZATION_PATTERNS) {
    if (pattern.test(trimmed)) {
      console.log(`[validate-name] REJECTED (organization pattern): "${trimmed}"`);
      return null;
    }
  }

  // ============================================================
  // END ORGANIZATION REJECTION LAYER
  // ============================================================

  // Length check
  if (trimmed.length < 2 || trimmed.length > 50) {
    console.log(`[validate-name] REJECTED (length): "${trimmed}"`);
    return null;
  }

  // Numeric-only check
  if (/^\d+$/.test(trimmed)) {
    console.log(`[validate-name] REJECTED (numeric): "${trimmed}"`);
    return null;
  }

  // Verb phrase check (starts with verb)
  for (const pattern of VERB_PHRASE_PATTERNS) {
    if (pattern.test(trimmed)) {
      console.log(`[validate-name] REJECTED (verb phrase): "${trimmed}"`);
      return null;
    }
  }

  // Non-name phrase check
  for (const pattern of NON_NAME_PHRASE_PATTERNS) {
    if (pattern.test(trimmed)) {
      console.log(`[validate-name] REJECTED (non-name phrase): "${trimmed}"`);
      return null;
    }
  }

  // Single-word blocklist check (for words that slipped through IGNORE_WORDS)
  if (words.length === 1 && IGNORE_WORDS.has(words[0])) {
    console.log(`[validate-name] REJECTED (single ignored word): "${trimmed}"`);
    return null;
  }

  // ============================================================
  // VALID NAME ALLOWLISTS AND BLOCKLISTS
  // ============================================================
  
  // Valid Spanish names that might look like common English words
  // These should NOT be rejected even though they appear in word lists
  const VALID_SPANISH_NAMES = new Set([
    "luz",      // Light (common female name)
    "rosa",     // Rose (common female name)
    "cruz",     // Cross (common surname, also male name)
    "mar",      // Sea (female name)
    "sol",      // Sun (female name)
    "cielo",    // Sky (female name)
    "paz",      // Peace (female name)
    "angel",    // Angel (male name, also "ángel")
    "jesus",    // Jesus (male name, also "jesús")
    "dolores",  // Pains/Sorrows (female name)
    "pilar",    // Pillar (female name)
    "rocio",    // Dew (female name, also "rocío")
    "mercedes", // Mercies (female name) - NOTE: also a car brand, but common name
    "consuelo", // Consolation (female name)
    "esperanza",// Hope (female name)
    "guadalupe",// Place name (female name)
    "trinidad", // Trinity (female name)
    "santos",   // Saints (male name)
    "reyes",    // Kings (surname)
    "flores",   // Flowers (surname)
    "snow",     // Can be a valid surname (Johnny Snow)
  ]);

  // Common non-name words that should be rejected (expanded)
  const COMMON_NON_NAME_WORDS = new Set([
    // Common nouns
    "soda", "phone", "help", "issue", "problem", "street",
    "road", "pothole", "light", "tree", "sign", "garbage", "trash", "car",
    "house", "home", "work", "today", "tomorrow", "morning", "afternoon",
    "evening", "night", "week", "month", "year", "time", "day", "place",
    "thing", "stuff", "matter", "question", "answer", "note", "message",
    // Prepositions/conjunctions/adverbs
    "about", "from", "with", "into", "onto", "over", "under", "before",
    "after", "during", "through", "between", "among", "against", "within",
    "because", "however", "therefore", "although", "unless", "until",
    // Common verbs (base form)
    "help", "call", "text", "send", "fix", "check", "look", "find", "tell",
    // Food/drink items (often misheard)
    "soda", "coffee", "tea", "food", "pizza", "burger", "coke",
    // Weather words
    "rain", "wind", "cold", "hot", "warm", "sunny",
    // Question words
    "what", "where", "when", "why", "how", "who", "which",
    // Additional words that slip through
    "super", "fuller", "vienna", // Common false positives from transcription
  ]);

  // Number words that indicate address fragment (not names)
  const NUMBER_STARTERS = new Set([
    "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen",
    "eighteen", "nineteen", "twenty", "thirty", "forty", "fifty",
    "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez",
  ]);

  // ============================================================
  // SINGLE WORD VALIDATION
  // ============================================================

  // Phase 1 Hardening: Reject single lowercase words (almost never valid names)
  // Exception: Valid Spanish names that may appear lowercase in transcription
  if (words.length === 1 && trimmed === trimmed.toLowerCase()) {
    if (VALID_SPANISH_NAMES.has(words[0])) {
      console.log(`[validate-name] ACCEPTED (valid Spanish name): "${trimmed}"`);
      return trimmed;
    }
    console.log(`[validate-name] REJECTED (single lowercase word): "${trimmed}"`);
    return null;
  }

  // Phase 1 Hardening: Reject if starts with number word (likely address fragment)
  if (words.length > 1 && NUMBER_STARTERS.has(words[0])) {
    console.log(`[validate-name] REJECTED (starts with number word): "${trimmed}"`);
    return null;
  }

  // Check if it's a valid Spanish name (capitalized version)
  if (words.length === 1 && VALID_SPANISH_NAMES.has(words[0])) {
    console.log(`[validate-name] ACCEPTED (valid Spanish name): "${trimmed}"`);
    return trimmed;
  }

  if (words.length === 1 && COMMON_NON_NAME_WORDS.has(words[0])) {
    console.log(`[validate-name] REJECTED (common non-name word): "${trimmed}"`);
    return null;
  }

  // ============================================================
  // MULTI-WORD VALIDATION
  // ============================================================

  // Multi-word check: reject if ALL words are common non-name words
  if (words.length > 1) {
    const allCommon = words.every(w => 
      IGNORE_WORDS.has(w) || COMMON_NON_NAME_WORDS.has(w)
    );
    if (allCommon) {
      console.log(`[validate-name] REJECTED (all words are common): "${trimmed}"`);
      return null;
    }
  }

  // ============================================================
  // FINAL HUMAN NAME STRUCTURE CHECK (Phase 1 Final Hardening)
  // ============================================================
  // A name must satisfy AT LEAST 2 of the following criteria:
  // 1. Contains 2+ tokens
  // 2. Contains capitalized tokens (proper noun pattern)
  // 3. Matches human name pattern (First Last)
  // 4. Does NOT match intent/filler words
  // ============================================================
  
  // Reject if all words are single capital letter (initials only, too short)
  if (words.length > 1 && words.every(w => w.length === 1)) {
    console.log(`[validate-name] REJECTED (initials only): "${trimmed}"`);
    return null;
  }

  // Calculate human-name criteria score
  let humanNameScore = 0;
  
  // Criterion 1: Has 2-3 tokens (typical human name pattern)
  if (words.length >= 2 && words.length <= 3) {
    humanNameScore++;
  }
  
  // Criterion 2: Has capitalized tokens (proper case pattern)
  const hasCapitalized = trimmed.split(/\s+/).some(w => 
    /^[A-Z\u00C0-\u00D6\u00D8-\u00DE][a-z\u00DF-\u00F6\u00F8-\u00FF]+$/.test(w)
  );
  if (hasCapitalized) {
    humanNameScore++;
  }
  
  // Criterion 3: Matches First Last pattern (two capitalized words)
  const firstLastPattern = /^[A-Z\u00C0-\u00D6][a-z\u00DF-\u00FF]+\s+[A-Z\u00C0-\u00D6][a-z\u00DF-\u00FF]+$/;
  if (firstLastPattern.test(trimmed)) {
    humanNameScore += 2; // Strong signal - count as 2 criteria
  }
  
  // Criterion 4: Does NOT contain intent/filler/action words
  const INTENT_FILLER_WORDS = new Set([
    // Action verbs that start phrases
    "calling", "texting", "reporting", "asking", "checking", "looking",
    "trying", "hoping", "needing", "wanting", "getting", "going",
    // Intent words
    "pothole", "road", "street", "light", "water", "trash", "garbage",
    "bill", "payment", "issue", "problem", "damage", "broken", "repair",
    // Filler/connector words
    "about", "because", "help", "just", "still", "also", "here", "there",
    // Spanish equivalents
    "llamando", "reportando", "buscando", "tratando", "preguntando",
    "bache", "calle", "luz", "agua", "basura", "factura",
  ]);
  
  const hasIntentFillerWord = words.some(w => INTENT_FILLER_WORDS.has(w));
  if (!hasIntentFillerWord) {
    humanNameScore++;
  }
  
  // FINAL GATE: Must satisfy at least 2 criteria to be considered a human name
  if (humanNameScore < 2) {
    console.log(`[validate-name] REJECTED (failed human-name criteria, score=${humanNameScore}): "${trimmed}"`);
    return null;
  }

  // All checks passed
  console.log(`[validate-name] ACCEPTED (human-name score=${humanNameScore}): "${trimmed}"`);
  return trimmed;
}

// Patterns that indicate non-address values
// Phase 2 Hardening: Added question/prompt phrases from AI agent
const NON_ADDRESS_PATTERNS = [
  // Vague location references
  /^not\s*sure/i,
  /^don'?t\s*know/i,
  /^somewhere/i,
  /^around\s*here/i,
  /^near\s*(the|my)/i,
  /^by\s*the/i,
  /^behind\s*(the|a)/i,
  /^in\s*front\s*of/i,
  /^across\s*from/i,
  /^next\s*to/i,
  
  // ============================================================
  // AI AGENT QUESTION PHRASES (must not be captured as addresses)
  // ============================================================
  // These are questions the AI asks, not caller-provided addresses
  // Example: "And what is the street" should NOT become an address
  
  // Question phrases that end in street type
  /^(?:and\s+)?what\s+is\s+(?:the|your)/i,           // "what is the street", "and what is the street"
  /^(?:and\s+)?where\s+is\s+(?:the|your|this)/i,     // "where is the street"
  /^(?:and\s+)?which\s+(?:street|road|avenue)/i,     // "which street"
  /^(?:and\s+)?can\s+you\s+(?:tell|give)/i,          // "can you tell me the street"
  /^(?:and\s+)?could\s+you\s+(?:tell|give)/i,        // "could you tell me"
  /^(?:and\s+)?do\s+you\s+know/i,                    // "do you know the street"
  /^(?:and\s+)?is\s+(?:it|this|that)\s+(?:on|at)/i,  // "is it on Main Street"
  /^(?:and\s+)?what'?s\s+(?:the|your)/i,             // "what's the street"
  
  // Spanish question phrases
  /^(?:y\s+)?(?:cu[aá]l|qu[eé])\s+(?:es|calle)/i,    // "cuál es la calle", "qué calle"
  /^(?:y\s+)?d[oó]nde\s+(?:es|está|queda)/i,         // "dónde es", "dónde está"
  /^(?:y\s+)?puede\s+(?:decirme|darme)/i,            // "puede decirme la dirección"
  
  // Generic question starters that shouldn't be addresses
  /^(?:and\s+)?(?:what|where|which|how|when|why)\s+/i,
  
  // ============================================================
  // ISSUE DESCRIPTIONS (must not be captured as addresses)
  // ============================================================
  // These are caller issue descriptions, not street addresses
  // Phase 2 Hardening: Reject issue/problem descriptions
  
  // Infrastructure issues
  /cable\s*(hanging|down|fallen|broken)/i,           // "cable hanging from..."
  /light\s*(pole|post)\s*(is|has|down|broken|fallen)/i, // "light pole is down"
  /hanging\s*(from|on|off)/i,                        // "hanging from the..."
  /\b(broken|fallen|down|damaged|leaking|flooded)\s+(cable|wire|light|pole|pipe|hydrant)/i,
  
  // Issue descriptors that aren't addresses
  /^(?:there'?s?\s+)?(?:a\s+)?(?:cable|wire|light|pole|tree|branch)/i,  // "there's a cable..."
  /^(?:s\s+)?a\s+(?:cable|wire|light|tree|branch|pole)/i,               // "s a cable" (truncated "there's a cable")
  /^(?:it'?s?\s+)?(?:a\s+)?(?:cable|wire|light|pole)/i,                // "it's a cable"
  
  // Problem/issue language - only reject when these START the address (not in middle)
  // This prevents rejecting valid addresses like "123 Broken Arrow Dr" while catching "broken pipe on Main St"
  /^(?:pothole|crack|damage|broken|leak|flood|fire|smoke|fallen|snow|ice)/i,
  /^(?:a|the)\s+(?:pothole|crack|damage|broken|leak|flood|fire|snow|ice)/i,
  
  // Starts with articles/pronouns without numbers (not addresses)
  /^(?:a|the|this|that|there|it)\s+(?![\d])/i,       // "a cable", "the light" (but not "a 123 Main St")
  
  // Spanish issue phrases
  /cable\s*(colgando|caído|roto)/i,                  // "cable colgando"
  /poste\s*(de\s*)?luz\s*(caído|roto|dañado)/i,     // "poste de luz caído"
];

/**
 * Validate extracted address - catches garbage that regex missed
 * Returns null if address is invalid (caller should use default)
 *
 * Validation rules:
 * - Clean up transcription artifacts (dashes, filler words)
 * - Reject vague location descriptions
 * - Reject addresses < 5 chars
 * - Reject values that are clearly not street addresses
 * - Reject addresses that are just "number + Street" with nothing in between
 */
export function validateExtractedAddress(address: string): string | null {
  if (!address || address.trim().length === 0) return null;

  let cleaned = address.trim();

  // ============================================================
  // PHASE 2 HARDENING: Clean up transcription artifacts
  // ============================================================
  // Remove common transcription noise that appears in addresses:
  // - Double dashes: "40 -- Street" → "40 Street"
  // - Filler words: "40 um Street" → "40 Street"
  // - Multiple spaces: "40   Street" → "40 Street"
  // ============================================================
  
  // Remove double/triple dashes (common transcription artifact)
  cleaned = cleaned.replace(/\s*-{2,}\s*/g, " ");
  
  // Remove common filler words/sounds
  cleaned = cleaned.replace(/\b(um|uh|er|ah|like|you know)\b/gi, " ");
  
  // Normalize multiple spaces to single space
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  
  console.log(`[validate-address] Input: "${address}" → Cleaned: "${cleaned}"`);

  // Length check (minimum reasonable address: "1 A St" = 6 chars)
  if (cleaned.length < 5) {
    console.log(`[validate-address] REJECTED (too short): "${cleaned}"`);
    return null;
  }

  // Non-address pattern check
  for (const pattern of NON_ADDRESS_PATTERNS) {
    if (pattern.test(cleaned)) {
      console.log(`[validate-address] REJECTED (non-address): "${cleaned}"`);
      return null;
    }
  }

  // ============================================================
  // PHASE 2 HARDENING: Reject incomplete addresses
  // ============================================================
  // Reject addresses that are just "number Street" with no street NAME
  // e.g., "40 Street" is not a valid address (missing street name)
  // Valid: "40 Main Street", "40 Oak Street"
  // Invalid: "40 Street", "123 Avenue"
  // ============================================================
  
  const words = cleaned.split(/\s+/);
  if (words.length === 2) {
    const [first, second] = words;
    // Check if second word is ONLY a street type (no name)
    const streetTypeOnly = new RegExp(`^(${STREET_TYPES})$`, "i");
    if (/^\d+$/.test(first) && streetTypeOnly.test(second)) {
      console.log(`[validate-address] REJECTED (number + street type only, no street name): "${cleaned}"`);
      return null;
    }
  }

  // ============================================================
  // PHASE 2 HARDENING: Address structure validation
  // ============================================================
  // Valid addresses typically:
  // - Start with a number (most common: "123 Main Street")
  // - Start with a spoken number word ("forty Main Street")
  // - Start with a street type in Spanish ("Calle Main 123")
  // - Are cross-street references ("Main & Oak", "corner of...")
  // - Are contextual with "(Approximate)" suffix (from our extraction)
  // 
  // Invalid addresses (issue descriptions):
  // - Start with articles: "a cable", "the light"
  // - Start with verbs: "hanging", "broken"
  // - Describe issues not locations
  // ============================================================
  
  const firstWord = words[0]?.toLowerCase();
  
  // Check if starts with a valid address indicator
  const VALID_ADDRESS_STARTERS = [
    // Numeric
    /^\d/,                                              // Starts with digit
    // Spoken numbers (English)
    /^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)/i,
    // Spoken numbers (Spanish)
    /^(uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|veinte|treinta|cuarenta|cincuenta)/i,
    // Spanish street prefixes
    /^(calle|avenida|av|pasaje|camino|carretera|plaza|paseo|bulevar)/i,
    // Cross-street indicators
    /^(corner|intersection|esquina|cruce)/i,
    // Contextual (from our extraction)
    /\(approximate\)$/i,
  ];
  
  // ============================================================
  // PHASE 2 HARDENING: Also allow addresses that END with street types
  // ============================================================
  // Callers might just say "Oak Street" without a number
  // This is valid - it's a partial address that's still useful
  // Examples: "Main Street", "Oak Avenue", "Fifth Avenue"
  // ============================================================
  const STREET_TYPES_PATTERN = new RegExp(`(${STREET_TYPES})$`, "i");
  const endsWithStreetType = STREET_TYPES_PATTERN.test(cleaned);
  
  // Check if the address starts with any valid pattern OR ends with a street type
  const hasValidStart = VALID_ADDRESS_STARTERS.some(pattern => {
    if (pattern.source.endsWith('$')) {
      // Pattern checks entire string (like approximate)
      return pattern.test(cleaned);
    }
    return pattern.test(firstWord) || pattern.test(cleaned);
  });
  
  if (!hasValidStart && !endsWithStreetType) {
    console.log(`[validate-address] REJECTED (doesn't start with number/valid prefix AND doesn't end with street type): "${cleaned}"`);
    return null;
  }
  
  if (!hasValidStart && endsWithStreetType) {
    console.log(`[validate-address] ACCEPTED (no number but ends with street type): "${cleaned}"`);
  }

  // All checks passed
  console.log(`[validate-address] ACCEPTED: "${cleaned}"`);
  return cleaned;
}

// Character class for name matching (English + Spanish accented characters)
// Covers: A-Z, a-z, and Latin-1 Supplement accented chars (á é í ó ú ñ Á É Í Ó Ú Ñ etc.)
const NAME_CHAR_CLASS = "[A-Za-z\\u00C0-\\u00FF]";
const NAME_WORD_PATTERN = `${NAME_CHAR_CLASS}${NAME_CHAR_CLASS}*(?:'|-)?${NAME_CHAR_CLASS}*`;

// ============================================================
// MULTI-CANDIDATE NAME EXTRACTION WITH SCORING (Phase 1 Hardening)
// ============================================================
// Instead of "first valid match wins", we now:
// 1. Collect ALL candidates from the full transcript
// 2. Score each candidate based on confidence signals
// 3. Select the highest-scoring candidate that passes validation
// ============================================================

interface NameCandidate {
  value: string;
  pattern: string;
  score: number;
  messageIndex: number;
  rawMatch: string; // Original matched text before cleanup
}

// Base scores for different pattern types (higher = more confident)
// Phase 1 Final Hardening: DRAMATICALLY increased separation
// Explicit triggers should MASSIVELY outweigh weak patterns
// Phase 2 Hardening: Added casual introduction patterns for natural speech
const PATTERN_BASE_SCORES: Record<string, number> = {
  // Explicit name triggers (VERY HIGH confidence - should always win)
  "my name is": 500,   // Increased from 100 - definitive name statement
  "mi nombre es": 500, // Spanish equivalent - same confidence
  "me llamo": 480,     // Increased from 95 - strong Spanish name trigger
  "name is": 450,      // Increased from 90
  // Casual introductions (HIGH confidence - common in real calls)
  // Phase 2 Hardening: Added for "Hi, Jose Martinez calling to report..."
  "casual intro": 380,     // "Hi, Jose Martinez calling" - high confidence
  "greeting intro": 360,   // "Hi, Jose Martinez, I'm calling" - high confidence
  "name first": 340,       // "Jose Martinez calling" at sentence start - medium-high
  "yes intro": 320,        // "Yes, Jose Martinez here" - medium-high
  "speaking intro": 300,   // "Speaking, this is Jose Martinez" - medium-high
  // Self-identification (high confidence)
  "this is": 300,      // Increased from 80 - clear self-identification
  "habla": 280,        // Spanish "speaking is..."
  "soy": 250,          // Increased from 70 - Spanish "I am"
  // Response to name question (MEDIUM confidence - needs validation)
  // Phase 2 Hardening: When AI asks "what's your name?" and caller responds
  "name only response": 200,  // Just "Juliano Estrano" - medium, needs First Last pattern
  "short response": 180,      // "It's Juliano Estrano" / "Just Juliano Estrano"
  "name then continue": 250,  // "Juliano Estrano, I'm calling about..." - higher confidence
  "name with pause": 220,     // "Juliano Estrano. I need to report..."
  "i am name": 350,           // "I'm Juliano Estrano" with capitalized First Last
  // Weaker triggers (LOW confidence - should rarely win)
  "it's": 50,          // Kept low - often captures garbage
  "yeah it's": 50,     // Kept low
  "i'm": 20,           // DECREASED from 40 - too often followed by verbs
  // Bare name patterns (VERY LOW confidence - last resort)
  "bare name": 10,     // Decreased from 30
  "bare name label": 15, // Decreased from 35
  // Capitalized pair fallback (LOW confidence but better than Unknown)
  "capitalized pair": 100,  // Any "First Last" pattern - needs validation
};

/**
 * Extract ALL name candidates from text (does not select - just collects)
 * Returns array of candidates with scores for later selection
 */
function extractAllNameCandidates(text: string, messageIndex: number): NameCandidate[] {
  if (!text) return [];

  const candidates: NameCandidate[] = [];

  // Pattern 1: Explicit name phrases (highest confidence)
  const explicitPatterns = [
    // English patterns - ordered by confidence
    { regex: new RegExp(`(?:my name is|name is)\\s+(${NAME_WORD_PATTERN}(?:\\s+${NAME_WORD_PATTERN}){0,2})`, "gi"), pattern: "my name is" },
    { regex: new RegExp(`(?:this is)\\s+(${NAME_WORD_PATTERN}(?:\\s+${NAME_WORD_PATTERN}){0,2})`, "gi"), pattern: "this is" },
    { regex: new RegExp(`(?:it's|it is)\\s+(${NAME_WORD_PATTERN}(?:\\s+${NAME_WORD_PATTERN}){0,2})`, "gi"), pattern: "it's" },
    { regex: new RegExp(`(?:i'm|i am)\\s+(${NAME_WORD_PATTERN}(?:\\s+${NAME_WORD_PATTERN}){0,2})`, "gi"), pattern: "i'm" },
    // Spanish patterns
    { regex: new RegExp(`(?:me llamo)\\s+(${NAME_WORD_PATTERN}(?:\\s+${NAME_WORD_PATTERN}){0,2})`, "gi"), pattern: "me llamo" },
    { regex: new RegExp(`(?:mi nombre es)\\s+(${NAME_WORD_PATTERN}(?:\\s+${NAME_WORD_PATTERN}){0,2})`, "gi"), pattern: "mi nombre es" },
    { regex: new RegExp(`(?:soy)\\s+(${NAME_WORD_PATTERN}(?:\\s+${NAME_WORD_PATTERN}){0,2})`, "gi"), pattern: "soy" },
    { regex: new RegExp(`(?:le\\s+)?habla\\s+(${NAME_WORD_PATTERN}(?:\\s+${NAME_WORD_PATTERN}){0,2})`, "gi"), pattern: "habla" },
    
    // ============================================================
    // Phase 2 Hardening: CASUAL INTRODUCTION PATTERNS
    // ============================================================
    // These capture natural phone call intros like:
    // "Hi, Jose Martinez calling to report..."
    // "Yes, Maria Garcia here"
    // "Jose Martinez, I'm calling about..."
    // ============================================================
    
    // "Hi/Hello/Hey, [Name] calling/here/speaking" - very common in real calls
    { regex: new RegExp(`(?:hi|hello|hey),?\\s+(${NAME_WORD_PATTERN}(?:\\s+${NAME_WORD_PATTERN}){1,2})\\s+(?:calling|here|speaking)`, "gi"), pattern: "casual intro" },
    
    // "Hi/Hello, [Name], I'm calling..." - greeting then name then action
    { regex: new RegExp(`(?:hi|hello|hey),?\\s+(${NAME_WORD_PATTERN}(?:\\s+${NAME_WORD_PATTERN}){1,2}),?\\s+(?:i'm|i am)\\s+calling`, "gi"), pattern: "greeting intro" },
    
    // "[Name] calling/here/speaking" at start of message (no greeting)
    { regex: new RegExp(`^(${NAME_WORD_PATTERN}(?:\\s+${NAME_WORD_PATTERN}){1,2})\\s+(?:calling|here|speaking)`, "gi"), pattern: "name first" },
    
    // "Yes/Yeah, [Name] here/calling" - confirming identity
    { regex: new RegExp(`(?:yes|yeah|yep),?\\s+(${NAME_WORD_PATTERN}(?:\\s+${NAME_WORD_PATTERN}){1,2})\\s+(?:here|calling|speaking)`, "gi"), pattern: "yes intro" },
    
    // "Speaking, this is [Name]" / "Yes, this is [Name]"
    { regex: new RegExp(`(?:speaking|yes|yeah),?\\s+(?:this is|it's)\\s+(${NAME_WORD_PATTERN}(?:\\s+${NAME_WORD_PATTERN}){0,2})`, "gi"), pattern: "speaking intro" },
    
    // Spanish casual: "Hola, [Name] llamando" / "Sí, [Name] aquí"
    { regex: new RegExp(`(?:hola|bueno),?\\s+(${NAME_WORD_PATTERN}(?:\\s+${NAME_WORD_PATTERN}){1,2})\\s+(?:llamando|aqu[ií])`, "gi"), pattern: "casual intro" },
    { regex: new RegExp(`(?:s[ií]),?\\s+(${NAME_WORD_PATTERN}(?:\\s+${NAME_WORD_PATTERN}){1,2})\\s+(?:aqu[ií]|llamando|hablando)`, "gi"), pattern: "yes intro" },
    
    // ============================================================
    // Phase 2 Hardening: RESPONSE TO NAME QUESTION
    // ============================================================
    // When AI asks "What's your name?" and caller responds with their name
    // These patterns look for name patterns in various contexts
    // ============================================================
    
    // Name stated alone (short message = likely just the name)
    // Allow whitespace/punctuation at start/end
    { regex: new RegExp(`^\\s*(${NAME_WORD_PATTERN}\\s+${NAME_WORD_PATTERN}(?:\\s+${NAME_WORD_PATTERN})?)\\s*[.,!?]?\\s*$`, "gi"), pattern: "name only response" },
    
    // "It's [Name]" / "Just [Name]" / "Only [Name]" - short responses
    { regex: new RegExp(`(?:it'?s|just|only|that'?s)\\s+(${NAME_WORD_PATTERN}(?:\\s+${NAME_WORD_PATTERN}){1,2})`, "gi"), pattern: "short response" },
    
    // "[Name], and..." / "[Name], I'm calling about..." - name followed by continuation
    { regex: new RegExp(`^\\s*(${NAME_WORD_PATTERN}\\s+${NAME_WORD_PATTERN}),?\\s+(?:and|i'm|i am|calling|here|speaking|i\\s+need|i\\s+want)`, "gi"), pattern: "name then continue" },
    
    // "[Name]." or "[Name]," at start (name stated then pause/continuation)
    { regex: new RegExp(`^\\s*(${NAME_WORD_PATTERN}\\s+${NAME_WORD_PATTERN})[.,]\\s+`, "gi"), pattern: "name with pause" },
    
    // "I am [Name]" / "I'm [Name]" when followed by proper name (not verb)
    // Different from earlier "i'm" pattern - this specifically looks for capitalized First Last
    { regex: new RegExp(`(?:i'?m|i\\s+am)\\s+([A-Z][a-z]+\\s+[A-Z][a-z]+)`, "g"), pattern: "i am name" },
  ];

  for (const { regex, pattern } of explicitPatterns) {
    // Use matchAll to find ALL occurrences, not just first
    // Convert to array for TypeScript compatibility
    const matches = Array.from(text.matchAll(regex));
    for (const match of matches) {
      if (match[1]) {
        const rawMatch = match[1];
        const cleaned = rawMatch.replace(/[.,!?]$/, "").trim();
        const words = cleaned.split(/\s+/).filter(isValidNameWord);
        
        if (words.length >= 1 && words.length <= 3) {
          const value = words.join(" ");
          let score = PATTERN_BASE_SCORES[pattern] || 50;
          
          // Score adjustments based on quality signals
          score += calculateNameScoreAdjustments(value, cleaned, text, match.index || 0);
          
          candidates.push({
            value,
            pattern,
            score,
            messageIndex,
            rawMatch: cleaned,
          });
        }
      }
    }
  }

  // Pattern 2: Bare name patterns (lower confidence)
  const UPPER_CHAR = "[A-Z\\u00C0-\\u00D6\\u00D8-\\u00DE]";
  const LOWER_CHAR = "[a-z\\u00DF-\\u00F6\\u00F8-\\u00FF]";
  const bareNamePatterns = [
    { regex: new RegExp(`(?:Customer|Caller|User|Speaker|Cliente|Usuario):\\s*(${UPPER_CHAR}${LOWER_CHAR}+(?:\\s+${UPPER_CHAR}${LOWER_CHAR}+){0,2})[.,]`, "g"), pattern: "bare name label" },
    { regex: new RegExp(`(?:^|\\n|  )(${UPPER_CHAR}${LOWER_CHAR}+(?:\\s+${UPPER_CHAR}${LOWER_CHAR}+){0,2})[.,]`, "g"), pattern: "bare name" },
    
    // ============================================================
    // Phase 2 Hardening: CAPITALIZED FIRST LAST PATTERN
    // ============================================================
    // Fallback pattern that looks for any two capitalized words in sequence
    // This catches names like "Juliano Estrano" stated without any trigger
    // Lower confidence but better than "Unknown Caller"
    // ============================================================
    { regex: new RegExp(`\\b(${UPPER_CHAR}${LOWER_CHAR}{2,}\\s+${UPPER_CHAR}${LOWER_CHAR}{2,})\\b`, "g"), pattern: "capitalized pair" },
  ];

  for (const { regex, pattern } of bareNamePatterns) {
    // Convert to array for TypeScript compatibility
    const matches = Array.from(text.matchAll(regex));
    for (const match of matches) {
      if (match[1]) {
        const cleaned = match[1].trim();
        const words = cleaned.split(/\s+/).filter(isValidNameWord);
        
        if (words.length >= 1 && words.length <= 3) {
          const value = words.join(" ");
          let score = PATTERN_BASE_SCORES[pattern] || 30;
          score += calculateNameScoreAdjustments(value, cleaned, text, match.index || 0);
          
          candidates.push({
            value,
            pattern,
            score,
            messageIndex,
            rawMatch: cleaned,
          });
        }
      }
    }
  }

  return candidates;
}

/**
 * Calculate score adjustments based on quality signals
 * Phase 1 FINAL Hardening: DRAMATICALLY increased penalties for non-human names
 * Returns -9999 for automatic disqualification (ensures rejection)
 */
function calculateNameScoreAdjustments(value: string, rawMatch: string, fullText: string, matchIndex: number): number {
  let adjustment = 0;
  const words = value.split(/\s+/);
  const lowerValue = value.toLowerCase();
  const lowerWords = words.map(w => w.toLowerCase());

  // ============================================================
  // AUTOMATIC DISQUALIFIERS (return -9999 to guarantee rejection)
  // ============================================================
  
  const ORGANIZATION_KEYWORDS = new Set([
    // Civic / government
    "city", "county", "department", "public", "works", "utilities", "safety",
    "services", "authority", "district", "commission", "municipal", "government",
    // System / AI
    "ai", "bot", "assistant", "system", "intake", "automated", "inbot", "vapi",
    // Corporate
    "inc", "llc", "corp", "company", "corporation",
    // Brands commonly misheard
    "coca", "cola", "pepsi", "amazon", "google",
    // Location indicators
    "union", "center", "plaza", "station", "building",
  ]);

  // DISQUALIFY: Contains organization keyword
  for (const word of lowerWords) {
    if (ORGANIZATION_KEYWORDS.has(word)) {
      console.log(`[score] DISQUALIFIED (org keyword "${word}"): "${value}"`);
      return -9999; // Automatic disqualification
    }
  }

  // DISQUALIFY: Ends with AI, Bot, System, Inc, LLC, etc.
  if (/\s+(ai|bot|system|inc|llc|corp)$/i.test(value)) {
    console.log(`[score] DISQUALIFIED (entity suffix): "${value}"`);
    return -9999;
  }

  // DISQUALIFY: Looks like an organization name
  if (/^(union|public|general|central|main)\s+(city|works|services|department)/i.test(value)) {
    console.log(`[score] DISQUALIFIED (org pattern): "${value}"`);
    return -9999;
  }

  // ============================================================
  // HEAVY PENALTIES (for likely non-names)
  // ============================================================
  
  // Intent/filler words that slip through as names
  const INTENT_FILLER_WORDS = new Set([
    "calling", "texting", "reporting", "asking", "checking", "looking",
    "trying", "hoping", "needing", "wanting", "getting", "going",
    "about", "because", "help", "just", "still", "also", "here", "there",
    "pothole", "road", "street", "light", "water", "trash", "garbage",
    "bill", "payment", "issue", "problem", "damage", "broken", "repair",
    // Spanish
    "llamando", "reportando", "buscando", "tratando", "preguntando",
    "bache", "calle", "luz", "agua", "basura", "factura",
  ]);

  // -300: Contains intent/filler words (very likely not a name)
  const intentFillerCount = lowerWords.filter(w => INTENT_FILLER_WORDS.has(w)).length;
  if (intentFillerCount > 0) {
    adjustment -= 300 * intentFillerCount;
    console.log(`[score] -${300 * intentFillerCount} for intent/filler words in "${value}"`);
  }

  // -200: Single lowercase word (almost never a valid name)
  if (words.length === 1 && value === lowerValue) {
    adjustment -= 200;
    console.log(`[score] -200 for single lowercase word: "${value}"`);
  }
  
  // -150: Contains address-like words
  const addressWords = new Set([
    "la", "el", "los", "las", "calle", "avenida", "street", "avenue", "road", 
    "drive", "boulevard", "lane", "way", "court", "place", "north", "south",
    "east", "west", "main", "first", "second", "third",
  ]);
  const addressWordCount = lowerWords.filter(w => addressWords.has(w)).length;
  if (addressWordCount > 0) {
    adjustment -= 150 * addressWordCount;
    console.log(`[score] -${150 * addressWordCount} for address words in "${value}"`);
  }
  
  // -200: Appears right after "calling", "texting", etc. (verb phrase)
  const contextBefore = fullText.substring(Math.max(0, matchIndex - 50), matchIndex).toLowerCase();
  if (/(?:i'm|i am)\s*$/.test(contextBefore)) {
    if (/^(calling|texting|reporting|asking|checking|looking|trying|hoping)/i.test(rawMatch)) {
      adjustment -= 200;
      console.log(`[score] -200 for verb phrase context: "${value}"`);
    }
  }
  
  // -150: Single word that's a common noun
  if (words.length === 1) {
    const commonNouns = new Set([
      "five", "three", "one", "two", "four", "six", "seven", "eight", "nine", "ten",
      "first", "second", "third", "north", "south", "east", "west",
      "main", "oak", "pine", "maple", "elm", "cedar", "park", "lake",
      "soda", "help", "because", "about", "super", "fuller", "vienna",
    ]);
    if (commonNouns.has(lowerValue)) {
      adjustment -= 150;
      console.log(`[score] -150 for common noun: "${value}"`);
    }
  }

  // -150: Starts with a number word (address fragment)
  const numberStarters = new Set([
    "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
    "eleven", "twelve", "uno", "dos", "tres", "cuatro", "cinco",
  ]);
  if (words.length > 1 && numberStarters.has(lowerWords[0])) {
    adjustment -= 150;
    console.log(`[score] -150 for number word start: "${value}"`);
  }

  // -80: Contains digits
  if (/\d/.test(value)) {
    adjustment -= 80;
  }

  // ============================================================
  // POSITIVE signals (for likely human names)
  // ============================================================
  
  // +150: Has 2-3 words with proper case (First Last pattern)
  const allProperCase = words.every(w => 
    /^[A-Z\u00C0-\u00D6\u00D8-\u00DE][a-z\u00DF-\u00F6\u00F8-\u00FF]+$/.test(w)
  );
  if (allProperCase && words.length >= 2 && words.length <= 3) {
    adjustment += 150;
    console.log(`[score] +150 for proper case First Last pattern: "${value}"`);
  }
  
  // +80: Has 2-3 words (typical name length)
  if (words.length >= 2 && words.length <= 3) {
    adjustment += 80;
  }
  
  // +50: Appears later in transcript (late-stated names are corrections)
  if (matchIndex > 100) {
    adjustment += 50;
  }
  if (matchIndex > 300) {
    adjustment += 50; // Additional bonus for very late mentions
  }

  // +30: Contains common name suffixes (Jr, Sr, III, etc.)
  if (/\b(jr|sr|ii|iii|iv)\.?$/i.test(value)) {
    adjustment += 30;
  }

  return adjustment;
}

/**
 * Legacy function for backward compatibility - extracts first match only
 * Used by SMS extraction which doesn't need multi-candidate scoring
 */
function extractNameFromText(text: string): { name: string | null; pattern: string } {
  const candidates = extractAllNameCandidates(text, 0);
  if (candidates.length > 0) {
    // Return highest scoring candidate
    candidates.sort((a, b) => b.score - a.score);
    return { name: candidates[0].value, pattern: candidates[0].pattern };
  }
  return { name: null, pattern: "no match" };
}

/**
 * Extract caller name from transcript using MULTI-CANDIDATE SCORING
 * 
 * Phase 1 Hardening: Instead of "first valid match wins", we now:
 * 1. Collect ALL candidates from ALL messages (late-binding)
 * 2. Score each candidate based on confidence signals
 * 3. Select the highest-scoring candidate that passes validation
 * 4. Cross-validate against extracted address to catch bleeding
 *
 * @param messages - Array of VapiMessage objects
 * @param transcript - Full transcript string (fallback source)
 * @param extractedAddress - Optional: address already extracted (for cross-validation)
 */
export function extractName(
  messages: VapiMessage[], 
  transcript?: string,
  extractedAddress?: string
): { name: string; source: string } {
  
  console.log("[extractName] ====== MULTI-CANDIDATE EXTRACTION START ======");
  
  // Step 1: Collect ALL candidates from ALL sources (late-binding)
  const allCandidates: NameCandidate[] = [];
  
  // Source A: artifact.messages (structured user messages)
  const userMessages = messages.filter(m => m.role === "user");

  // DEBUG: Log all user messages to see what we're working with
  console.log(`[extractName] Processing ${userMessages.length} user messages:`);
  userMessages.forEach((msg, idx) => {
    const preview = msg.message.substring(0, 100);
    console.log(`[extractName]   user-msg[${idx}]: "${preview}${msg.message.length > 100 ? '...' : ''}"`);
    const candidates = extractAllNameCandidates(msg.message, idx);
    if (candidates.length > 0) {
      console.log(`[extractName]   → Found ${candidates.length} candidates: ${candidates.map(c => `"${c.value}" (${c.pattern}, score=${c.score})`).join(', ')}`);
    }
    allCandidates.push(...candidates);
  });

  console.log(`[extractName] Total candidates from user messages: ${allCandidates.length}`);

  // Source A2: bot messages (Phase 3 Hardening)
  // Assistant confirmations like "Got it, Tony Stark" contain clean name mentions
  const botMessages = messages.filter(m => m.role === "bot");
  if (botMessages.length > 0) {
    console.log(`[extractName] Scanning ${botMessages.length} bot messages for name confirmations:`);
    botMessages.forEach((msg, idx) => {
      const preview = msg.message.substring(0, 100);
      console.log(`[extractName]   bot-msg[${idx}]: "${preview}${msg.message.length > 100 ? '...' : ''}"`);
      const candidates = extractAllNameCandidates(msg.message, 800 + idx);
      // De-duplicate against existing candidates, slightly lower priority
      for (const c of candidates) {
        const isDuplicate = allCandidates.some(existing =>
          existing.value.toLowerCase() === c.value.toLowerCase()
        );
        if (!isDuplicate) {
          c.score -= 10; // Slightly lower score for bot-sourced names
          allCandidates.push(c);
        }
      }
    });
    console.log(`[extractName] Total candidates after bot messages: ${allCandidates.length}`);
  }
  
  // Source B: transcript string (fallback - may have different segmentation)
  if (transcript) {
    const transcriptCandidates = extractAllNameCandidates(transcript, 999);
    // Avoid duplicates by checking if value already exists
    for (const tc of transcriptCandidates) {
      const isDuplicate = allCandidates.some(c => 
        c.value.toLowerCase() === tc.value.toLowerCase()
      );
      if (!isDuplicate) {
        // Slightly lower score for transcript-only matches (less structured)
        tc.score -= 5;
        allCandidates.push(tc);
      }
    }
    console.log(`[extractName] Total candidates after transcript: ${allCandidates.length}`);
  }
  
  // Step 2: Cross-field validation - ADDRESS OVERLAP IS NOW A DISQUALIFIER
  // Phase 1 Final Hardening: If >50% of name words overlap with address, DISQUALIFY
  // This catches cases like "five three La" when address is "53 La Cienega Boulevard"
  if (extractedAddress && extractedAddress !== "Not provided") {
    const addressLower = extractedAddress.toLowerCase();
    const addressWords = new Set(addressLower.split(/\s+/).filter(w => w.length > 1));
    
    for (const candidate of allCandidates) {
      const nameLower = candidate.value.toLowerCase();
      const nameWords = nameLower.split(/\s+/);
      
      // Check if name words appear in address (address bleeding)
      const overlappingWords = nameWords.filter(w => 
        w.length > 1 && (addressLower.includes(w) || addressWords.has(w))
      );
      const overlapCount = overlappingWords.length;
      
      if (overlapCount > 0) {
        const overlapRatio = overlapCount / nameWords.length;
        
        // DISQUALIFY: If majority of words overlap with address, this is address bleeding
        if (overlapRatio >= 0.5) {
          console.log(`[extractName] DISQUALIFIED: "${candidate.value}" has ${Math.round(overlapRatio * 100)}% overlap with address`);
          candidate.score = -9999; // Disqualify
          continue;
        }
        
        // Heavy penalty for partial overlap
        const penalty = overlapCount * 200;
        console.log(`[extractName] Cross-field: "${candidate.value}" overlaps with address (${overlappingWords.join(", ")}), -${penalty}`);
        candidate.score -= penalty;
      }
      
      // DISQUALIFY: If name contains number words and address contains numbers
      // This is almost certainly address bleeding ("five three" → "53")
      const nameHasNumberWords = nameWords.some(w => 
        /^(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)$/i.test(w)
      );
      const addressHasDigits = /\d/.test(extractedAddress);
      if (nameHasNumberWords && addressHasDigits) {
        console.log(`[extractName] DISQUALIFIED: "${candidate.value}" has number words, address has digits`);
        candidate.score = -9999; // Disqualify
      }
    }
  }
  
  // Step 3: Sort by score (highest first) and select best valid candidate
  allCandidates.sort((a, b) => b.score - a.score);
  
  // Log top candidates for debugging
  const topCandidates = allCandidates.slice(0, 5);
  console.log("[extractName] Top candidates:");
  topCandidates.forEach((c, i) => {
    console.log(`  ${i + 1}. "${c.value}" | pattern=${c.pattern} | score=${c.score} | msg=${c.messageIndex}`);
  });
  
  // Step 4: Select highest-scoring candidate that passes validation
  for (const candidate of allCandidates) {
    const validated = validateExtractedName(candidate.value);
    if (validated) {
      const source = candidate.messageIndex === 999 
        ? `transcript/${candidate.pattern}` 
        : `messages[${candidate.messageIndex}]/${candidate.pattern}`;
      
      console.log(`[extractName] SELECTED: "${validated}" | score=${candidate.score} | source=${source}`);
      console.log("[extractName] ====== MULTI-CANDIDATE EXTRACTION END ======");
      return { name: validated, source };
    }
    console.log(`[extractName] Candidate "${candidate.value}" failed validation`);
  }
  
  // No valid candidates found
  console.log("[extractName] No valid candidates found, using default");
  console.log("[extractName] ====== MULTI-CANDIDATE EXTRACTION END ======");
  return { name: "Unknown Caller", source: "default" };
}

// Street type suffixes (English and Spanish)
// Phase 1 Spanish Hardening: Added Spanish street types
const STREET_TYPES_ENGLISH = "Street|St|Avenue|Ave|Drive|Dr|Road|Rd|Boulevard|Blvd|Lane|Ln|Way|Court|Ct|Place|Pl|Circle|Cir|Terrace|Ter|Trail|Trl|Parkway|Pkwy|Highway|Hwy";
const STREET_TYPES_SPANISH = "Calle|Avenida|Av|Pasaje|Camino|Carretera|Plaza|Callejón|Paseo|Bulevar|Autopista|Vereda|Sendero";
const STREET_TYPES = `${STREET_TYPES_ENGLISH}|${STREET_TYPES_SPANISH}`;

// Spoken number words (English and Spanish)
// Phase 1 Spanish Hardening: Added Spanish number words
const SPOKEN_NUMBERS_ENGLISH = "zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand";
const SPOKEN_NUMBERS_SPANISH = "cero|uno|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|trece|catorce|quince|dieciséis|dieciseis|diecisiete|dieciocho|diecinueve|veinte|veintiuno|veintidos|veintidós|veintitrés|veintitres|veinticuatro|veinticinco|veintiseis|veintiséis|veintisiete|veintiocho|veintinueve|treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|cien|ciento|mil";
const SPOKEN_NUMBERS = `${SPOKEN_NUMBERS_ENGLISH}|${SPOKEN_NUMBERS_SPANISH}`;

// ============================================================
// SPOKEN NUMBER → DIGIT NORMALIZATION
// ============================================================
// Converts spoken addresses like "Eleven twenty two Main Street"
// to normalized form "1122 Main Street"
// ============================================================

// Basic number words → digits (0-19)
// Phase 1 Spanish Hardening: Added Spanish number words
const WORD_TO_DIGIT: Record<string, number> = {
  // English
  zero: 0, oh: 0, o: 0,
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  // Spanish basic (0-9)
  cero: 0,
  uno: 1, una: 1,
  dos: 2, tres: 3, cuatro: 4, cinco: 5,
  seis: 6, siete: 7, ocho: 8, nueve: 9,
  // Spanish 10-19
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15,
  dieciséis: 16, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
  // Spanish 20-29 (special compound forms)
  veintiuno: 21, veintidós: 22, veintidos: 22, veintitrés: 23, veintitres: 23,
  veinticuatro: 24, veinticinco: 25, veintiséis: 26, veintiseis: 26,
  veintisiete: 27, veintiocho: 28, veintinueve: 29,
};

// Tens words → base value
// Phase 1 Spanish Hardening: Added Spanish tens
const TENS_WORDS: Record<string, number> = {
  // English
  twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  // Spanish
  veinte: 20, treinta: 30, cuarenta: 40, cincuenta: 50,
  sesenta: 60, setenta: 70, ochenta: 80, noventa: 90,
};

// Multiplier words
// Phase 1 Spanish Hardening: Added Spanish multipliers
const MULTIPLIERS: Record<string, number> = {
  // English
  hundred: 100,
  thousand: 1000,
  // Spanish
  cien: 100,    // "cien" = exactly 100
  ciento: 100,  // "ciento" = 100 when combined (e.g., "ciento veinte" = 120)
  mil: 1000,
};

// Street type keywords (stop parsing when we hit these)
// Phase 1 Spanish Hardening: Added Spanish street types and common words
// Phase 2 Hardening: REMOVED ordinals (first-fifth) - they should be part of address numbers
const STREET_KEYWORDS = new Set([
  // English street types
  "street", "st", "avenue", "ave", "drive", "dr", "road", "rd",
  "boulevard", "blvd", "lane", "ln", "way", "court", "ct",
  "place", "pl", "circle", "cir", "terrace", "ter", "trail", "trl",
  "parkway", "pkwy", "highway", "hwy",
  // Spanish street types
  "calle", "avenida", "av", "pasaje", "camino", "carretera", "plaza",
  "callejón", "callejon", "paseo", "bulevar", "autopista", "vereda", "sendero",
  // English common street name words (NOT ordinals - those are handled separately)
  "main", "oak", "maple", "elm", "pine", "cedar",
  "north", "south", "east", "west",
  // Spanish common street name words
  "norte", "sur", "este", "oeste", "principal", "central", "mayor",
]);

// ============================================================
// ORDINAL NUMBERS (Phase 2 Hardening)
// ============================================================
// Ordinal numbers for street addresses: "24th Street", "1st Avenue"
// These should be treated as part of the street NUMBER, not the name
// e.g., "twenty fourth street" → "24th Street" (not "20 fourth Street")
// ============================================================
const ORDINAL_WORDS: Record<string, string> = {
  "first": "1st", "second": "2nd", "third": "3rd", "fourth": "4th", "fifth": "5th",
  "sixth": "6th", "seventh": "7th", "eighth": "8th", "ninth": "9th", "tenth": "10th",
  "eleventh": "11th", "twelfth": "12th", "thirteenth": "13th", "fourteenth": "14th",
  "fifteenth": "15th", "sixteenth": "16th", "seventeenth": "17th", "eighteenth": "18th",
  "nineteenth": "19th", "twentieth": "20th", "thirtieth": "30th", "fortieth": "40th",
  "fiftieth": "50th", "sixtieth": "60th", "seventieth": "70th", "eightieth": "80th",
  "ninetieth": "90th", "hundredth": "100th",
  // Spanish ordinals
  "primero": "1st", "primera": "1st", "segundo": "2nd", "segunda": "2nd",
  "tercero": "3rd", "tercera": "3rd", "cuarto": "4th", "cuarta": "4th",
  "quinto": "5th", "quinta": "5th",
};

// Check if word is an ordinal that can follow a number
// e.g., "twenty" + "fourth" = "24th"
function isOrdinalWord(word: string): boolean {
  return ORDINAL_WORDS[word.toLowerCase()] !== undefined;
}

// Get the numeric value of an ordinal (for combining with tens)
// e.g., "fourth" → 4 (to combine with "twenty" → 24)
function getOrdinalValue(word: string): number | null {
  const lower = word.toLowerCase();
  const ordinal = ORDINAL_WORDS[lower];
  if (!ordinal) return null;
  // Extract number from ordinal string (e.g., "4th" → 4)
  const num = parseInt(ordinal, 10);
  return isNaN(num) ? null : num;
}

/**
 * Check if a word is a number word
 * Phase 1 Spanish Hardening: Also recognizes "y" (Spanish "and") as part of numbers
 */
function isNumberWord(word: string): boolean {
  const lower = word.toLowerCase();
  // "y" is Spanish "and" used in numbers like "veinte y dos" (22)
  if (lower === "y") return true;
  return (
    WORD_TO_DIGIT[lower] !== undefined ||
    TENS_WORDS[lower] !== undefined ||
    MULTIPLIERS[lower] !== undefined
  );
}

/**
 * Parse a sequence of number words into a single number
 * Handles: "eleven twenty two" → 1122, "five four eight four" → 5484
 * Phase 1 Spanish Hardening: Also handles "veinte y dos" → 22
 */
function parseSpokenNumber(words: string[]): number | null {
  if (words.length === 0) return null;

  // Filter out Spanish "y" (and) conjunction - it's just a connector
  // e.g., "treinta y cinco" → ["treinta", "cinco"] → 35
  words = words.filter(w => w.toLowerCase() !== "y");

  // Strategy 1: Try compound number interpretation (e.g., "eleven twenty two" = 11*100 + 22 = 1122)
  // Strategy 2: Try digit-by-digit interpretation (e.g., "five four eight four" = 5484)

  // First, check if this looks like digit-by-digit (all single digits 0-9)
  const allSingleDigits = words.every(w => {
    const lower = w.toLowerCase();
    const val = WORD_TO_DIGIT[lower];
    return val !== undefined && val <= 9;
  });

  if (allSingleDigits && words.length >= 2) {
    // Digit-by-digit: "five four eight four" → "5484"
    let result = "";
    for (const w of words) {
      result += WORD_TO_DIGIT[w.toLowerCase()];
    }
    return parseInt(result, 10);
  }

  // Compound number parsing
  // Handle patterns like:
  // - "eleven twenty two" → 1122 (11 * 100 + 22)
  // - "fifty four eighty four" → 5484 (54 * 100 + 84)
  // - "one thousand two hundred" → 1200
  // - "twenty two" → 22

  let result = 0;
  let current = 0;
  let hasHundredOrThousand = false;

  for (const word of words) {
    const lower = word.toLowerCase();

    if (WORD_TO_DIGIT[lower] !== undefined) {
      current += WORD_TO_DIGIT[lower];
    } else if (TENS_WORDS[lower] !== undefined) {
      current += TENS_WORDS[lower];
    } else if (lower === "hundred" || lower === "cien" || lower === "ciento") {
      // English "hundred" or Spanish "cien"/"ciento"
      current = current === 0 ? 100 : current * 100;
      hasHundredOrThousand = true;
    } else if (lower === "thousand" || lower === "mil") {
      // English "thousand" or Spanish "mil"
      current = current === 0 ? 1000 : current * 1000;
      hasHundredOrThousand = true;
    }
  }

  result += current;

  // Special case: "eleven twenty two" should be 1122, not 33
  // If we have multiple "compound" groups without hundred/thousand, treat as digit groups
  // Logic: "eleven" = group 1 (11), "twenty two" = group 2 (22) → concatenate "1122"
  if (!hasHundredOrThousand && words.length >= 2) {
    // Try to detect digit-group pattern: "eleven twenty two" = "11" + "22" = 1122
    const groups: number[] = [];
    let groupCurrent = 0;
    let lastWasTens = false; // Track if last token was a tens word (20, 30, etc.)

    for (const word of words) {
      const lower = word.toLowerCase();

      if (WORD_TO_DIGIT[lower] !== undefined) {
        const digitVal = WORD_TO_DIGIT[lower];

        // If last was a tens word (20-90) and this is a ones digit (1-9), combine them
        // e.g., "twenty" (20) + "two" (2) = 22
        if (lastWasTens && digitVal >= 1 && digitVal <= 9) {
          groupCurrent += digitVal;
          lastWasTens = false;
        } else if (groupCurrent > 0) {
          // Start a new group
          groups.push(groupCurrent);
          groupCurrent = digitVal;
          lastWasTens = false;
        } else {
          // First number in sequence
          groupCurrent = digitVal;
          lastWasTens = false;
        }
      } else if (TENS_WORDS[lower] !== undefined) {
        if (groupCurrent > 0) {
          // Push previous group, start new group with tens
          groups.push(groupCurrent);
        }
        groupCurrent = TENS_WORDS[lower];
        lastWasTens = true; // Mark that we just saw a tens word
      }
    }

    if (groupCurrent > 0) {
      groups.push(groupCurrent);
    }

    // If we have multiple groups, concatenate them as strings
    if (groups.length >= 2) {
      const concatenated = groups.map(g => g.toString()).join("");
      return parseInt(concatenated, 10);
    }
  }

  return result > 0 ? result : null;
}

/**
 * Normalize spoken numbers in an address to digits
 * Phase 2 Hardening: Also handles ordinal numbers for street addresses
 *
 * Examples:
 *   "Eleven twenty two Main Street" → "1122 Main Street"
 *   "five four eight four Main Street" → "5484 Main Street"
 *   "fifty four eighty four Oak Drive" → "5484 Oak Drive"
 *   "nine oh five Pine Lane" → "905 Pine Lane"
 *   "twenty fourth Street" → "24th Street" (ORDINAL)
 *   "seven oh one one twenty fourth Street" → "7011 24th Street" (MIXED)
 */
export function normalizeSpokenAddress(input: string): string {
  if (!input) return input;

  const words = input.split(/\s+/);
  const numberWords: string[] = [];
  const restWords: string[] = [];
  let foundStreetWord = false;
  let ordinalResult: string | null = null;

  // Collect leading number words until we hit a street keyword or non-number word
  // Phase 2 Hardening: Also check for ordinals
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const lower = word.toLowerCase().replace(/[.,!?]/g, "");

    if (foundStreetWord || STREET_KEYWORDS.has(lower)) {
      foundStreetWord = true;
      restWords.push(word);
    } else if (isOrdinalWord(lower)) {
      // ============================================================
      // ORDINAL HANDLING (Phase 2 Hardening)
      // ============================================================
      // Check if this ordinal follows a tens word to form compound ordinal
      // e.g., "twenty" + "fourth" = "24th"
      // e.g., "thirty" + "first" = "31st"
      // ============================================================
      
      const ordinalValue = getOrdinalValue(lower);
      if (ordinalValue !== null && ordinalValue <= 9 && numberWords.length > 0) {
        // Check if last number word was a tens word (20, 30, 40, etc.)
        const lastWord = numberWords[numberWords.length - 1];
        const tensValue = TENS_WORDS[lastWord];
        
        if (tensValue !== undefined && tensValue >= 20 && tensValue <= 90) {
          // Combine tens + ordinal: "twenty" (20) + "fourth" (4) = "24th"
          numberWords.pop(); // Remove the tens word
          const combined = tensValue + ordinalValue;
          ordinalResult = combined + getOrdinalSuffix(combined);
          console.log(`[normalize] Ordinal compound: "${lastWord} ${lower}" → "${ordinalResult}"`);
        } else {
          // Standalone ordinal after other numbers
          // e.g., "seven oh one one" + "first" = "7011 1st"
          ordinalResult = ORDINAL_WORDS[lower];
        }
      } else {
        // Standalone ordinal (e.g., "first street")
        ordinalResult = ORDINAL_WORDS[lower];
      }
      foundStreetWord = true;
      // Don't add ordinal to restWords - we'll handle it separately
    } else if (isNumberWord(lower)) {
      numberWords.push(lower);
    } else {
      // Non-number word that's not a street keyword - start of street name
      restWords.push(word);
      foundStreetWord = true;
    }
  }

  // If no number words found and no ordinal, return original
  if (numberWords.length === 0 && !ordinalResult) {
    return input;
  }

  // Parse the number words (if any)
  let addressNumber = "";
  if (numberWords.length > 0) {
    const parsedNumber = parseSpokenNumber(numberWords);
    if (parsedNumber !== null) {
      addressNumber = parsedNumber.toString();
    }
  }

  // Combine: number + ordinal + rest
  const parts: string[] = [];
  if (addressNumber) parts.push(addressNumber);
  if (ordinalResult) parts.push(ordinalResult);
  parts.push(...restWords);

  const normalizedAddress = parts.join(" ");

  console.log(`[normalize] "${input}" → "${normalizedAddress}"`);

  return normalizedAddress;
}

/**
 * Get ordinal suffix for a number (1st, 2nd, 3rd, 4th, etc.)
 */
function getOrdinalSuffix(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

/**
 * Extract address from text using multiple patterns
 * Returns { address, source } for logging
 */
function extractAddressFromText(text: string): { address: string | null; pattern: string } {
  if (!text) return { address: null, pattern: "empty" };

  // Pattern 1: Numeric address "123 Main Street"
  // Phase 2 Hardening: Multiple patterns for different address formats
  const numericPatterns = [
    // Standard: "123 Main Street", "456 Oak Avenue"
    new RegExp(`(\\d{1,6}\\s+[A-Za-z][A-Za-z'-]*(?:\\s+[A-Za-z][A-Za-z'-]*){0,4}\\s+(?:${STREET_TYPES}))`, "i"),
    // With directional: "123 North Main Street", "456 South Oak Avenue"
    new RegExp(`(\\d{1,6}\\s+(?:North|South|East|West|N|S|E|W)\\.?\\s+[A-Za-z][A-Za-z'-]*(?:\\s+[A-Za-z][A-Za-z'-]*){0,3}\\s+(?:${STREET_TYPES}))`, "i"),
    // Numbered street: "123 5th Avenue", "456 23rd Street"
    new RegExp(`(\\d{1,6}\\s+\\d{1,3}(?:st|nd|rd|th)\\s+(?:${STREET_TYPES}))`, "i"),
    // Complex multi-word: "123 Martin Luther King Jr Boulevard"
    new RegExp(`(\\d{1,6}\\s+[A-Z][a-z]+(?:\\s+[A-Z][a-z]+){1,5}\\s+(?:${STREET_TYPES}))`, "i"),
  ];
  
  for (const pattern of numericPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      console.log(`[extractAddressFromText] Pattern 1 (numeric) MATCHED: "${match[1]}"`);
      return { address: match[1].replace(/[.,!?]$/, "").trim(), pattern: "numeric" };
    }
  }

  // Pattern 2: Spoken number address "fifty four eighty four Main Street"
  const spokenPattern = new RegExp(
    `(((?:${SPOKEN_NUMBERS})(?:\\s+(?:${SPOKEN_NUMBERS}))*)[\\s,]+([A-Za-z][A-Za-z'-]*(?:\\s+[A-Za-z][A-Za-z'-]*){0,3})\\s+(${STREET_TYPES}))`,
    "i"
  );
  const spokenMatch = text.match(spokenPattern);
  if (spokenMatch && spokenMatch[1]) {
    console.log(`[extractAddressFromText] Pattern 2 (spoken) MATCHED: "${spokenMatch[1]}"`);
    // Store the spoken address as-is (no conversion needed for now)
    return { address: spokenMatch[1].replace(/[.,!?]$/, "").trim(), pattern: "spoken" };
  }

  // Pattern 3: "address is..." or "at..." followed by address-like text
  // Phase 1 Spanish Hardening: Added Spanish address prefix patterns
  // Phase 2 Hardening: Expanded trigger phrases
  const prefixPatterns = [
    // NUMERIC ADDRESS WITH TRIGGER PHRASES
    // "it's at 123 Main Street", "the address is 456 Oak Avenue"
    /(?:it'?s\s+(?:at|on)|address\s+is|my\s+address\s+is|i(?:'m|\s+am)\s+at|i\s+live\s+at|located\s+at|it'?s\s+(?:at\s+)?)\s*(\d{1,6}\s+[\w\s'-]+(?:Street|St|Avenue|Ave|Drive|Dr|Road|Rd|Boulevard|Blvd|Lane|Ln|Way|Court|Ct|Place|Pl|Circle|Cir|Terrace|Ter|Parkway|Pkwy|Highway|Hwy))/i,
    // "on 123 Oak Street", "at 456 Main Avenue"
    /(?:^|\s)(?:on|at)\s+(\d{1,6}\s+[\w\s'-]+(?:Street|St|Avenue|Ave|Drive|Dr|Road|Rd|Boulevard|Blvd|Lane|Ln|Way|Court|Ct|Place|Pl|Circle|Cir))/i,
    // English prefixes without street number (less common)
    /(?:address\s+is|my\s+address\s+is|i(?:'m|\s+am)\s+at|i\s+live\s+at|located\s+at)\s+([\w\s'-]+(?:Street|St|Avenue|Ave|Drive|Dr|Road|Rd|Boulevard|Blvd|Lane|Ln|Way|Court|Ct|Place|Pl|Circle|Cir))/i,
    // Spanish prefixes: "vivo en la Calle 5 de Marzo 123" or "mi dirección es Avenida Central 456"
    /(?:vivo\s+en(?:\s+la|\s+el)?|mi\s+direcci[oó]n\s+es|estoy\s+en(?:\s+la|\s+el)?|queda\s+en(?:\s+la|\s+el)?)\s+((?:Calle|Avenida|Av|Pasaje|Camino|Carretera|Plaza|Callej[oó]n|Paseo|Bulevar)\s+[\w\s]+?\s*\d{1,6})/i,
    // Spanish: number first "vivo en el 123 de la Calle Main"
    /(?:vivo\s+en(?:\s+la|\s+el)?|mi\s+direcci[oó]n\s+es|estoy\s+en(?:\s+la|\s+el)?)\s+(?:el\s+)?(\d{1,6}\s+(?:de\s+la\s+)?(?:Calle|Avenida|Av|Pasaje|Camino|Carretera|Plaza)\s+[\w\s]+)/i,
    // Spanish: "en la calle Oak" without number
    /(?:en\s+la|en\s+el)\s+((?:Calle|Avenida|Av|Pasaje|Camino)\s+[\w\s]+)/i,
    
    // ============================================================
    // PHASE 2 SPANISH HARDENING: Additional Spanish address patterns
    // ============================================================
    // "es en la calle X" / "está en la calle X" - common response to "what's the address?"
    /(?:es\s+en|est[aá]\s+en|queda\s+en)\s+(?:la\s+|el\s+)?((?:Calle|Avenida|Av|Pasaje|Camino|Carretera|Plaza|Bulevar)\s+[\w\s]+)/i,
    // "la dirección es [address]"
    /la\s+direcci[oó]n\s+es\s+((?:Calle|Avenida|Av)?\s*[\w\s]+\s*\d{1,6})/i,
    // "en [Street Name]" without explicit Calle/Avenida - common in casual speech
    /(?:est[aá]|queda|es)\s+en\s+(\d{1,6}\s+[\w\s]+)/i,
    // Spanish street with "número" - "Calle Oak número 123" / "Avenida Central número 456"
    /((?:Calle|Avenida|Av|Pasaje|Camino|Plaza)\s+[\w\s]+)\s+n[uú]mero\s+(\d{1,6})/i,
  ];

  for (const pattern of prefixPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      console.log(`[extractAddressFromText] Pattern 3 (prefix) MATCHED: "${match[1]}"`);
      return { address: match[1].replace(/[.,!?]$/, "").trim(), pattern: "prefix" };
    }
  }

  // Pattern 3b: "on/at [Street Name]" - captures addresses mentioned with prepositions
  // Phase 2 Hardening: Expanded to handle complex multi-word street names
  // Examples: "on Oak Street", "at Martin Luther King Boulevard", "on North Main Street"
  const onAtPatterns = [
    // With number: "on 123 Oak Street"
    new RegExp(`(?:on|at)\\s+(\\d{1,6}\\s+[A-Za-z][A-Za-z\\s'-]+(?:${STREET_TYPES}))`, "i"),
    // With directional: "on North Oak Street", "at East Main Avenue"
    new RegExp(`(?:on|at)\\s+((?:North|South|East|West|N|S|E|W)\\.?\\s+[A-Za-z][A-Za-z\\s'-]+(?:${STREET_TYPES}))`, "i"),
    // Multi-word street name: "on Martin Luther King Boulevard"
    new RegExp(`(?:on|at)\\s+([A-Z][a-z]+(?:\\s+[A-Z][a-z]+){1,4}\\s+(?:${STREET_TYPES}))`, "i"),
    // Simple: "on Oak Street"
    new RegExp(`(?:on|at)\\s+([A-Z][a-z]+\\s+(?:${STREET_TYPES}))`, "i"),
    
    // ============================================================
    // SPANISH "en la/el" patterns (Phase 2 Spanish Hardening)
    // ============================================================
    // "en la calle Oak" / "en el 123 de Oak"
    new RegExp(`(?:en\\s+la|en\\s+el)\\s+((?:Calle|Avenida|Av|Pasaje|Camino|Plaza|Bulevar)\\s+[\\w\\s]+)`, "i"),
    // "en la [number] [street name]" - "en la 123 Oak Street"
    new RegExp(`(?:en\\s+la|en\\s+el)\\s+(\\d{1,6}\\s+[\\w\\s]+(?:${STREET_TYPES}))`, "i"),
    // "en [street name] número [number]" - "en Oak Street número 123"
    new RegExp(`en\\s+([\\w\\s]+(?:${STREET_TYPES}))\\s+n[uú]mero\\s+\\d{1,6}`, "i"),
  ];
  
  for (const pattern of onAtPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      // Skip if it matches "on my street" or similar
      if (/^(?:my|the|our|this|mi|la|el)\s+(?:calle|street|casa|house)$/i.test(match[1])) continue;
      console.log(`[extractAddressFromText] Pattern 3b (on/at + street) MATCHED: "${match[1]}"`);
      return { address: match[1].replace(/[.,!?]$/, "").trim(), pattern: "on-at-street" };
    }
  }

  // Pattern 4: Any text ending in a street type (less confident)
  // Supports accented characters for Spanish street names
  // Phase 2 Hardening: Added question phrase rejection
  const anyStreetPattern = new RegExp(
    `([A-Za-z0-9\\u00C0-\\u00FF][A-Za-z0-9\\u00C0-\\u00FF\\s'-]{3,40}\\s+(?:${STREET_TYPES}))(?:[.,\\s]|$)`,
    "i"
  );
  const anyMatch = text.match(anyStreetPattern);
  if (anyMatch && anyMatch[1]) {
    const candidate = anyMatch[1].replace(/[.,!?]$/, "").trim();
    // Must have at least 2 words
    if (candidate.split(/\s+/).length >= 2) {
      // Phase 2 Hardening: Reject if it looks like an AI agent question
      // Words that indicate this is a question, not an address
      const QUESTION_STARTERS = new Set([
        "what", "where", "which", "how", "when", "why", "who",
        "is", "are", "do", "does", "can", "could", "would", "should",
        "and", // Often prefixes questions: "And what is the street?"
        // Spanish
        "cual", "cuál", "que", "qué", "donde", "dónde", "como", "cómo",
      ]);
      const firstWord = candidate.split(/\s+/)[0].toLowerCase();
      if (QUESTION_STARTERS.has(firstWord)) {
        console.log(`[extractAddressFromText] Pattern 4 REJECTED (question phrase): "${candidate}"`);
        // Don't return - continue to other patterns
      } else {
        console.log(`[extractAddressFromText] Pattern 4 (any-street) MATCHED: "${candidate}"`);
        return { address: candidate, pattern: "any-street" };
      }
    }
  }

  // Pattern 4b: Spanish address format "Calle X número Y" or "Calle X #Y"
  // Example: "Calle 5 de Marzo 123", "Avenida Central número 456"
  const spanishAddressPattern = /(?:Calle|Avenida|Av|Pasaje|Camino|Carretera|Plaza|Callej[oó]n|Paseo|Bulevar)\s+[\w\s]+?(?:\s+(?:n[uú]mero|#|no\.?)?\s*\d{1,6}|\d{1,6})/i;
  const spanishMatch = text.match(spanishAddressPattern);
  if (spanishMatch && spanishMatch[0]) {
    const candidate = spanishMatch[0].replace(/[.,!?]$/, "").trim();
    if (candidate.length >= 10) { // Reasonable minimum for Spanish address
      return { address: candidate, pattern: "spanish-format" };
    }
  }

  // Pattern 5: Number + capitalized word(s) WITHOUT street type (Fix 2 - lowest priority)
  // Matches: "1234 Maple", "5678 Oak Ridge", "123 North Main"
  // Does NOT match: "1234" alone, "1234 the", "1234 a", articles, prepositions
  const ARTICLES_PREPS = new Set(["the", "a", "an", "at", "on", "in", "to", "for", "of", "and", "or", "but", "is", "it"]);
  const noStreetTypePattern = /(\d{1,6})\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})\b/;
  const noTypeMatch = text.match(noStreetTypePattern);
  if (noTypeMatch && noTypeMatch[1] && noTypeMatch[2]) {
    const streetNumber = noTypeMatch[1];
    const streetName = noTypeMatch[2].trim();
    const firstWord = streetName.split(/\s+/)[0].toLowerCase();

    // Reject if first word is an article/preposition
    if (!ARTICLES_PREPS.has(firstWord)) {
      const candidate = `${streetNumber} ${streetName}`;
      console.log(`[extractAddress] Pattern 5 (no-street-type) matched: "${candidate}"`);
      return { address: candidate, pattern: "no-street-type" };
    }
  }

  // ============================================================
  // Pattern 6: CONTEXTUAL LOCATION PATTERNS (Phase 2 Hardening)
  // ============================================================
  // These capture approximate/contextual locations when no specific address is given.
  // Examples: "on my block", "in the parking lot", "corner of Oak and Main"
  // Returns with "(Approximate)" suffix to indicate lower confidence.
  // ============================================================
  
  // Cross-street / intersection patterns (most useful contextual info)
  const crossStreetPatterns = [
    // "corner of X and Y", "intersection of X and Y"
    /(?:corner|intersection)\s+(?:of\s+)?([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)\s+(?:and|&|y)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
    // "on X near Y", "on X between Y and Z"
    /(?:on|at)\s+([A-Z][a-z]+(?:\s+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr))?)\s+(?:near|between)\s+([A-Z][a-z]+)/i,
    // Spanish: "esquina de X y Y"
    /(?:esquina\s+de|cruce\s+de)\s+([\w]+)\s+(?:y|con)\s+([\w]+)/i,
  ];
  
  for (const pattern of crossStreetPatterns) {
    const match = text.match(pattern);
    if (match && match[1] && match[2]) {
      const location = `${match[1]} & ${match[2]} (Approximate)`;
      console.log(`[extractAddress] Pattern 6a (cross-street) matched: "${location}"`);
      return { address: location, pattern: "cross-street" };
    }
  }

  // Contextual neighborhood/area patterns (lower confidence)
  const contextualPatterns = [
    // "on my block/street/road"
    { pattern: /(?:on|in)\s+(?:my|the|our)\s+(block|street|road|neighborhood|area)/i, type: "relative" },
    // "outside/in front of [building type]"
    { pattern: /(?:outside|in\s+front\s+of|behind|near)\s+(?:my|the|a)\s+(house|building|apartment|store|school|church|park|library|hospital)/i, type: "building-ref" },
    // "in the parking lot/alley/driveway"
    { pattern: /(?:in|at)\s+(?:the|my|a)\s+(parking\s+lot|alley|driveway|garage|backyard|front\s+yard)/i, type: "area" },
    // Spanish contextual
    { pattern: /(?:en\s+mi|en\s+la|en\s+el)\s+(cuadra|calle|barrio|colonia|vecindario)/i, type: "relative-es" },
  ];
  
  for (const { pattern, type } of contextualPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const location = `${match[1]} (Approximate)`;
      console.log(`[extractAddress] Pattern 6b (${type}) matched: "${location}"`);
      return { address: location, pattern: `contextual-${type}` };
    }
  }

  return { address: null, pattern: "no match" };
}

/**
 * Extract street address from transcript (two-pass)
 * Pass A: artifact.messages (structured)
 * Pass B: transcript string (fallback)
 *
 * Applies spoken number normalization and validation before returning:
 *   "Eleven twenty two Main Street" → "1122 Main Street"
 */
export function extractAddress(messages: VapiMessage[], transcript?: string): { address: string; source: string } {
  console.log("[extractAddress] ====== ADDRESS EXTRACTION START ======");

  const userMessages = messages.filter(m => m.role === "user");
  // Phase 3 Hardening: Also scan bot messages (assistant confirmations often
  // contain the clearest address mention, e.g. "You said 2233 Fantastic Street")
  const allMessages = messages.filter(m => m.role === "user" || m.role === "bot");
  console.log(`[extractAddress] Processing ${userMessages.length} user messages, ${allMessages.length} total (user+bot)`);

  // ============================================================
  // PHASE 2 HARDENING: Two-phase extraction
  // ============================================================
  // Phase 1: Look for SPECIFIC addresses (numeric, spoken, prefix patterns)
  //   Pass A: user messages (highest trust)
  //   Pass B: bot messages (assistant confirmations)
  //   Pass C: transcript string (contains all turns interleaved)
  // Phase 2: Only if Phase 1 fails, accept contextual/approximate addresses
  // ============================================================

  let contextualCandidate: { address: string; source: string } | null = null;

  // Helper: try extracting from a text block, return specific address or save contextual
  const tryExtract = (text: string, sourceLabel: string): { address: string; source: string } | null => {
    const result = extractAddressFromText(text);
    if (!result.address) return null;

    const isContextual = result.pattern.startsWith("contextual-") || result.pattern === "cross-street";
    const normalized = normalizeSpokenAddress(result.address);
    const validated = validateExtractedAddress(normalized);

    if (!validated) {
      console.log(`[extractAddress] → Validation REJECTED: "${normalized}" from ${sourceLabel}`);
      return null;
    }

    if (isContextual) {
      if (!contextualCandidate) {
        contextualCandidate = { address: validated, source: `${sourceLabel}/${result.pattern}` };
        console.log(`[extractAddress] → Saved contextual fallback: "${validated}" from ${sourceLabel}`);
      }
      return null;
    }

    return { address: validated, source: `${sourceLabel}/${result.pattern}` };
  };

  // Pass A: Search USER messages for specific addresses
  for (let i = 0; i < userMessages.length; i++) {
    const msg = userMessages[i];
    const preview = msg.message.substring(0, 150);
    console.log(`[extractAddress] user-msg[${i}]: "${preview}${msg.message.length > 150 ? '...' : ''}"`);

    const found = tryExtract(msg.message, "user-msg");
    if (found) {
      console.log(`[extractAddress] ====== FOUND SPECIFIC ADDRESS: "${found.address}" (source: ${found.source}) ======`);
      return found;
    }
  }
  console.log("[extractAddress] No specific address in user messages");

  // Pass B: Search BOT messages for specific addresses (assistant confirmations)
  // Phase 3 Hardening: Bot turns often contain the clearest address when the
  // system prompt confirms details ("You said 2233 Fantastic Street...")
  const botMessages = messages.filter(m => m.role === "bot");
  if (botMessages.length > 0) {
    console.log(`[extractAddress] Scanning ${botMessages.length} bot messages for address confirmations...`);
    for (let i = 0; i < botMessages.length; i++) {
      const msg = botMessages[i];
      const preview = msg.message.substring(0, 150);
      console.log(`[extractAddress] bot-msg[${i}]: "${preview}${msg.message.length > 150 ? '...' : ''}"`);

      const found = tryExtract(msg.message, "bot-msg");
      if (found) {
        console.log(`[extractAddress] ====== FOUND SPECIFIC ADDRESS IN BOT CONFIRMATION: "${found.address}" (source: ${found.source}) ======`);
        return found;
      }
    }
    console.log("[extractAddress] No specific address in bot messages");
  }

  // Pass C: Try transcript for specific addresses (contains all turns interleaved)
  if (transcript) {
    const transcriptPreview = transcript.substring(0, 300);
    console.log(`[extractAddress] Transcript preview: "${transcriptPreview}${transcript.length > 300 ? '...' : ''}"`);

    const found = tryExtract(transcript, "transcript");
    if (found) {
      console.log(`[extractAddress] ====== FOUND SPECIFIC ADDRESS: "${found.address}" (source: ${found.source}) ======`);
      return found;
    }
  } else {
    console.log("[extractAddress] No transcript provided");
  }

  // Phase 2: If no specific address found, use contextual fallback
  // Note: contextualCandidate is mutated inside tryExtract() closure, so TS needs the assertion
  const fallback = contextualCandidate as { address: string; source: string } | null;
  if (fallback) {
    console.log(`[extractAddress] ====== USING CONTEXTUAL FALLBACK: "${fallback.address}" ======`);
    return fallback;
  }

  console.log("[extractAddress] ====== NO ADDRESS FOUND - returning 'Not provided' ======");
  return { address: "Not provided", source: "default" };
}

/**
 * Build raw issue text from messages for classification.
 * Phase 3 Hardening: Include both user AND bot messages to match re-eval parity.
 * Bot confirmations often restate/clarify the issue (e.g. "broken fire hydrant leaking water").
 * User messages listed first (primary), bot messages appended (context).
 */
export function buildRawIssueText(messages: VapiMessage[]): string {
  const userText = messages
    .filter(m => m.role === "user")
    .map(m => m.message)
    .join(" ")
    .trim();

  const botText = messages
    .filter(m => m.role === "bot")
    .map(m => m.message)
    .join(" ")
    .trim();

  const combined = [userText, botText].filter(Boolean).join(" ").trim();
  return combined || "No issue description provided";
}

// NOTE: classifyDepartment and classifyIntent have been moved to
// server/intake-classifier.ts which uses LLM-based classification

/**
 * Detect language from transcript (simple heuristic)
 * Phase 1 Spanish Hardening: Expanded Spanish indicators
 */
export function detectLanguage(messages: VapiMessage[]): string {
  const userText = messages
    .filter(m => m.role === "user")
    .map(m => m.message)
    .join(" ");

  // Expanded Spanish detection - check for common Spanish words and patterns
  // Includes greetings, common verbs, articles, and domain-specific words
  const spanishIndicators = /\b(hola|gracias|por favor|calle|donde|necesito|problema|ayuda|buenos d[ií]as|buenas tardes|buenas noches|me llamo|mi nombre|tengo|hay|est[aá]|quiero|puedo|bache|basura|factura|luz|agua|el|la|los|las|un|una|unos|unas|que|como|cuando|porque|pero|para|con|sin|sobre|hasta|desde|entre)\b/i;
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
 * 
 * Phase 1 Hardening: Uses multi-candidate scoring for name extraction
 * and cross-field validation to prevent address bleeding into name.
 */
export function transformVapiToIntakeRecord(payload: VapiWebhookPayload): PartialIntakeRecord & { rawText: string } {
  const msg = payload.message;
  const rawMessages = msg.artifact?.messages || [];
  const rawTranscript = msg.transcript || "";

  console.log("[vapi-transform] ====== EXTRACTION START ======");
  console.log("[vapi-transform] artifact.messages count:", rawMessages.length);
  console.log("[vapi-transform] transcript length:", rawTranscript.length);
  console.log("[vapi-transform] transcript preview:", rawTranscript.substring(0, 200));

  // Clean messages for extraction (Fix 4)
  const messages = cleanMessagesForExtraction(rawMessages);

  // ============================================================
  // Option A Fix: Compute concatenated messages text BEFORE extraction
  // This ensures Pass C uses the same text source as re-evaluation
  // (clean artifact.messages with proper bot confirmations)
  // ============================================================
  const userMsgCount = rawMessages.filter(m => m.role === "user").length;
  const botMsgCount = rawMessages.filter(m => m.role === "bot").length;
  const concatenatedMessages = buildRawIssueText(rawMessages);
  const hasArtifactMessages = concatenatedMessages && concatenatedMessages !== "No issue description provided";

  // For classification: prefer concatenated messages, fall back to Vapi transcript
  let rawIssueText = concatenatedMessages;
  let classificationSource = `messages(user=${userMsgCount},bot=${botMsgCount})`;
  if (!hasArtifactMessages) {
    rawIssueText = rawTranscript;
    classificationSource = "rawTranscript";
  }
  if (!rawIssueText && msg.analysis?.summary) {
    rawIssueText = msg.analysis.summary;
    classificationSource = "analysis.summary";
  }
  console.log(`[vapi-transform] Classification input source: ${classificationSource}`);
  console.log(`[vapi-transform] Classification text preview: "${(rawIssueText || "").substring(0, 300)}${(rawIssueText || "").length > 300 ? '...' : ''}"`);

  // Pass C transcript: use concatenated artifact.messages (matches re-eval input)
  // Fall back to Vapi's msg.transcript only if artifact.messages is empty
  const extractionTranscript = cleanTranscriptForExtraction(
    hasArtifactMessages ? concatenatedMessages : rawTranscript
  );
  console.log(`[vapi-transform] Pass C source: ${hasArtifactMessages ? "artifact.messages(concatenated)" : "msg.transcript(fallback)"}`);

  // IMPORTANT: Extract address FIRST so we can use it for cross-validation
  // This prevents address fragments from bleeding into the name field
  const addressResult = extractAddress(messages, extractionTranscript);
  console.log("[vapi-transform] ADDRESS extracted:", addressResult.address, "| source:", addressResult.source);

  // Extract name with multi-candidate scoring (Phase 1 Hardening)
  // Pass extracted address for cross-field validation
  const nameResult = extractName(messages, extractionTranscript, addressResult.address);
  console.log("[vapi-transform] NAME extracted:", nameResult.name, "| source:", nameResult.source);

  // Detect language (uses RAW messages - LLM handles filler words fine)
  const language = detectLanguage(rawMessages);

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

// ============================================================
// SMS FIELD EXTRACTION (Phase 1)
// ============================================================
//
// PRODUCT INTENT:
// - SMS intake is AI-assisted but NON-CONVERSATIONAL
// - SMS produces BEST-EFFORT structured data, not guaranteed complete
// - Voice remains the primary intake channel
//
// DATA QUALITY GUARANTEES:
// - We DO: Extract name/address when explicitly stated
// - We DO: Accept partial addresses (street name only)
// - We DO: Normalize spoken numbers in addresses
// - We DO NOT: Infer name from phone number
// - We DO NOT: Ask follow-up questions
// - We DO NOT: Retry failed extractions
//
// COMPLETENESS LEVELS:
// - "complete": Name extracted AND full address (number + street + type)
// - "partial": Address only OR partial address (no street number)
// - "minimal": Neither name nor address extracted (intent only)
//
// ============================================================

import OpenAI from "openai";

// Lazy-initialized OpenAI client (shared with intake-classifier)
let smsOpenaiClient: OpenAI | null = null;

function getSmsOpenAIClient(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }
  if (!smsOpenaiClient) {
    smsOpenaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return smsOpenaiClient;
}

/**
 * Completeness level for SMS extraction
 * - "complete": Name + full address (number + street + type)
 * - "partial": Address only, or partial address, or name only
 * - "minimal": Neither name nor address extracted
 */
export type SmsCompleteness = "complete" | "partial" | "minimal";

// SMS extraction result interface
export interface SmsExtractionResult {
  name: string;
  address: string;
  nameSource: "llm" | "regex" | "default";
  addressSource: "llm" | "regex" | "default";
  /** Completeness level: complete | partial | minimal */
  completeness: SmsCompleteness;
  /** True if address has street number (e.g., "1234 Main St" vs "Main St") */
  addressIsComplete: boolean;
}

/**
 * ACCEPTANCE CRITERIA: Valid Name
 * --------------------------------
 * A name IS extracted when:
 * - Explicitly stated: "My name is John Smith"
 * - Clearly provided: "John Smith here", "This is Maria Garcia"
 * - 1-3 words that look like names (capitalized, not common words)
 *
 * A name is NOT extracted when:
 * - Not explicitly provided in the message
 * - Only a phone number is present (NEVER infer name from phone)
 * - Ambiguous text that could be a name but isn't clear
 *
 * Default: "Unknown (SMS)" when no name can be confidently extracted
 */

/**
 * ACCEPTANCE CRITERIA: Valid Address
 * -----------------------------------
 * A "complete" address has ALL of:
 * - Street number (digits at start, e.g., "1234")
 * - Street name (one or more words)
 * - Street type suffix (Street, Ave, Rd, etc.)
 *
 * A "partial" address has SOME of:
 * - Street name only (e.g., "Oak Avenue")
 * - Street name + type but no number (e.g., "Main Street")
 *
 * "Not provided" is returned when:
 * - No address-like text found
 * - LLM explicitly returns null
 * - Regex patterns find no match
 */

/**
 * Check if an address is "complete" (has street number)
 * Complete: "1234 Main Street" → true
 * Partial: "Main Street", "Oak Ave" → false
 */
function isAddressComplete(address: string): boolean {
  if (!address || address === "Not provided") return false;
  // Must start with digits (street number)
  return /^\d+\s+/.test(address.trim());
}

/**
 * Determine completeness level based on extraction results
 */
function determineCompleteness(
  nameSource: "llm" | "regex" | "default",
  addressSource: "llm" | "regex" | "default",
  addressIsComplete: boolean
): SmsCompleteness {
  const hasName = nameSource !== "default";
  const hasAddress = addressSource !== "default";

  if (hasName && hasAddress && addressIsComplete) {
    return "complete";
  }
  if (hasName || hasAddress) {
    return "partial";
  }
  return "minimal";
}

// System prompt for SMS field extraction (minimal, single-pass)
const SMS_EXTRACTION_PROMPT = `You are extracting structured fields from a citizen SMS message.

Extract ONLY if clearly stated. Do not guess or infer.

Respond with JSON only (no markdown):
{
  "name": "extracted name or null",
  "address": "extracted street address or null"
}

Rules:
- name: Full name if explicitly provided (e.g., "John Smith", "Maria Garcia")
- address: Street address with number and street name (e.g., "1234 Main Street")
- Return null for any field not clearly stated
- Do not extract city/state unless part of a street address
- Do not extract phone numbers as names`;

/**
 * Extract name and address from SMS using LLM (single pass)
 * Returns null values if extraction fails or times out
 */
async function extractSmsFieldsWithLLM(smsBody: string): Promise<{ name: string | null; address: string | null } | null> {
  const client = getSmsOpenAIClient();
  if (!client) {
    console.log("[sms-extract] OpenAI client not available, skipping LLM extraction");
    return null;
  }

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: SMS_EXTRACTION_PROMPT },
        { role: "user", content: smsBody },
      ],
      temperature: 0,
      max_tokens: 100,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      console.log("[sms-extract] Empty response from OpenAI");
      return null;
    }

    const parsed = JSON.parse(content) as { name?: string | null; address?: string | null };
    console.log("[sms-extract] LLM extraction result:", parsed);

    return {
      name: parsed.name || null,
      address: parsed.address || null,
    };
  } catch (error) {
    console.error("[sms-extract] LLM extraction error:", error);
    return null;
  }
}

/**
 * Extract name from SMS using regex patterns (fallback)
 * Reuses patterns from Voice extraction
 */
function extractSmsNameWithRegex(smsBody: string): string | null {
  const result = extractNameFromText(smsBody);
  if (result.name) {
    console.log("[sms-extract] Regex name extraction:", result.name, "| pattern:", result.pattern);
    return result.name;
  }
  return null;
}

/**
 * Extract address from SMS using regex patterns (fallback)
 * Reuses patterns from Voice extraction + applies normalization
 */
function extractSmsAddressWithRegex(smsBody: string): string | null {
  const result = extractAddressFromText(smsBody);
  if (result.address) {
    // Apply spoken number normalization (e.g., "eleven twenty two" → "1122")
    const normalized = normalizeSpokenAddress(result.address);
    console.log("[sms-extract] Regex address extraction:", normalized, "| pattern:", result.pattern);
    return normalized;
  }
  return null;
}

/**
 * Extract name and address from SMS body
 * Single-pass AI extraction with deterministic regex fallback
 *
 * Phase 1 behavior:
 * - Attempts LLM extraction (3 second timeout)
 * - Falls back to regex patterns
 * - Returns defaults if extraction fails
 * - Does NOT ask follow-up questions
 */
export async function extractSmsFields(smsBody: string): Promise<SmsExtractionResult> {
  console.log("[sms-extract] ====== SMS EXTRACTION START ======");
  console.log("[sms-extract] SMS body length:", smsBody.length);
  console.log("[sms-extract] SMS body preview:", smsBody.substring(0, 100));

  let name: string = "Unknown (SMS)";
  let address: string = "Not provided";
  let nameSource: "llm" | "regex" | "default" = "default";
  let addressSource: "llm" | "regex" | "default" = "default";

  // Step 1: Try LLM extraction with 3 second timeout
  try {
    const timeoutPromise = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), 3000);
    });

    const llmResult = await Promise.race([
      extractSmsFieldsWithLLM(smsBody),
      timeoutPromise,
    ]);

    if (llmResult) {
      if (llmResult.name && llmResult.name.trim().length > 0) {
        name = llmResult.name.trim();
        nameSource = "llm";
        console.log("[sms-extract] LLM name accepted:", name);
      }
      if (llmResult.address && llmResult.address.trim().length > 0) {
        // Apply spoken number normalization to LLM-extracted addresses too
        address = normalizeSpokenAddress(llmResult.address.trim());
        addressSource = "llm";
        console.log("[sms-extract] LLM address accepted:", address);
      }
    } else {
      console.log("[sms-extract] LLM extraction timed out or returned null");
    }
  } catch (error) {
    console.error("[sms-extract] LLM extraction failed:", error);
  }

  // Step 2: Fallback to regex for any field not extracted by LLM
  if (nameSource === "default") {
    const regexName = extractSmsNameWithRegex(smsBody);
    if (regexName) {
      name = regexName;
      nameSource = "regex";
      console.log("[sms-extract] Regex name accepted:", name);
    }
  }

  if (addressSource === "default") {
    const regexAddress = extractSmsAddressWithRegex(smsBody);
    if (regexAddress) {
      address = regexAddress;
      addressSource = "regex";
      console.log("[sms-extract] Regex address accepted:", address);
    }
  }

  // Step 3: Compute completeness
  const addressComplete = isAddressComplete(address);
  const completeness = determineCompleteness(nameSource, addressSource, addressComplete);

  console.log("[sms-extract] ====== SMS EXTRACTION END ======");
  console.log("[sms-extract] FINAL name:", name, "| source:", nameSource);
  console.log("[sms-extract] FINAL address:", address, "| source:", addressSource);
  console.log("[sms-extract] FINAL completeness:", completeness, "| addressIsComplete:", addressComplete);

  return { name, address, nameSource, addressSource, completeness, addressIsComplete: addressComplete };
}
