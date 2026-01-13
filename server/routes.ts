import type { Express, RequestHandler } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertIntakeRecordSchema, type IntakeRecord } from "@shared/schema";
import {
  isEndOfCallReport,
  transformVapiToIntakeRecord,
  getCallId,
  type VapiWebhookPayload,
} from "./vapi-transform";
import { sendDepartmentEmail, normalizeDepartment } from "./email";
import { requireAuth, requireSuperAdmin, getEffectiveClientId } from "./auth";
import { classifyIntake } from "./intake-classifier";
import {
  parseTwilioPayload,
  generateThankYouTwiml,
  formatPhoneNumber,
  isTwilioConfigured,
} from "./twilio";

// Auth enforcement flag - set to true once frontend auth is ready
const AUTH_ENABLED = process.env.AUTH_ENABLED === "true";

// Conditional auth middleware - only enforces if AUTH_ENABLED
const conditionalAuth: RequestHandler = (req, res, next) => {
  if (!AUTH_ENABLED) {
    return next();
  }
  return requireAuth(req, res, next);
};

// Conditional super admin check
const conditionalSuperAdmin: RequestHandler = (req, res, next) => {
  if (!AUTH_ENABLED) {
    return next();
  }
  return requireSuperAdmin(req, res, next);
};

/**
 * Trigger department email notification (async, fire-and-forget)
 * Never blocks the response or throws errors
 */
