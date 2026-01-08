import { z } from "zod";

export const intakeRecordSchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string(),
  address: z.string(),
  intent: z.string(),
  department: z.string(),
  channel: z.enum(["Voice", "SMS"]),
  language: z.string(),
  durationSeconds: z.number(),
  cost: z.number(),
  timestamp: z.string(),
  transcriptSummary: z.string(),
  clientId: z.string(),
});

export const insertIntakeRecordSchema = intakeRecordSchema.omit({ id: true });

export type IntakeRecord = z.infer<typeof intakeRecordSchema>;
export type InsertIntakeRecord = z.infer<typeof insertIntakeRecordSchema>;

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
