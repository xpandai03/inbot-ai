import { z } from "zod";

export const ADDRESS_QUALITY_VALUES = [
  "complete",
  "partial",
  "intersection",
  "approximate",
  "missing",
] as const;

export type AddressQuality = (typeof ADDRESS_QUALITY_VALUES)[number];

export const intakeRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string(),
  address: z.string(),
  addressRaw: z.string().nullable().optional(),
  intent: z.string(),
  department: z.string(),
  channel: z.enum(["Voice", "SMS"]),
  language: z.string(),
  durationSeconds: z.number(),
  cost: z.number(),
  timestamp: z.string(),
  transcriptSummary: z.string(),
  clientId: z.string(),
  addressQuality: z.enum(ADDRESS_QUALITY_VALUES).default("missing"),
  needsReview: z.boolean().default(false),
  /** SMS consent: true=opt-in, false=opt-out/unclear, null=not asked/legacy. No SMS unless true. */
  smsConsent: z.boolean().nullable().optional(),
});

export const insertIntakeRecordSchema = intakeRecordSchema.omit({
  id: true,
  addressQuality: true,
  needsReview: true,
});

export type IntakeRecord = z.infer<typeof intakeRecordSchema>;
export type InsertIntakeRecord = z.infer<typeof insertIntakeRecordSchema>;

/** No outbound SMS unless sms_consent === true. Use for filtering recipients and gating send. */
export function canSendSms(record: { smsConsent?: boolean | null }): boolean {
  return record.smsConsent === true;
}

export type UserRole = "client" | "superadmin";

export interface DashboardStats {
  totalRecords: number;
  totalMinutesToday: number;
  totalCost: number;
}

export interface Client {
  id: string;
  name: string;
}

// Department Email Configuration
export const KNOWN_DEPARTMENTS = [
  "General",
  "Public Works",
  "Public Safety",
  "Finance",
  "Parks & Public Property",
  "Parks & Recreation",
  "Sanitation",
  "Utilities",
  "Planning and Zoning",
] as const;

export type KnownDepartment = (typeof KNOWN_DEPARTMENTS)[number];

export const departmentEmailSchema = z.object({
  id: z.string(),
  clientId: z.string(),
  department: z.string().min(1, "Department is required"),
  email: z.string().email("Invalid email address"),
  ccEmail: z.string().email("Invalid CC email address").nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

export const insertDepartmentEmailSchema = departmentEmailSchema.omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const updateDepartmentEmailSchema = z.object({
  email: z.string().email("Invalid email address"),
  ccEmail: z.string().email("Invalid CC email address").nullable().optional(),
});

export type DepartmentEmail = z.infer<typeof departmentEmailSchema>;
export type InsertDepartmentEmail = z.infer<typeof insertDepartmentEmailSchema>;
export type UpdateDepartmentEmail = z.infer<typeof updateDepartmentEmailSchema>;

// ============================================================
// Re-evaluation: Extended record detail + evaluation history
// ============================================================

export const intakeRecordDetailSchema = intakeRecordSchema.extend({
  rawTranscript: z.string().nullable().optional(),
  recordingUrl: z.string().nullable().optional(),
  stereoRecordingUrl: z.string().nullable().optional(),
  callMetadata: z.record(z.unknown()).nullable().optional(),
  updatedAt: z.string().nullable().optional(),
});

export type IntakeRecordDetail = z.infer<typeof intakeRecordDetailSchema>;

export const evaluationEntrySchema = z.object({
  id: z.string(),
  interactionId: z.string(),
  evaluationType: z.enum(["initial", "re-evaluation"]),
  candidateName: z.string().nullable().optional(),
  candidateAddress: z.string().nullable().optional(),
  candidateIntent: z.string().nullable().optional(),
  candidateDepartment: z.string().nullable().optional(),
  candidateSummary: z.string().nullable().optional(),
  extractionMeta: z.record(z.unknown()).default({}),
  status: z.enum(["candidate", "applied", "superseded"]),
  appliedAt: z.string().nullable().optional(),
  appliedBy: z.string().nullable().optional(),
  createdAt: z.string(),
});

export type EvaluationEntry = z.infer<typeof evaluationEntrySchema>;

export const insertEvaluationEntrySchema = evaluationEntrySchema.omit({
  id: true,
  createdAt: true,
});

export type InsertEvaluationEntry = z.infer<typeof insertEvaluationEntrySchema>;