async function triggerDepartmentEmail(record: IntakeRecord): Promise<void> {
  try {
    // Normalize department to known categories
    const normalizedDept = normalizeDepartment(record.department);

    // Look up email configuration
    const emailConfig = await storage.getDepartmentEmail(record.clientId, normalizedDept);

    if (!emailConfig) {
      console.log(`[email] No email config for client "${record.clientId}", skipping notification`);
      return;
    }

    // Send email (async)
    const result = await sendDepartmentEmail(record, emailConfig);

    // Log the result
    await storage.logEmailSend(
      record.id,
      normalizedDept,
      emailConfig.email,
      emailConfig.cc_email,
      result.success ? "sent" : "failed",
      result.error
    );

    if (result.success) {
      console.log(`[email] Department notification sent for record ${record.id}`);
    } else {
      console.warn(`[email] Failed to send notification for record ${record.id}: ${result.error}`);
    }
  } catch (err) {
    // Catch-all to ensure email issues never affect the main flow
    console.error("[email] Unexpected error in triggerDepartmentEmail:", err);
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  
  // Protected routes - require auth when AUTH_ENABLED=true
  app.get("/api/records", conditionalAuth, async (req, res) => {
    try {
      const clientId = getEffectiveClientId(req);
      const records = await storage.getRecords(clientId);
      res.json(records);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch records" });
    }
  });

  app.get("/api/stats", conditionalAuth, async (req, res) => {
    try {
      const clientId = getEffectiveClientId(req);
      const stats = await storage.getStats(clientId);
      res.json(stats);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch stats" });
    }
  });

  // Clients list - super admin only when auth is enabled
  app.get("/api/clients", conditionalAuth, conditionalSuperAdmin, async (_req, res) => {
    try {
      const clients = await storage.getClients();
      res.json(clients);
    } catch (error) {
      res.status(500).json({ error: "Failed to fetch clients" });
    }
  });

  app.post("/webhook/vapi", async (req, res) => {
    console.log("[webhook/vapi] === WEBHOOK HIT ===");
    try {
      const payload = req.body;
      console.log("[webhook/vapi] Payload type:", payload?.message?.type || "unknown");

      // Check if this is a real Vapi end-of-call-report
      if (isEndOfCallReport(payload)) {
        const vapiPayload = payload as VapiWebhookPayload;
        const callId = getCallId(vapiPayload);

        console.log(`[webhook/vapi] Processing end-of-call-report for call: ${callId}`);

        // Transform Vapi payload to partial IntakeRecord
        const partialRecord = transformVapiToIntakeRecord(vapiPayload);
        const { rawText, ...recordFields } = partialRecord;
        console.log("[webhook/vapi] Extracted rawText length:", rawText?.length || 0);

        // INSERT FIRST with pending classification
        const pendingRecord = {
          ...recordFields,
          intent: "Pending",
          department: "Pending",
          transcriptSummary: rawText?.substring(0, 200) || "Processing...",
        };

        // Validate the pending record
        const validation = insertIntakeRecordSchema.safeParse(pendingRecord);
        if (!validation.success) {
          console.error("[webhook/vapi] Validation failed:", validation.error.issues);
          return res.status(400).json({
            error: "Invalid transformed payload",
            details: validation.error.issues,
          });
        }

        // Write to storage FIRST (before classification)
        console.log("[webhook/vapi] Inserting record...");
        const newRecord = await storage.createRecord(validation.data);
        console.log(`[webhook/vapi] Created record: ${newRecord.id}`);

        // Respond immediately
        res.status(201).json({
          success: true,
          callId,
          record: newRecord,
        });

        // THEN classify async and update (fire-and-forget)
        (async () => {
          try {
            console.log("[webhook/vapi] Starting async classification...");
            const classification = await classifyIntake({
              rawText: rawText || "",
              channel: "Voice",
              clientId: recordFields.clientId,
            });
            console.log("[webhook/vapi] Classification result:", classification);

            // Update the record with classification
            await storage.updateRecord(newRecord.id, {
              intent: classification.intent,
              department: classification.department,
              transcriptSummary: classification.summary,
            });
            console.log(`[webhook/vapi] Updated record ${newRecord.id} with classification`);

            // Trigger email notification after classification
            triggerDepartmentEmail({
              ...newRecord,
              intent: classification.intent,
              department: classification.department,
              transcriptSummary: classification.summary,
            }).catch(() => {});
          } catch (classifyError) {
            console.error("[webhook/vapi] Async classification failed:", classifyError);
          }
        })();

        return;
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

      // Trigger email notification (async, non-blocking)
      triggerDepartmentEmail(newRecord).catch(() => {});

      res.status(201).json({ success: true, record: newRecord });
    } catch (error) {
      console.error("[webhook/vapi] Error:", error);
      res.status(500).json({ error: "Failed to process webhook" });
    }
  });

  // Twilio SMS webhook endpoint
  app.post("/webhook/twilio", async (req, res) => {
    console.log("[webhook/twilio] === WEBHOOK HIT ===");
    console.log("[webhook/twilio] Body keys:", Object.keys(req.body || {}));
    try {
      // Check if Twilio is configured
      if (!isTwilioConfigured()) {
        console.warn("[webhook/twilio] Twilio not configured");
        return res.status(503).json({ error: "SMS intake not configured" });
      }

      // Parse Twilio payload (form-urlencoded)
      const twilioPayload = parseTwilioPayload(req.body);
      if (!twilioPayload) {
        console.error("[webhook/twilio] Invalid Twilio payload, body:", req.body);
        return res.status(400).json({ error: "Invalid Twilio payload" });
      }

      const { MessageSid, From, Body } = twilioPayload;
      console.log(`[webhook/twilio] SMS from ${From}: "${Body.substring(0, 50)}..."`);

      // INSERT FIRST with pending classification
      const pendingRecord = {
        name: "Unknown (SMS)",
        phone: formatPhoneNumber(From),
        address: "Not provided",
        intent: "Pending",
        department: "Pending",
        channel: "SMS" as const,
        language: "English",
        durationSeconds: 0,
        cost: 0.0075,
        timestamp: new Date().toISOString(),
        transcriptSummary: Body.substring(0, 200) || "Processing...",
        clientId: "client_demo",
      };

      // Validate
      const validation = insertIntakeRecordSchema.safeParse(pendingRecord);
      if (!validation.success) {
        console.error("[webhook/twilio] Validation failed:", validation.error.issues);
        return res.status(400).json({
          error: "Invalid record",
          details: validation.error.issues,
        });
      }

      // Write to storage FIRST
      console.log("[webhook/twilio] Inserting record...");
      const newRecord = await storage.createRecord(validation.data);
      console.log(`[webhook/twilio] Created record: ${newRecord.id} (MessageSid: ${MessageSid})`);

      // Return TwiML response immediately
      res.set("Content-Type", "text/xml");
      res.status(200).send(generateThankYouTwiml(newRecord.id));

      // THEN classify async and update (fire-and-forget)
      (async () => {
        try {
          console.log("[webhook/twilio] Starting async classification...");
          const classification = await classifyIntake({
            rawText: Body,
            channel: "SMS",
            clientId: "client_demo",
          });
          console.log("[webhook/twilio] Classification result:", classification);

          // Update the record with classification
          await storage.updateRecord(newRecord.id, {
            intent: classification.intent,
            department: classification.department,
            transcriptSummary: classification.summary,
          });
          console.log(`[webhook/twilio] Updated record ${newRecord.id} with classification`);

          // Trigger email notification after classification
          triggerDepartmentEmail({
            ...newRecord,
            intent: classification.intent,
            department: classification.department,
            transcriptSummary: classification.summary,
          }).catch(() => {});
        } catch (classifyError) {
          console.error("[webhook/twilio] Async classification failed:", classifyError);
        }
      })();

      return;
    } catch (error) {
      console.error("[webhook/twilio] Error:", error);
      res.status(500).json({ error: "Failed to process SMS webhook" });
    }
  });

  return httpServer;
}
