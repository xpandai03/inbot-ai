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
 * Validation rules:
 * - Reject verb phrases (calling, reporting, looking, etc.)
 * - Reject common non-name phrases
 * - Reject names < 2 chars or > 50 chars
 * - Reject numeric-only values
 * - Reject single common words
 */
export function validateExtractedName(name: string): string | null {
  if (!name || name.trim().length === 0) return null;

  const trimmed = name.trim();

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
  const words = trimmed.toLowerCase().split(/\s+/);
  if (words.length === 1 && IGNORE_WORDS.has(words[0])) {
    console.log(`[validate-name] REJECTED (single ignored word): "${trimmed}"`);
    return null;
  }

  // Single-word check: reject if it's a common English word that's unlikely to be a name
  // This catches transcription errors like "soda", "snow", "about", etc.
  // NOTE: Some words that are common English words ARE valid Spanish names (e.g., "Luz", "Rosa", "Cruz", "Mar")
  // These are handled by the VALID_SPANISH_NAMES set below
  const COMMON_NON_NAME_WORDS = new Set([
    // Common nouns
    "soda", "snow", "water", "phone", "help", "issue", "problem", "street",
    "road", "pothole", "light", "tree", "sign", "garbage", "trash", "car",
    "house", "home", "work", "today", "tomorrow", "morning", "afternoon",
    "evening", "night", "week", "month", "year", "time", "day", "place",
    "thing", "stuff", "matter", "question", "answer", "note", "message",
    // Prepositions/conjunctions/adverbs
    "about", "from", "with", "into", "onto", "over", "under", "before",
    "after", "during", "through", "between", "among", "against", "within",
    // Common verbs (base form)
    "help", "call", "text", "send", "fix", "check", "look", "find", "tell",
    // Food/drink items (often misheard)
    "soda", "coffee", "tea", "food", "pizza", "burger",
    // Weather words - REMOVED "snow" as it could be a surname
    "rain", "wind", "cold", "hot", "warm", "sunny",
    // Question words
    "what", "where", "when", "why", "how", "who", "which",
  ]);

  // Valid Spanish names that might look like common English words
  // These should NOT be rejected even though they appear in word lists
  // Phase 1 Spanish Hardening: Allow legitimate Spanish given names
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
    "mercedes", // Mercies (female name)
    "consuelo", // Consolation (female name)
    "esperanza",// Hope (female name)
    "guadalupe",// Place name (female name)
    "trinidad", // Trinity (female name)
    "santos",   // Saints (male name)
    "reyes",    // Kings (surname)
    "flores",   // Flowers (surname)
  ]);

  // Check if it's a valid Spanish name before rejecting
  if (words.length === 1 && VALID_SPANISH_NAMES.has(words[0])) {
    console.log(`[validate-name] ACCEPTED (valid Spanish name): "${trimmed}"`);
    return trimmed;
  }

  if (words.length === 1 && COMMON_NON_NAME_WORDS.has(words[0])) {
    console.log(`[validate-name] REJECTED (common non-name word): "${trimmed}"`);
    return null;
  }

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

  // All checks passed
  console.log(`[validate-name] ACCEPTED: "${trimmed}"`);
  return trimmed;
}

// Patterns that indicate non-address values
const NON_ADDRESS_PATTERNS = [
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
];

/**
 * Validate extracted address - catches garbage that regex missed
 * Returns null if address is invalid (caller should use default)
 *
 * Validation rules:
 * - Reject vague location descriptions
 * - Reject addresses < 5 chars
 * - Reject values that are clearly not street addresses
 */
export function validateExtractedAddress(address: string): string | null {
  if (!address || address.trim().length === 0) return null;

  const trimmed = address.trim();

  // Length check (minimum reasonable address: "1 A St" = 6 chars)
  if (trimmed.length < 5) {
    console.log(`[validate-address] REJECTED (too short): "${trimmed}"`);
    return null;
  }

  // Non-address pattern check
  for (const pattern of NON_ADDRESS_PATTERNS) {
    if (pattern.test(trimmed)) {
      console.log(`[validate-address] REJECTED (non-address): "${trimmed}"`);
      return null;
    }
  }

  // All checks passed
  console.log(`[validate-address] ACCEPTED: "${trimmed}"`);
  return trimmed;
}

// Character class for name matching (English + Spanish accented characters)
// Covers: A-Z, a-z, and Latin-1 Supplement accented chars (á é í ó ú ñ Á É Í Ó Ú Ñ etc.)
const NAME_CHAR_CLASS = "[A-Za-z\\u00C0-\\u00FF]";
const NAME_WORD_PATTERN = `${NAME_CHAR_CLASS}${NAME_CHAR_CLASS}*(?:'|-)?${NAME_CHAR_CLASS}*`;

