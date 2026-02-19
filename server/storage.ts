import type {
  IntakeRecord,
  InsertIntakeRecord,
  DashboardStats,
  Client,
  DepartmentEmail,
  IntakeRecordDetail,
  EvaluationEntry,
  InsertEvaluationEntry,
} from "@shared/schema";
import { randomUUID } from "crypto";
import {
  getSupabaseClient,
  dbToIntakeRecord,
  dbToIntakeRecordDetail,
  dbToEvaluationEntry,
  intakeRecordToDB,
  type DBInteraction,
  type DBEvaluationHistory,
} from "./supabase";
import { deriveAddressQuality, deriveNeedsReview } from "./address-quality";

export interface DepartmentEmailConfig {
  email: string;
  cc_email: string | null;
}

export interface TranscriptMeta {
  rawTranscript?: string;
  recordingUrl?: string;
  stereoRecordingUrl?: string;
  callMetadata?: Record<string, unknown>;
}

export interface IStorage {
  getRecords(clientId?: string): Promise<IntakeRecord[]>;
  getRecord(id: string): Promise<IntakeRecord | undefined>;
  createRecord(record: InsertIntakeRecord, meta?: TranscriptMeta): Promise<IntakeRecord>;
  updateRecord(id: string, updates: Partial<InsertIntakeRecord>): Promise<IntakeRecord | undefined>;
  deleteRecord(id: string, clientId?: string): Promise<boolean>;
  getStats(clientId?: string): Promise<DashboardStats>;
  getClients(): Promise<Client[]>;
  // Email routing methods
  getDepartmentEmail(clientId: string, department: string): Promise<DepartmentEmailConfig | null>;
  logEmailSend(
    interactionId: string,
    department: string,
    recipientEmail: string,
    ccEmail: string | null,
    status: "sent" | "failed",
    errorMessage?: string
  ): Promise<void>;
  // Department email CRUD methods
  listDepartmentEmails(clientId: string): Promise<DepartmentEmail[]>;
  createDepartmentEmail(clientId: string, department: string, email: string, ccEmail?: string | null): Promise<DepartmentEmail>;
  updateDepartmentEmail(id: string, clientId: string, email: string, ccEmail?: string | null): Promise<DepartmentEmail | null>;
  deleteDepartmentEmail(id: string, clientId: string): Promise<boolean>;
  // Re-evaluation methods
  getRecordDetail(id: string): Promise<IntakeRecordDetail | undefined>;
  createEvaluationEntry(entry: InsertEvaluationEntry): Promise<EvaluationEntry>;
  getEvaluationHistory(interactionId: string): Promise<EvaluationEntry[]>;
  applyEvaluation(evaluationId: string, interactionId: string, appliedBy: string): Promise<{ record: IntakeRecord; evaluation: EvaluationEntry }>;
}

const clients: Client[] = [
  { id: "client_demo", name: "Demo Client" },
  { id: "city-springfield", name: "City of Springfield" },
  { id: "county-health", name: "County Health Dept" },
  { id: "metro-transit", name: "Metro Transit Authority" },
];

