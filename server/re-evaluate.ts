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
  /** When address is missing/partial, re-eval tries harder (relaxed validation). */
  currentAddress?: string;
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

  // CLEAR: Use stored artifact messages when available (same Pass A/B/C as first-pass, last-confirmed-wins)
  const messages: VapiMessage[] = Array.isArray(input.artifactMessages) && input.artifactMessages.length > 0
    ? cleanMessagesForExtraction(input.artifactMessages as VapiMessage[])
    : [];
  console.log(`[re-evaluate] Voice: messages=${messages.length} (Pass A/B when > 0, else transcript-only)`);

  // Try harder when current record is bad: missing or partial address
  const currentAddr = (input.currentAddress || "").trim();
  const tryHarder = currentAddr === "" ||
    currentAddr === "Not provided" ||
    currentAddr.includes("(Approximate)");
  if (tryHarder) {
    console.log(`[re-evaluate] Voice: tryHarder=true (current address missing or partial)`);
  }

  // Step 2: Extract address (same passes as first-pass when messages present)
  const { address, source: addressSource } = extractAddress(messages, cleanedTranscript, { tryHarder });
  console.log(`[re-evaluate] Voice: address="${address}" source="${addressSource}"`);

  // Step 3: Extract name (same message/transcript surface as address)
  const { name, source: nameSource } = extractName(messages, cleanedTranscript, address);
  console.log(`[re-evaluate] Voice: name="${name}" source="${nameSource}"`);

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
