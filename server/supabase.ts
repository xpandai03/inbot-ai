import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { IntakeRecord, InsertIntakeRecord } from "@shared/schema";

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

// Transform App type -> DB insert
export function intakeRecordToDB(
  record: InsertIntakeRecord
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