const seedRecords: IntakeRecord[] = [
  {
    id: randomUUID(),
    name: "Margaret Chen",
    phone: "(555) 123-4567",
    address: "1247 Oak Street, Springfield, IL 62701",
    intent: "Pothole Report",
    department: "Public Works",
    channel: "Voice",
    language: "English",
    durationSeconds: 187,
    cost: 0.42,
    timestamp: "2026-01-08T09:23:00Z",
    transcriptSummary: "Caller reported a large pothole on Oak Street near the intersection with Main. Requested repair within the week.",
    clientId: "city-springfield",
    addressQuality: "complete",
    needsReview: false,
  },
  {
    id: randomUUID(),
    name: "Robert Williams",
    phone: "(555) 234-5678",
    address: "892 Maple Avenue, Springfield, IL 62702",
    intent: "Trash Pickup",
    department: "Sanitation",
    channel: "SMS",
    language: "English",
    durationSeconds: 45,
    cost: 0.08,
    timestamp: "2026-01-08T10:15:00Z",
    transcriptSummary: "Resident inquired about missed trash collection on Monday. Scheduled for next-day pickup.",
    clientId: "city-springfield",
    addressQuality: "complete",
    needsReview: false,
  },
  {
    id: randomUUID(),
    name: "Elena Rodriguez",
    phone: "(555) 345-6789",
    address: "456 Pine Road, Springfield, IL 62703",
    intent: "Water Bill Inquiry",
    department: "Utilities",
    channel: "Voice",
    language: "Spanish",
    durationSeconds: 234,
    cost: 0.53,
    timestamp: "2026-01-08T11:42:00Z",
    transcriptSummary: "Caller had questions about recent water bill increase. Explained seasonal rate adjustment and payment options.",
    clientId: "city-springfield",
    addressQuality: "complete",
    needsReview: false,
  },
  {
    id: randomUUID(),
    name: "James Thompson",
    phone: "(555) 456-7890",
    address: "2103 Birch Lane, Springfield, IL 62704",
    intent: "Street Light Outage",
    department: "Public Works",
    channel: "Voice",
    language: "English",
    durationSeconds: 156,
    cost: 0.35,
    timestamp: "2026-01-08T13:08:00Z",
    transcriptSummary: "Reported non-functioning street light at corner of Birch Lane and 5th Street. Work order created.",
    clientId: "city-springfield",
    addressQuality: "complete",
    needsReview: false,
  },
  {
    id: randomUUID(),
    name: "Sarah Kim",
    phone: "(555) 567-8901",
    address: "789 Cedar Court, Springfield, IL 62705",
    intent: "Appointment Request",
    department: "Patient Services",
    channel: "SMS",
    language: "English",
    durationSeconds: 62,
    cost: 0.11,
    timestamp: "2026-01-08T14:30:00Z",
    transcriptSummary: "Patient requested appointment for annual check-up. Scheduled for next Tuesday.",
    clientId: "county-health",
    addressQuality: "complete",
    needsReview: false,
  },
  {
    id: randomUUID(),
    name: "Michael Brown",
    phone: "(555) 678-9012",
    address: "321 Elm Street, Springfield, IL 62706",
    intent: "Vaccination Inquiry",
    department: "Immunization",
    channel: "Voice",
    language: "English",
    durationSeconds: 198,
    cost: 0.45,
    timestamp: "2026-01-08T15:55:00Z",
    transcriptSummary: "Caller inquired about flu shot availability. Scheduled for walk-in clinic tomorrow.",
    clientId: "county-health",
    addressQuality: "complete",
    needsReview: false,
  },
  {
    id: randomUUID(),
    name: "Patricia Davis",
    phone: "(555) 789-0123",
    address: "567 Walnut Drive, Springfield, IL 62707",
    intent: "Route Information",
    department: "Customer Service",
    channel: "SMS",
    language: "English",
    durationSeconds: 38,
    cost: 0.07,
    timestamp: "2026-01-07T16:20:00Z",
    transcriptSummary: "Requested information about bus route 42 schedule changes. Sent updated schedule link.",
    clientId: "metro-transit",
    addressQuality: "complete",
    needsReview: false,
  },
  {
    id: randomUUID(),
    name: "David Martinez",
    phone: "(555) 890-1234",
    address: "1089 Spruce Avenue, Springfield, IL 62708",
    intent: "Lost Item Report",
    department: "Lost & Found",
    channel: "Voice",
    language: "English",
    durationSeconds: 145,
    cost: 0.33,
    timestamp: "2026-01-07T08:45:00Z",
    transcriptSummary: "Caller reported lost backpack on evening train. Created case and provided tracking number.",
    clientId: "metro-transit",
    addressQuality: "complete",
    needsReview: false,
  },
];

export class MemStorage implements IStorage {
  private records: Map<string, IntakeRecord>;

  constructor() {
    this.records = new Map();
    seedRecords.forEach((record) => {
      this.records.set(record.id, record);
    });
  }

  async getRecords(clientId?: string): Promise<IntakeRecord[]> {
    let records = Array.from(this.records.values());
    
    if (clientId && clientId !== "all") {
      records = records.filter((r) => r.clientId === clientId);
    }
    
    return records.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }

  async getRecord(id: string): Promise<IntakeRecord | undefined> {
    return this.records.get(id);
  }

  async createRecord(insertRecord: InsertIntakeRecord): Promise<IntakeRecord> {
    const id = randomUUID();
    const addressQuality = deriveAddressQuality(insertRecord.address);
    const needsReview = deriveNeedsReview({
      addressQuality,
      name: insertRecord.name,
      channel: insertRecord.channel,
    });
    const record: IntakeRecord = { ...insertRecord, id, addressQuality, needsReview };
    this.records.set(id, record);
    return record;
  }

