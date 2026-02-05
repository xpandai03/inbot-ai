/**
 * Address Quality Derivation
 *
 * Pure functions to derive address_quality and needs_review flags
 * from record data. Computed at record creation and evaluation apply.
 * Never re-derived in the UI — the persisted values are authoritative.
 */

import type { AddressQuality } from "@shared/schema";

/**
 * Derive address quality from the address string.
 *
 * Rules:
 *   missing      → null, empty, or "Not provided"
 *   intersection → contains " & " (cross-street pattern)
 *   approximate  → contains "(Approximate)" but not " & "
 *   complete     → starts with digit(s) and has at least one non-digit word
 *   partial      → everything else (has content but fails complete check)
 */
export function deriveAddressQuality(address: string | null | undefined): AddressQuality {
  if (!address || address.trim() === "" || address === "Not provided") {
    return "missing";
  }

  const trimmed = address.trim();

  // Intersection: cross-street pattern (contains " & ")
  if (trimmed.includes(" & ")) {
    return "intersection";
  }

  // Approximate: contextual/vague location
  if (trimmed.includes("(Approximate)")) {
    return "approximate";
  }

  // Complete: starts with digit(s) and has at least one non-digit word after
  const words = trimmed.split(/\s+/);
  if (words.length >= 2 && /^\d+$/.test(words[0])) {
    return "complete";
  }

  // Everything else is partial (street name only, no number, etc.)
  return "partial";
}

/**
 * Derive whether a record needs human review.
 *
 * Triggers (any true → needs_review = true):
 *   - addressQuality is "missing" or "approximate"
 *   - name is missing or default
 *   - Voice call ended abnormally
 *   - Voice call analysis failed
 *
 * Does NOT trigger for:
 *   - "complete", "partial", or "intersection" addresses
 *   - SMS channel (guided flow always captures structured data)
 *   - Normal call endings
 */
export interface NeedsReviewInput {
  addressQuality: AddressQuality;
  name: string;
  channel: "Voice" | "SMS";
  callMetadata?: Record<string, unknown> | null;
}

const NORMAL_ENDINGS = new Set([
  "customer-ended-call",
  "assistant-ended-call",
  "silence-timed-out",
  "customer-did-not-give-microphone-permission",
  "assistant-said-end-call-phrase",
]);

export function deriveNeedsReview(input: NeedsReviewInput): boolean {
  // Address missing or approximate
  if (input.addressQuality === "missing" || input.addressQuality === "approximate") {
    return true;
  }

  // Name missing
  if (!input.name || input.name === "Not provided" || input.name === "Unknown Caller" || input.name.trim() === "") {
    return true;
  }

  // Voice channel: check call metadata for abnormal ending or failed analysis
  if (input.channel === "Voice" && input.callMetadata) {
    const endedReason = input.callMetadata.endedReason as string | undefined;
    if (endedReason && !NORMAL_ENDINGS.has(endedReason)) {
      return true;
    }

    if (input.callMetadata.analysisSuccess === false) {
      return true;
    }
  }

  return false;
}
