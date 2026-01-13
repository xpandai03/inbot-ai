import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertIntakeRecordSchema } from "@shared/schema";
import {
  isEndOfCallReport,
  transformVapiToIntakeRecord,
  getCallId,
  type VapiWebhookPayload,
} from "./vapi-transform";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  app.get("/api/records", async (req, res) => {
    try {
      const clientId = req.query.clientId as string | undefined;
      const records = await storage.getRecords(clientId);
      res.json(records);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch records" });
    }
  });

  app.get("/api/stats", async (req, res) => {
    try {
      const clientId = req.query.clientId as string | undefined;
      const stats = await storage.getStats(clientId);
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch stats" });
    }
  });

  app.get("/api/clients", async (_req, res) => {
    try {
      const clients = await storage.getClients();
      res.json(clients);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch clients" });
    }
  });

  app.post("/webhook/vapi", async (req, res) => {
    try {
      const payload = req.body;

      // Check if this is a real Vapi end-of-call-report
      if (isEndOfCallReport(payload)) {
        const vapiPayload = payload as VapiWebhookPayload;
        const callId = getCallId(vapiPayload);

        console.log(`[webhook/vapi] Received end-of-call-report for call: ${callId}`);

        // Transform Vapi payload to IntakeRecord
        const record = transformVapiToIntakeRecord(vapiPayload);

        // Validate the transformed record
        const validation = insertIntakeRecordSchema.safeParse(record);
        if (!validation.success) {
          console.error("[webhook/vapi] Validation failed:", validation.error.issues);
          return res.status(400).json({
            error: "Invalid transformed payload",
            details: validation.error.issues,
          });
        }

        // Write to storage
        const newRecord = await storage.createRecord(validation.data);
        console.log(`[webhook/vapi] Created record: ${newRecord.id}`);

        return res.status(201).json({
          success: true,
          callId,
          record: newRecord,
        });
      }

      // Check if this is a Vapi event we should ignore (e.g., transcript, status-update)
      if (payload.message && payload.message.type && payload.message.type !== "end-of-call-report") {
        console.log(`[webhook/vapi] Ignoring event type: ${payload.message.type}`);
        return res.status(200).json({ success: true, ignored: true });
      }

      // LEGACY: Handle simple/fake payloads for testing
      console.log("[webhook/vapi] Processing legacy payload");
      const record = {
        name: payload.name || "Unknown Caller",
        phone: payload.phone || "(555) 000-0000",
        address: payload.address || "Address not provided",
        intent: payload.intent || "General inquiry",
        department: payload.department || "General",
        channel: (payload.channel as "Voice" | "SMS") || "Voice",
        language: payload.language || "English",
        durationSeconds: payload.durationSeconds || Math.floor(Math.random() * 300) + 30,
        cost: payload.cost || parseFloat((Math.random() * 0.5 + 0.1).toFixed(2)),
        timestamp: new Date().toISOString(),
        transcriptSummary: payload.transcriptSummary || "Intake record created via webhook.",
        clientId: payload.clientId || "client_demo",
      };

      const validation = insertIntakeRecordSchema.safeParse(record);
      if (!validation.success) {
        return res.status(400).json({
          error: "Invalid payload",
          details: validation.error.issues,
        });
      }

      const newRecord = await storage.createRecord(validation.data);
      res.status(201).json({ success: true, record: newRecord });
    } catch (error) {
      console.error("[webhook/vapi] Error:", error);
      res.status(500).json({ error: "Failed to process webhook" });
    }
  });

  return httpServer;
}