  async updateRecord(id: string, updates: Partial<InsertIntakeRecord>): Promise<IntakeRecord | undefined> {
    const existing = this.records.get(id);
    if (!existing) return undefined;
    const updated = { ...existing, ...updates };
    this.records.set(id, updated);
    return updated;
  }

  async deleteRecord(id: string, _clientId?: string): Promise<boolean> {
    if (!this.records.has(id)) return false;
    this.records.delete(id);
    return true;
  }

  async getStats(clientId?: string): Promise<DashboardStats> {
    let records = Array.from(this.records.values());
    
    if (clientId && clientId !== "all") {
      records = records.filter((r) => r.clientId === clientId);
    }
    
    const today = new Date().toISOString().split("T")[0];
    
    const todayRecords = records.filter(
      (r) => r.timestamp.split("T")[0] === today
    );
    
    const totalMinutesToday = Math.round(
      todayRecords
        .filter((r) => r.channel === "Voice")
        .reduce((acc, r) => acc + r.durationSeconds, 0) / 60
    );

    const totalCost = records.reduce((acc, r) => acc + r.cost, 0);

    return {
      totalRecords: records.length,
      totalMinutesToday,
      totalCost,
    };
  }

  async getClients(): Promise<Client[]> {
    return clients;
  }

  // Stub implementations for MemStorage (email features require Supabase)
  async getDepartmentEmail(_clientId: string, _department: string): Promise<DepartmentEmailConfig | null> {
    console.warn("[MemStorage] getDepartmentEmail not available in memory mode");
    return null;
  }

  async logEmailSend(
    _interactionId: string,
    _department: string,
    _recipientEmail: string,
    _ccEmail: string | null,
    _status: "sent" | "failed",
    _errorMessage?: string
  ): Promise<void> {
    console.warn("[MemStorage] logEmailSend not available in memory mode");
  }

  // Stub implementations for department email CRUD (require Supabase)
  async listDepartmentEmails(_clientId: string): Promise<DepartmentEmail[]> {
    console.warn("[MemStorage] listDepartmentEmails not available in memory mode");
    return [];
  }

  async createDepartmentEmail(_clientId: string, _department: string, _email: string, _ccEmail?: string | null): Promise<DepartmentEmail> {
    console.warn("[MemStorage] createDepartmentEmail not available in memory mode");
    throw new Error("Department email creation not available in memory mode");
  }

  async updateDepartmentEmail(_id: string, _clientId: string, _email: string, _ccEmail?: string | null): Promise<DepartmentEmail | null> {
    console.warn("[MemStorage] updateDepartmentEmail not available in memory mode");
    return null;
  }

  async deleteDepartmentEmail(_id: string, _clientId: string): Promise<boolean> {
    console.warn("[MemStorage] deleteDepartmentEmail not available in memory mode");
    return false;
  }

  // Re-evaluation stubs (require Supabase)
  async getRecordDetail(_id: string): Promise<IntakeRecordDetail | undefined> {
    console.warn("[MemStorage] getRecordDetail not available in memory mode");
    return undefined;
  }

  async createEvaluationEntry(_entry: InsertEvaluationEntry): Promise<EvaluationEntry> {
    console.warn("[MemStorage] createEvaluationEntry not available in memory mode");
    throw new Error("Evaluation entry creation not available in memory mode");
  }

  async getEvaluationHistory(_interactionId: string): Promise<EvaluationEntry[]> {
    console.warn("[MemStorage] getEvaluationHistory not available in memory mode");
    return [];
  }

  async applyEvaluation(_evaluationId: string, _interactionId: string, _appliedBy: string): Promise<{ record: IntakeRecord; evaluation: EvaluationEntry }> {
    console.warn("[MemStorage] applyEvaluation not available in memory mode");
    throw new Error("Apply evaluation not available in memory mode");
  }
}

export class SupabaseStorage implements IStorage {
  private _supabase: ReturnType<typeof getSupabaseClient> | null = null;

  private get supabase() {
    if (!this._supabase) {
      this._supabase = getSupabaseClient();
    }
    return this._supabase;
  }