/**
 * Extract caller name from text using multiple patterns
 * Supports English and Spanish name trigger phrases
 * Returns { name, source } for logging
 */
function extractNameFromText(text: string): { name: string | null; pattern: string } {
  if (!text) return { name: null, pattern: "empty" };

  // Pattern 1: Explicit name phrases (highest confidence)
  // Includes both English and Spanish triggers
  const explicitPatterns = [
    // English patterns
    { regex: new RegExp(`(?:my name is|name is)\\s+(${NAME_WORD_PATTERN}(?:\\s+${NAME_WORD_PATTERN}){0,2})`, "i"), name: "my name is" },
    { regex: new RegExp(`(?:i'm|i am)\\s+(${NAME_WORD_PATTERN}(?:\\s+${NAME_WORD_PATTERN}){0,2})`, "i"), name: "i'm" },
    { regex: new RegExp(`(?:this is)\\s+(${NAME_WORD_PATTERN}(?:\\s+${NAME_WORD_PATTERN}){0,2})`, "i"), name: "this is" },
    { regex: new RegExp(`(?:it's|it is)\\s+(${NAME_WORD_PATTERN}(?:\\s+${NAME_WORD_PATTERN}){0,2})`, "i"), name: "it's" },
    { regex: new RegExp(`(?:yeah,?\\s*)?(?:it's|it is)\\s+(${NAME_WORD_PATTERN}(?:\\s+${NAME_WORD_PATTERN}){0,2})`, "i"), name: "yeah it's" },
    // Spanish patterns (Phase 1 Spanish Hardening)
    // "me llamo Juan García" → "Juan García"
    { regex: new RegExp(`(?:me llamo)\\s+(${NAME_WORD_PATTERN}(?:\\s+${NAME_WORD_PATTERN}){0,2})`, "i"), name: "me llamo" },
    // "mi nombre es María" → "María"
    { regex: new RegExp(`(?:mi nombre es)\\s+(${NAME_WORD_PATTERN}(?:\\s+${NAME_WORD_PATTERN}){0,2})`, "i"), name: "mi nombre es" },
    // "soy Carlos Rodríguez" → "Carlos Rodríguez"
    // Note: "soy" can also mean "I am [adjective]" so we validate the captured text
    { regex: new RegExp(`(?:soy)\\s+(${NAME_WORD_PATTERN}(?:\\s+${NAME_WORD_PATTERN}){0,2})`, "i"), name: "soy" },
    // "habla Juan" / "le habla María" → extract name after "habla"
    { regex: new RegExp(`(?:le\\s+)?habla\\s+(${NAME_WORD_PATTERN}(?:\\s+${NAME_WORD_PATTERN}){0,2})`, "i"), name: "habla" },
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

  // Pattern 2: Bare name anywhere in text (e.g., "Customer: Johnny Snow. Agent:...")
  // Look for 1-3 capitalized words followed by a period or sentence break
  // Use word boundary to avoid matching mid-sentence
  // Supports accented characters for Spanish names (e.g., "García", "Rodríguez")
  const UPPER_CHAR = "[A-Z\\u00C0-\\u00D6\\u00D8-\\u00DE]"; // Uppercase + accented uppercase
  const LOWER_CHAR = "[a-z\\u00DF-\\u00F6\\u00F8-\\u00FF]"; // Lowercase + accented lowercase
  const bareNamePatterns = [
    // After "Customer:" or similar speaker labels (English + Spanish)
    new RegExp(`(?:Customer|Caller|User|Speaker|Cliente|Usuario):\\s*(${UPPER_CHAR}${LOWER_CHAR}+(?:\\s+${UPPER_CHAR}${LOWER_CHAR}+){0,2})[.,]`),
    // At start of text
    new RegExp(`^(${UPPER_CHAR}${LOWER_CHAR}+(?:\\s+${UPPER_CHAR}${LOWER_CHAR}+){0,2})[.,]`),
    // After newline or double space
    new RegExp(`(?:\\n|  )(${UPPER_CHAR}${LOWER_CHAR}+(?:\\s+${UPPER_CHAR}${LOWER_CHAR}+){0,2})[.,]`),
  ];

  for (const pattern of bareNamePatterns) {
    const bareNameMatch = text.match(pattern);
    if (bareNameMatch && bareNameMatch[1]) {
      const words = bareNameMatch[1].split(/\s+/).filter(isValidNameWord);
      if (words.length >= 1 && words.length <= 3) {
        return { name: words.join(" "), pattern: "bare name" };
      }
    }
  }

  return { name: null, pattern: "no match" };
}

/**
 * Extract caller name from transcript (two-pass)
 * Pass A: artifact.messages (structured)
 * Pass B: transcript string (fallback)
 *
 * Applies post-extraction validation to catch garbage values
 */
export function extractName(messages: VapiMessage[], transcript?: string): { name: string; source: string } {
  // Pass A: Try artifact.messages
  const userMessages = messages.filter(m => m.role === "user");
  for (const msg of userMessages) {
    const result = extractNameFromText(msg.message);
    if (result.name) {
      // Validate before returning - reject garbage values
      const validated = validateExtractedName(result.name);
      if (validated) {
        return { name: validated, source: `messages/${result.pattern}` };
      }
      // Validation failed - continue searching
      console.log(`[extractName] Regex matched "${result.name}" but validation rejected it`);
    }
  }

  // Pass B: Try transcript string
  if (transcript) {
    const result = extractNameFromText(transcript);
    if (result.name) {
      // Validate before returning - reject garbage values
      const validated = validateExtractedName(result.name);
      if (validated) {
        return { name: validated, source: `transcript/${result.pattern}` };
      }
      // Validation failed - fall through to default
      console.log(`[extractName] Regex matched "${result.name}" but validation rejected it`);
    }
  }

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
const STREET_KEYWORDS = new Set([
  // English street types
  "street", "st", "avenue", "ave", "drive", "dr", "road", "rd",
  "boulevard", "blvd", "lane", "ln", "way", "court", "ct",
  "place", "pl", "circle", "cir", "terrace", "ter", "trail", "trl",
  "parkway", "pkwy", "highway", "hwy",
  // Spanish street types
  "calle", "avenida", "av", "pasaje", "camino", "carretera", "plaza",
  "callejón", "callejon", "paseo", "bulevar", "autopista", "vereda", "sendero",
  // English common street name words
  "main", "oak", "maple", "elm", "pine", "cedar", "first", "second",
  "third", "fourth", "fifth", "north", "south", "east", "west",
  // Spanish common street name words
  "norte", "sur", "este", "oeste", "principal", "central", "mayor",
  "primero", "primera", "segundo", "segunda", "tercero", "tercera",
]);

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
 *
 * Examples:
 *   "Eleven twenty two Main Street" → "1122 Main Street"
 *   "five four eight four Main Street" → "5484 Main Street"
 *   "fifty four eighty four Oak Drive" → "5484 Oak Drive"
 *   "nine oh five Pine Lane" → "905 Pine Lane"
 */
export function normalizeSpokenAddress(input: string): string {
  if (!input) return input;

  const words = input.split(/\s+/);
  const numberWords: string[] = [];
  const restWords: string[] = [];
  let foundStreetWord = false;

  // Collect leading number words until we hit a street keyword or non-number word
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const lower = word.toLowerCase().replace(/[.,!?]/g, "");

    if (foundStreetWord || STREET_KEYWORDS.has(lower)) {
      foundStreetWord = true;
      restWords.push(word);
    } else if (isNumberWord(lower)) {
      numberWords.push(lower);
    } else {
      // Non-number word that's not a street keyword - start of street name
      restWords.push(word);
      foundStreetWord = true;
    }
  }

  // If no number words found, return original
  if (numberWords.length === 0) {
    return input;
  }

  // Parse the number words
  const parsedNumber = parseSpokenNumber(numberWords);

  if (parsedNumber === null) {
    return input;
  }

  // Reconstruct the address
  const normalizedAddress = [parsedNumber.toString(), ...restWords].join(" ");

  console.log(`[normalize] "${input}" → "${normalizedAddress}"`);

  return normalizedAddress;
}

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
  // Phase 1 Spanish Hardening: Added Spanish address prefix patterns
  const prefixPatterns = [
    // English prefixes with street number
    /(?:address is|my address is|i(?:'m| am) at|i live at|located at)\s+(\d{1,6}\s+[\w\s]+(?:Street|St|Avenue|Ave|Drive|Dr|Road|Rd|Boulevard|Blvd|Lane|Ln|Way|Court|Ct|Place|Pl|Circle|Cir))/i,
    // English prefixes without street number
    /(?:address is|my address is|i(?:'m| am) at|i live at|located at)\s+([\w\s]+(?:Street|St|Avenue|Ave|Drive|Dr|Road|Rd|Boulevard|Blvd|Lane|Ln|Way|Court|Ct|Place|Pl|Circle|Cir))/i,
    // Spanish prefixes: "vivo en la Calle 5 de Marzo 123" or "mi dirección es Avenida Central 456"
    // Captures: Calle/Avenida + name + optional number
    /(?:vivo en(?: la| el)?|mi direcci[oó]n es|estoy en(?: la| el)?|queda en(?: la| el)?)\s+((?:Calle|Avenida|Av|Pasaje|Camino|Carretera|Plaza|Callej[oó]n|Paseo|Bulevar)\s+[\w\s]+?\s*\d{1,6})/i,
    // Spanish: number first "vivo en el 123 de la Calle Main"
    /(?:vivo en(?: la| el)?|mi direcci[oó]n es|estoy en(?: la| el)?)\s+(?:el\s+)?(\d{1,6}\s+(?:de\s+la\s+)?(?:Calle|Avenida|Av|Pasaje|Camino|Carretera|Plaza)\s+[\w\s]+)/i,
    // Spanish: "en la calle Oak" without number (lower confidence)
    /(?:en la|en el)\s+((?:Calle|Avenida|Av|Pasaje|Camino)\s+[\w\s]+)/i,
  ];

  for (const pattern of prefixPatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return { address: match[1].replace(/[.,!?]$/, "").trim(), pattern: "prefix" };
    }
  }

  // Pattern 4: Any text ending in a street type (less confident)
  // Supports accented characters for Spanish street names
  const anyStreetPattern = new RegExp(
    `([A-Za-z0-9\\u00C0-\\u00FF][A-Za-z0-9\\u00C0-\\u00FF\\s'-]{3,40}\\s+(?:${STREET_TYPES}))(?:[.,\\s]|$)`,
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
  // Pass A: Try artifact.messages
  const userMessages = messages.filter(m => m.role === "user");
  for (const msg of userMessages) {
    const result = extractAddressFromText(msg.message);
    if (result.address) {
      // Normalize spoken numbers → digits
      const normalized = normalizeSpokenAddress(result.address);
      // Validate before returning - reject garbage values
      const validated = validateExtractedAddress(normalized);
      if (validated) {
        return { address: validated, source: `messages/${result.pattern}` };
      }
      // Validation failed - continue searching
      console.log(`[extractAddress] Regex matched "${result.address}" but validation rejected it`);
    }
  }

  // Pass B: Try transcript string
  if (transcript) {
    const result = extractAddressFromText(transcript);
    if (result.address) {
      // Normalize spoken numbers → digits
      const normalized = normalizeSpokenAddress(result.address);
      // Validate before returning - reject garbage values
      const validated = validateExtractedAddress(normalized);
      if (validated) {
        return { address: validated, source: `transcript/${result.pattern}` };
      }
      // Validation failed - fall through to default
      console.log(`[extractAddress] Regex matched "${result.address}" but validation rejected it`);
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
 */
export function transformVapiToIntakeRecord(payload: VapiWebhookPayload): PartialIntakeRecord & { rawText: string } {
  const msg = payload.message;
  const rawMessages = msg.artifact?.messages || [];
  const rawTranscript = msg.transcript || "";

  console.log("[vapi-transform] ====== EXTRACTION START ======");
  console.log("[vapi-transform] artifact.messages count:", rawMessages.length);
  console.log("[vapi-transform] transcript length:", rawTranscript.length);
  console.log("[vapi-transform] transcript preview:", rawTranscript.substring(0, 200));

  // Clean messages and transcript for better extraction (Fix 4)
  const messages = cleanMessagesForExtraction(rawMessages);
  const transcript = cleanTranscriptForExtraction(rawTranscript);

  // Extract name with two-pass strategy (uses cleaned input)
  const nameResult = extractName(messages, transcript);
  console.log("[vapi-transform] NAME extracted:", nameResult.name, "| source:", nameResult.source);

  // Extract address with two-pass strategy (uses cleaned input)
  const addressResult = extractAddress(messages, transcript);
  console.log("[vapi-transform] ADDRESS extracted:", addressResult.address, "| source:", addressResult.source);

  // Detect language (uses RAW messages - LLM handles filler words fine)
  const language = detectLanguage(rawMessages);

  // Build raw text from multiple sources (uses RAW - for LLM classification)
  // We want original text for classification, not cleaned text
  let rawIssueText = buildRawIssueText(rawMessages);
  if (!rawIssueText || rawIssueText === "No issue description provided") {
    rawIssueText = rawTranscript;
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
