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
