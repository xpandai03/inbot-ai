import type { IntakeRecord, InsertIntakeRecord, DashboardStats, Client } from "@shared/schema";
import { randomUUID } from "crypto";
import {
  getSupabaseClient,
  dbToIntakeRecord,
  intakeRecordToDB,
  type DBInteraction,
} from "./supabase";

export interface IStorage {
  getRecords(clientId?: string): Promise<IntakeRecord[]>;
  getRecord(id: string): Promise<IntakeRecord | undefined>;
  createRecord(record: InsertIntakeRecord): Promise<IntakeRecord>;
  getStats(clientId?: string): Promise<DashboardStats>;
  getClients(): Promise<Client[]>;
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
    const record: IntakeRecord = { ...insertRecord, id };
    this.records.set(id, record);
    return record;
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

  async createRecord(insertRecord: InsertIntakeRecord): Promise<IntakeRecord> {
    const dbRecord = intakeRecordToDB(insertRecord);

    const { data, error } = await this.supabase
      .from("interactions")
      .insert(dbRecord)
      .select()
      .single();

    if (error) {
      console.error("[SupabaseStorage.createRecord]", error);
      throw new Error(`Failed to create record: ${error.message}`);
    }

    return dbToIntakeRecord(data as DBInteraction);
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