  async getRecords(clientId?: string): Promise<IntakeRecord[]> {
    let query = this.supabase
      .from("interactions")
      .select("*")
      .order("created_at", { ascending: false });

    if (clientId && clientId !== "all") {
      query = query.eq("client_id", clientId);
    }

    const { data, error } = await query;

    if (error) {
      console.error("[SupabaseStorage.getRecords]", error);
      throw new Error(`Failed to fetch records: ${error.message}`);
    }

    return (data as DBInteraction[]).map(dbToIntakeRecord);
  }

  async getRecord(id: string): Promise<IntakeRecord | undefined> {
    const { data, error } = await this.supabase
      .from("interactions")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        return undefined;
      }
      console.error("[SupabaseStorage.getRecord]", error);
      throw new Error(`Failed to fetch record: ${error.message}`);
    }

    return data ? dbToIntakeRecord(data as DBInteraction) : undefined;
  }

  async createRecord(insertRecord: InsertIntakeRecord, meta?: TranscriptMeta): Promise<IntakeRecord> {
    console.log("============================================================");
    console.log("[INSERT] >>>>>> PHASE 1: BEFORE INSERT <<<<<<");
    console.log("[INSERT] SUPABASE_URL:", process.env.SUPABASE_URL ? process.env.SUPABASE_URL.substring(0, 40) + "..." : "NOT SET");
    console.log("[INSERT] SERVICE_ROLE_KEY:", process.env.SUPABASE_SERVICE_ROLE_KEY ? "SET (length=" + process.env.SUPABASE_SERVICE_ROLE_KEY.length + ")" : "NOT SET");
    console.log("[INSERT] client_id:", insertRecord.clientId);
    console.log("[INSERT] name:", insertRecord.name);
    console.log("[INSERT] smsConsent:", insertRecord.smsConsent);

    // Derive address quality + needs_review before insert
    const addressQuality = deriveAddressQuality(insertRecord.address);
    const needsReview = deriveNeedsReview({
      addressQuality,
      name: insertRecord.name,
      channel: insertRecord.channel,
      callMetadata: meta?.callMetadata ?? null,
    });

    console.log(`[INSERT] addressQuality=${addressQuality}, needsReview=${needsReview}`);

    const enrichedRecord = { ...insertRecord, addressQuality, needsReview };
    const dbRecord = intakeRecordToDB(enrichedRecord, meta);

    // Log EXACT payload keys and values going to Supabase
    console.log("[INSERT] DB payload keys:", Object.keys(dbRecord).join(", "));
    console.log("[INSERT] DB payload (truncated):", JSON.stringify({
      ...dbRecord,
      raw_transcript: dbRecord.raw_transcript ? `[${dbRecord.raw_transcript.length} chars]` : null,
      call_metadata: dbRecord.call_metadata ? "[object]" : null,
    }));
    console.log("============================================================");

    const { data, error } = await this.supabase
      .from("interactions")
      .insert(dbRecord)
      .select()
      .single();

    if (error) {
      console.error("============================================================");
      console.error("[INSERT] >>>>>> INSERT FAILED <<<<<<");
      console.error("[INSERT] error.code:", error.code);
      console.error("[INSERT] error.message:", error.message);
      console.error("[INSERT] error.details:", error.details);
      console.error("[INSERT] error.hint:", error.hint);
      console.error("[INSERT] FULL error:", JSON.stringify(error, null, 2));
      console.error("============================================================");

      // ============================================================
      // PGRST204 GUARD: PostgREST schema cache is stale
      // The column exists in Postgres but PostgREST doesn't see it.
      // Targeted fallback: strip the unrecognized column and retry
      // once so the record is not lost. This is NOT a blind retry.
      // ============================================================
      if (error.code === "PGRST204" && error.message?.includes("sms_consent")) {
        console.warn("============================================================");
        console.warn("[INSERT] POSTGREST SCHEMA CACHE STALE — sms_consent NOT RECOGNIZED");
        console.warn("[INSERT] Attempting fallback insert WITHOUT sms_consent...");
        console.warn("============================================================");

        const { sms_consent, ...fallbackPayload } = dbRecord;

        const { data: fallbackData, error: fallbackError } = await this.supabase
          .from("interactions")
          .insert(fallbackPayload)
          .select()
          .single();

        if (fallbackError) {
          console.error("[INSERT] >>>>>> FALLBACK ALSO FAILED <<<<<<");
          console.error("[INSERT] fallback error:", JSON.stringify(fallbackError, null, 2));
          throw new Error(`Failed to create record (fallback): ${fallbackError.message}`);
        }

        console.log("============================================================");
        console.log("[INSERT] >>>>>> FALLBACK INSERT SUCCESS <<<<<<");
        console.log("[INSERT] Returned row ID:", fallbackData?.id);
        console.log("[INSERT] NOTE: sms_consent was dropped due to stale schema cache.");
        console.log("[INSERT] Run: NOTIFY pgrst, 'reload schema'; in Supabase SQL Editor.");
        console.log("============================================================");
        return dbToIntakeRecord(fallbackData as DBInteraction);
      }

      throw new Error(`Failed to create record: ${error.message}`);
    }

    console.log("============================================================");
    console.log("[INSERT] >>>>>> INSERT SUCCESS <<<<<<");
    console.log("[INSERT] Returned row ID:", data?.id);
    console.log("[INSERT] Returned client_id:", (data as any)?.client_id);
    console.log("[INSERT] Returned created_at:", (data as any)?.created_at);
    console.log("============================================================");
    return dbToIntakeRecord(data as DBInteraction);
  }

  async updateRecord(id: string, updates: Partial<InsertIntakeRecord>): Promise<IntakeRecord | undefined> {
    // Convert app updates to DB format
    const dbUpdates: Partial<Omit<DBInteraction, "id">> = {};
    if (updates.intent !== undefined) dbUpdates.raw_issue_text = updates.intent;
    if (updates.department !== undefined) dbUpdates.department = updates.department;
    if (updates.transcriptSummary !== undefined) dbUpdates.issue_summary = updates.transcriptSummary;
    if (updates.name !== undefined) dbUpdates.name = updates.name;
    if (updates.phone !== undefined) dbUpdates.phone = updates.phone;
    if (updates.address !== undefined) dbUpdates.address = updates.address;
    if (updates.addressRaw !== undefined) dbUpdates.address_raw = updates.addressRaw;

    const { data, error } = await this.supabase
      .from("interactions")
      .update(dbUpdates)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      console.error("[SupabaseStorage.updateRecord]", error);
      return undefined;
    }

    return data ? dbToIntakeRecord(data as DBInteraction) : undefined;
  }

  async deleteRecord(id: string, clientId?: string): Promise<boolean> {
    let query = this.supabase
      .from("interactions")
      .delete()
      .eq("id", id);

    // If clientId provided, ensure client ownership
    if (clientId && clientId !== "all") {
      query = query.eq("client_id", clientId);
    }

    const { error, count } = await query;

    if (error) {
      console.error("[SupabaseStorage.deleteRecord]", error);
      return false;
    }

    console.log(`[SupabaseStorage.deleteRecord] Deleted record ${id}`);
    return true;
  }

  async getStats(clientId?: string): Promise<DashboardStats> {
    let query = this.supabase.from("interactions").select("*");

    if (clientId && clientId !== "all") {
      query = query.eq("client_id", clientId);
    }

    const { data, error } = await query;

    if (error) {
      console.error("[SupabaseStorage.getStats]", error);
      throw new Error(`Failed to fetch stats: ${error.message}`);
    }

    const records = (data as DBInteraction[]).map(dbToIntakeRecord);
    const today = new Date().toISOString().split("T")[0];

    const todayRecords = records.filter(
      (r) => r.timestamp.split("T")[0] === today
    );

    const totalMinutesToday = Math.round(
      todayRecords
        .filter((r) => r.channel === "Voice")
        .reduce((acc, r) => acc + r.durationSeconds, 0) / 60
    );

    const totalCost = records.reduce((acc, r) => acc + r.cost, 0);

    return {
      totalRecords: records.length,
      totalMinutesToday,
      totalCost,
    };
  }

  async getClients(): Promise<Client[]> {
    return clients;
  }

  /**
   * Look up department email configuration
   * Falls back to "General" if specific department not found
   */
  async getDepartmentEmail(clientId: string, department: string): Promise<DepartmentEmailConfig | null> {
    // First try exact department match
    const { data, error } = await this.supabase
      .from("department_emails")
      .select("email, cc_email")
      .eq("client_id", clientId)
      .eq("department", department)
      .single();

    if (!error && data) {
      return {
        email: data.email,
        cc_email: data.cc_email,
      };
    }

    // If not found, try "General" fallback
    if (department !== "General") {
      console.log(`[storage] No email config for "${department}", trying "General" fallback`);
      const { data: fallbackData, error: fallbackError } = await this.supabase
        .from("department_emails")
        .select("email, cc_email")
        .eq("client_id", clientId)
        .eq("department", "General")
        .single();

      if (!fallbackError && fallbackData) {
        return {
          email: fallbackData.email,
          cc_email: fallbackData.cc_email,
        };
      }
    }

    console.warn(`[storage] No email configuration found for client "${clientId}", department "${department}"`);
    return null;
  }

  /**
   * Log email send attempt for audit trail
   */
  async logEmailSend(
    interactionId: string,
    department: string,
    recipientEmail: string,
    ccEmail: string | null,
    status: "sent" | "failed",
    errorMessage?: string
  ): Promise<void> {
    const { error } = await this.supabase.from("email_logs").insert({
      interaction_id: interactionId,
      department,
      recipient_email: recipientEmail,
      cc_email: ccEmail,
      status,
      error_message: errorMessage || null,
    });

    if (error) {
      console.error("[storage] Failed to log email send:", error);
      // Don't throw - logging failure should not affect the main flow
    }
  }

  /**
   * List all department email configurations for a client
   */
  async listDepartmentEmails(clientId: string): Promise<DepartmentEmail[]> {
    const { data, error } = await this.supabase
      .from("department_emails")
      .select("*")
      .eq("client_id", clientId)
      .order("department", { ascending: true });

    if (error) {
      console.error("[storage] Failed to list department emails:", error);
      throw new Error(`Failed to list department emails: ${error.message}`);
    }

    return (data || []).map((row) => ({
      id: row.id,
      clientId: row.client_id,
      department: row.department,
      email: row.email,
      ccEmail: row.cc_email,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /**
   * Create a new department email configuration
   */
  async createDepartmentEmail(
    clientId: string,
    department: string,
    email: string,
    ccEmail?: string | null
  ): Promise<DepartmentEmail> {
    const { data, error } = await this.supabase
      .from("department_emails")
      .insert({
        client_id: clientId,
        department,
        email,
        cc_email: ccEmail || null,
      })
      .select()
      .single();

    if (error) {
      // Check for unique constraint violation
      if (error.code === "23505") {
        throw new Error(`Department "${department}" already has an email configuration`);
      }
      console.error("[storage] Failed to create department email:", error);
      throw new Error(`Failed to create department email: ${error.message}`);
    }

    return {
      id: data.id,
      clientId: data.client_id,
      department: data.department,
      email: data.email,
      ccEmail: data.cc_email,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  /**
   * Update an existing department email configuration
   */
  async updateDepartmentEmail(
    id: string,
    clientId: string,
    email: string,
    ccEmail?: string | null
  ): Promise<DepartmentEmail | null> {
    const { data, error } = await this.supabase
      .from("department_emails")
      .update({
        email,
        cc_email: ccEmail || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("client_id", clientId) // Ensure client ownership
      .select()
      .single();

    if (error) {
      if (error.code === "PGRST116") {
        // No rows returned - not found or wrong client
        return null;
      }
      console.error("[storage] Failed to update department email:", error);
      throw new Error(`Failed to update department email: ${error.message}`);
    }

    return {
      id: data.id,
      clientId: data.client_id,
      department: data.department,
      email: data.email,
      ccEmail: data.cc_email,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  }

  /**
   * Delete a department email configuration
   * Returns false if department is "General" (protected) or not found
   */
  async deleteDepartmentEmail(id: string, clientId: string): Promise<boolean> {
    // First check if this is the "General" department (protected)
    const { data: existing, error: checkError } = await this.supabase
      .from("department_emails")
      .select("department")
      .eq("id", id)
      .eq("client_id", clientId)
      .single();

    if (checkError || !existing) {
      console.log("[storage] Department email not found for deletion");
      return false;
    }

    if (existing.department === "General") {
      console.log("[storage] Cannot delete General department email");
      return false;
    }

    const { error } = await this.supabase
      .from("department_emails")
      .delete()
      .eq("id", id)
      .eq("client_id", clientId);

    if (error) {
      console.error("[storage] Failed to delete department email:", error);
      return false;
    }

    return true;
  }

  // ============================================================
  // Re-evaluation methods
  // ============================================================

  async getRecordDetail(id: string): Promise<IntakeRecordDetail | undefined> {
    const { data, error } = await this.supabase
      .from("interactions")
      .select("*")
      .eq("id", id)
      .single();

    if (error) {
      if (error.code === "PGRST116") return undefined;
      console.error("[SupabaseStorage.getRecordDetail]", error);
      throw new Error(`Failed to fetch record detail: ${error.message}`);
    }

    return data ? dbToIntakeRecordDetail(data as DBInteraction) : undefined;
  }

  async createEvaluationEntry(entry: InsertEvaluationEntry): Promise<EvaluationEntry> {
    const dbRow = {
      interaction_id: entry.interactionId,
      evaluation_type: entry.evaluationType,
      candidate_name: entry.candidateName ?? null,
      candidate_address: entry.candidateAddress ?? null,
      candidate_intent: entry.candidateIntent ?? null,
      candidate_department: entry.candidateDepartment ?? null,
      candidate_summary: entry.candidateSummary ?? null,
      extraction_meta: entry.extractionMeta ?? {},
      status: entry.status,
      applied_at: entry.appliedAt ?? null,
      applied_by: entry.appliedBy ?? null,
    };

    const { data, error } = await this.supabase
      .from("evaluation_history")
      .insert(dbRow)
      .select()
      .single();

    if (error) {
      console.error("[SupabaseStorage.createEvaluationEntry]", error);
      throw new Error(`Failed to create evaluation entry: ${error.message}`);
    }

    return dbToEvaluationEntry(data as DBEvaluationHistory);
  }

  async getEvaluationHistory(interactionId: string): Promise<EvaluationEntry[]> {
    const { data, error } = await this.supabase
      .from("evaluation_history")
      .select("*")
      .eq("interaction_id", interactionId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[SupabaseStorage.getEvaluationHistory]", error);
      throw new Error(`Failed to fetch evaluation history: ${error.message}`);
    }

    return (data as DBEvaluationHistory[]).map(dbToEvaluationEntry);
  }

  async applyEvaluation(
    evaluationId: string,
    interactionId: string,
    appliedBy: string
  ): Promise<{ record: IntakeRecord; evaluation: EvaluationEntry }> {
    // Call the Postgres RPC function for transactional safety
    const { data: rpcResult, error: rpcError } = await this.supabase
      .rpc("apply_evaluation", {
        eval_id: evaluationId,
        applied_by_user: appliedBy,
      });

    if (rpcError) {
      console.error("[SupabaseStorage.applyEvaluation] RPC error:", rpcError);
      throw new Error(`Failed to apply evaluation: ${rpcError.message}`);
    }

    // Fetch the updated record and evaluation
    const record = await this.getRecord(interactionId);
    if (!record) {
      throw new Error("Record not found after applying evaluation");
    }

    const { data: evalData, error: evalError } = await this.supabase
      .from("evaluation_history")
      .select("*")
      .eq("id", evaluationId)
      .single();

    if (evalError) {
      throw new Error(`Failed to fetch applied evaluation: ${evalError.message}`);
    }

    return {
      record,
      evaluation: dbToEvaluationEntry(evalData as DBEvaluationHistory),
    };
  }
}

// Storage factory with environment-based selection
function createStorage(): IStorage {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  console.log("[storage] Initializing storage...");
  console.log(`[storage] SUPABASE_URL defined: ${!!supabaseUrl}`);
  console.log(`[storage] SUPABASE_SERVICE_ROLE_KEY defined: ${!!supabaseKey}`);

  if (supabaseUrl && supabaseKey) {
    // Validate URL format before using Supabase
    if (!supabaseUrl.startsWith("https://")) {
      console.error(`[storage] ERROR: SUPABASE_URL must start with https:// (got: ${supabaseUrl.substring(0, 20)}...)`);
      console.log("[storage] Falling back to MemStorage");
      return new MemStorage();
    }
    console.log("[storage] Using SupabaseStorage (production mode)");
    return new SupabaseStorage();
  }

  console.log("[storage] Using MemStorage (development fallback)");
  return new MemStorage();
}

export const storage: IStorage = createStorage();
