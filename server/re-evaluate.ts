/**
 * Re-Evaluation Engine
 *
 * Runs the extraction/classification pipeline against a stored raw transcript.
 * Produces a candidate evaluation that must be explicitly approved.
 */

import { classifyIntake } from "./intake-classifier";
import {
  extractName,
  extractAddress,
  extractSmsFields,
  cleanTranscriptForExtraction,
  cleanMessagesForExtraction,
  type VapiMessage,
} from "./vapi-transform";
import type { IntakeRecordDetail, EvaluationEntry } from "@shared/schema";

export interface ReEvaluationInput {
  rawTranscript: string;
  channel: "Voice" | "SMS";
  clientId: string;
  /** When present, re-eval uses same Pass A/B/C as first-pass (last-confirmed-wins). */
  artifactMessages?: VapiMessage[];
  /** Current address on record (for tryHarder decision). */
  currentAddress?: string;
  /** Current name on record (for upgrade decision). */
  currentName?: string;
}

export interface ReEvaluationOutput {
  candidateName: string;
  candidateAddress: string;
  candidateIntent: string;
  candidateDepartment: string;
  candidateSummary: string;
  extractionMeta: {
    nameSource: string;
    addressSource: string;
    classifierMethod: "llm" | "regex";
    reEvaluatedAt: string;
    [key: string]: unknown;
  };
}

/**
 * Run re-evaluation on a stored transcript.
 * For SMS: uses extractSmsFields + classifyIntake
 * For Voice: uses cleanTranscript + extractAddress + extractName + classifyIntake
 */
export async function reEvaluate(input: ReEvaluationInput): Promise<ReEvaluationOutput> {
  console.log(`[re-evaluate] Starting re-evaluation for ${input.channel} channel`);

  if (input.channel === "SMS") {
    return reEvaluateSms(input);
  }

  return reEvaluateVoice(input);
}

async function reEvaluateSms(input: ReEvaluationInput): Promise<ReEvaluationOutput> {
  // Step 1: Extract SMS fields
  const extraction = await extractSmsFields(input.rawTranscript);

  // Step 2: Classify
  const classification = await classifyIntake({
    rawText: input.rawTranscript,
    channel: "SMS",
    clientId: input.clientId,
  });

  return {
    candidateName: extraction.name,
    candidateAddress: extraction.address,
    candidateIntent: classification.intent,
    candidateDepartment: classification.department,
    candidateSummary: classification.summary,
    extractionMeta: {
      nameSource: extraction.nameSource,
      addressSource: extraction.addressSource,
      classifierMethod: classification.method,
      completeness: extraction.completeness,
      addressIsComplete: extraction.addressIsComplete,
      reEvaluatedAt: new Date().toISOString(),
    },
  };
}

async function reEvaluateVoice(input: ReEvaluationInput): Promise<ReEvaluationOutput> {
  // Step 1: Clean transcript for extraction
  const cleanedTranscript = cleanTranscriptForExtraction(input.rawTranscript);
  console.log(`[re-evaluate] Voice: transcript length=${input.rawTranscript.length}, cleaned=${cleanedTranscript.length}`);

  // RULE 5: Re-evaluation is a RECOVERY path — no quality gates, no conservative skips.
  // Always use the full extraction surface (artifact messages + transcript).
  const messages: VapiMessage[] = Array.isArray(input.artifactMessages) && input.artifactMessages.length > 0
    ? cleanMessagesForExtraction(input.artifactMessages as VapiMessage[])
    : [];
  console.log(`[re-evaluate] Voice: messages=${messages.length} (Pass A/B when > 0, else transcript-only)`);

  // RULE 4: Re-evaluation ALWAYS tries harder than first-pass.
  // Always use relaxed validation — re-eval must upgrade bad records aggressively.
  const tryHarder = true;
  const currentAddr = (input.currentAddress || "").trim();
  const currentName = (input.currentName || "").trim();
  console.log(`[re-evaluate] Voice: tryHarder=ALWAYS (re-eval recovery path), current address="${currentAddr}", current name="${currentName}"`);

  // Step 2: Extract address (RULE 1+2: bot confirmation authoritative, last mention wins)
  const { address, source: addressSource } = extractAddress(messages, cleanedTranscript, { tryHarder });
  console.log(`[re-evaluate] Voice: address="${address}" source="${addressSource}"`);

  // Step 3: Extract name (same message/transcript surface as address)
  const { name, source: nameSource } = extractName(messages, cleanedTranscript, address);
  console.log(`[re-evaluate] Voice: name="${name}" source="${nameSource}"`);

  // RULE 4: Log when re-eval is upgrading a record
  const nameUpgraded = (currentName === "" || currentName === "Unknown Caller" || currentName === "Not provided") && name !== "Unknown Caller";
  const addrUpgraded = (currentAddr === "" || currentAddr === "Not provided" || currentAddr.includes("(Approximate)")) && address !== "Not provided";
  if (nameUpgraded) {
    console.log(`[re-evaluate] UPGRADE: name "${currentName || '(empty)'}" → "${name}"`);
  }
  if (addrUpgraded) {
    console.log(`[re-evaluate] UPGRADE: address "${currentAddr || '(empty)'}" → "${address}"`);
  }

  // Step 4: Classify (uses raw transcript, same text as initial pipeline now uses)
  const classificationText = input.rawTranscript;
  console.log(`[re-evaluate] Voice: classification text preview: "${classificationText.substring(0, 300)}${classificationText.length > 300 ? '...' : ''}"`);
  const classification = await classifyIntake({
    rawText: classificationText,
    channel: "Voice",
    clientId: input.clientId,
  });
  console.log(`[re-evaluate] Voice: classified intent="${classification.intent}" dept="${classification.department}" method="${classification.method}"`);

  return {
    candidateName: name,
    candidateAddress: address,
    candidateIntent: classification.intent,
    candidateDepartment: classification.department,
    candidateSummary: classification.summary,
    extractionMeta: {
      nameSource,
      addressSource,
      classifierMethod: classification.method,
      reEvaluatedAt: new Date().toISOString(),
    },
  };
}

/**
 * Compute diff between current record and candidate evaluation.
 * Returns an object with each field's current value, candidate value, and whether it changed.
 */
export interface DiffField {
  current: string;
  candidate: string;
  changed: boolean;
}

export interface DiffResult {
  name: DiffField;
  address: DiffField;
  intent: DiffField;
  department: DiffField;
  summary: DiffField;
}

export function computeDiff(
  current: IntakeRecordDetail,
  candidate: Partial<Pick<EvaluationEntry, "candidateName" | "candidateAddress" | "candidateIntent" | "candidateDepartment" | "candidateSummary">>
): DiffResult {
  const diff = (currentVal: string, candidateVal: string | null | undefined): DiffField => ({
    current: currentVal,
    candidate: candidateVal ?? currentVal,
    changed: candidateVal != null && candidateVal !== currentVal,
  });

  return {
    name: diff(current.name, candidate.candidateName),
    address: diff(current.address, candidate.candidateAddress),
    intent: diff(current.intent, candidate.candidateIntent),
    department: diff(current.department, candidate.candidateDepartment),
    summary: diff(current.transcriptSummary, candidate.candidateSummary),
  };
}
