import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertIntakeRecordSchema } from "@shared/schema";

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
      
      const record = {
        name: payload.name || "Unknown Caller",
        phone: payload.phone || "(555) 000-0000",
        address: payload.address || "Address not provided",
        intent: payload.intent || "Pothole",
        department: payload.department || "Public Works",
        channel: (payload.channel as "Voice" | "SMS") || "Voice",
        language: payload.language || "English",
        durationSeconds: payload.durationSeconds || Math.floor(Math.random() * 300) + 30,
        cost: payload.cost || parseFloat((Math.random() * 0.5 + 0.1).toFixed(2)),
        timestamp: new Date().toISOString(),
        transcriptSummary: payload.transcriptSummary || "Intake record created via webhook.",
        clientId: payload.clientId || "city-springfield",
      };

      const validation = insertIntakeRecordSchema.safeParse(record);
      if (!validation.success) {
        return res.status(400).json({ 
          error: "Invalid payload", 
          details: validation.error.issues 
        });
      }

      const newRecord = await storage.createRecord(validation.data);
      res.status(201).json({ success: true, record: newRecord });
    } catch (error) {
      res.status(500).json({ error: "Failed to process webhook" });
    }
  });

  return httpServer;
}
