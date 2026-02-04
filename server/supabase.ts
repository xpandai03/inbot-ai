import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { IntakeRecord, InsertIntakeRecord, IntakeRecordDetail, EvaluationEntry } from "@shared/schema";

// Database row type (matches Supabase interactions table schema)
export interface DBInteraction {
  id: string;
  client_id: string;
  channel: "voice" | "sms";
  name: string;
  phone: string;
  address: string | null;
  raw_issue_text: string | null;
  issue_summary: string | null;
  department: string | null;
  language: string;
  duration_seconds: number;
  cost_estimate: number;
  created_at: string;
  // Re-evaluation fields (added 2026-02-03)
  raw_transcript: string | null;
  recording_url: string | null;
  stereo_recording_url: string | null;
  call_metadata: Record<string, unknown> | null;
  updated_at: string | null;
}

// Database row type for evaluation_history table
export interface DBEvaluationHistory {
  id: string;
  interaction_id: string;
  evaluation_type: "initial" | "re-evaluation";
  candidate_name: string | null;
  candidate_address: string | null;
  candidate_intent: string | null;
  candidate_department: string | null;
  candidate_summary: string | null;
  extraction_meta: Record<string, unknown>;
  status: "candidate" | "applied" | "superseded";
  applied_at: string | null;
  applied_by: string | null;
  created_at: string;
}

// Transform DB row -> App type
export function dbToIntakeRecord(row: DBInteraction): IntakeRecord {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    address: row.address ?? "",
    intent: row.raw_issue_text ?? "",
    department: row.department ?? "",
    channel: row.channel === "voice" ? "Voice" : "SMS",
    language: row.language,
    durationSeconds: row.duration_seconds,
    cost: Number(row.cost_estimate),
    timestamp: row.created_at,
    transcriptSummary: row.issue_summary ?? "",
    clientId: row.client_id,
  };
}

// Transform DB row -> App detail type (includes transcript/recording fields)
export function dbToIntakeRecordDetail(row: DBInteraction): IntakeRecordDetail {
  return {
    ...dbToIntakeRecord(row),
    rawTranscript: row.raw_transcript ?? null,
    recordingUrl: row.recording_url ?? null,
    stereoRecordingUrl: row.stereo_recording_url ?? null,
    callMetadata: row.call_metadata ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

// Transform DB evaluation_history row -> App type
export function dbToEvaluationEntry(row: DBEvaluationHistory): EvaluationEntry {
  return {
    id: row.id,
    interactionId: row.interaction_id,
    evaluationType: row.evaluation_type,
    candidateName: row.candidate_name,
    candidateAddress: row.candidate_address,
    candidateIntent: row.candidate_intent,
    candidateDepartment: row.candidate_department,
    candidateSummary: row.candidate_summary,
    extractionMeta: row.extraction_meta,
    status: row.status,
    appliedAt: row.applied_at,
    appliedBy: row.applied_by,
    createdAt: row.created_at,
  };
}

// Transform App type -> DB insert
export function intakeRecordToDB(
  record: InsertIntakeRecord,
  meta?: {
    rawTranscript?: string;
    recordingUrl?: string;
    stereoRecordingUrl?: string;
    callMetadata?: Record<string, unknown>;
  }
): Omit<DBInteraction, "id"> {
  return {
    client_id: record.clientId,
    channel: record.channel === "Voice" ? "voice" : "sms",
    name: record.name,
    phone: record.phone,
    address: record.address,
    raw_issue_text: record.intent,
    issue_summary: record.transcriptSummary,
    department: record.department,
    language: record.language,
    duration_seconds: record.durationSeconds,
    cost_estimate: record.cost,
    created_at: record.timestamp,
    raw_transcript: meta?.rawTranscript ?? null,
    recording_url: meta?.recordingUrl ?? null,
    stereo_recording_url: meta?.stereoRecordingUrl ?? null,
    call_metadata: meta?.callMetadata ?? null,
    updated_at: null,
  };
}

// Singleton Supabase client
let supabaseClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!supabaseClient) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!url || !key) {
      throw new Error(
        "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables"
      );
    }

    supabaseClient = createClient(url, key, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return supabaseClient;
}
