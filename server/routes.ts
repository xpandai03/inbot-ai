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

  // Debug endpoint - verify system state (remove after debugging)
  app.get("/debug/status", async (_req, res) => {
    const status = {
      timestamp: new Date().toISOString(),
      commit: process.env.RAILWAY_GIT_COMMIT_SHA || "unknown",
      node_env: process.env.NODE_ENV,
      auth_enabled: process.env.AUTH_ENABLED,
      supabase_url_defined: !!process.env.SUPABASE_URL,
      supabase_key_defined: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
      twilio_configured: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
      openai_configured: !!process.env.OPENAI_API_KEY,
    };
    console.log("[debug/status] Status check:", status);
    res.json(status);
  });

  // Debug endpoint - test insert (remove after debugging)
  app.post("/debug/test-insert", async (_req, res) => {
    console.log("[debug/test-insert] === TESTING INSERT ===");
    try {
      const testRecord = {
        name: "DEBUG TEST",
        phone: "+10000000000",
        address: "Test Address",
        intent: "Debug Test",
        department: "Debug",
        channel: "SMS" as const,
        language: "English",
        durationSeconds: 0,
        cost: 0,
        timestamp: new Date().toISOString(),
        transcriptSummary: "Debug test record",
        clientId: "client_demo",
      };
      const created = await storage.createRecord(testRecord);
      console.log("[debug/test-insert] === SUCCESS ===", created.id);
      res.json({ success: true, id: created.id, record: created });
    } catch (error) {
      console.error("[debug/test-insert] === FAILED ===", error);
      res.status(500).json({ success: false, error: String(error) });
    }
  });

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

  // Store last Vapi payload for debugging
  let lastVapiPayload: { timestamp: string; type: string; callId: string | null; error: string | null; body: unknown } | null = null;

  // Debug endpoint to see last Vapi payload
  app.get("/debug/vapi-last", (_req, res) => {
    res.json(lastVapiPayload || { message: "No Vapi webhook received yet" });
  });

  // BULLETPROOF Vapi webhook - ALWAYS returns 200
  app.post("/webhook/vapi", async (req, res) => {
    const timestamp = new Date().toISOString();
    let callId: string | null = null;
    let messageType: string = "unknown";
    let errorMsg: string | null = null;

    // ALWAYS return 200 to Vapi - wrap EVERYTHING in try/catch
    try {
      console.log("=======================================================");
      console.log("[VAPI] WEBHOOK HIT");
      console.log("[VAPI] Time:", timestamp);
      console.log("[VAPI] Content-Type:", req.headers["content-type"]);
      console.log("[VAPI] Body exists:", !!req.body);
      console.log("[VAPI] Body type:", typeof req.body);

      const payload = req.body || {};
      messageType = payload?.message?.type || "unknown";
      callId = payload?.message?.call?.id || null;

      console.log("[VAPI] Message type:", messageType);
      console.log("[VAPI] Call ID:", callId);
      console.log("[VAPI] Ended reason:", payload?.message?.endedReason || "N/A");

      // Store for debugging (truncate large fields)
      lastVapiPayload = {
        timestamp,
        type: messageType,
        callId,
        error: null,
        body: {
          messageType,
          callId,
          endedReason: payload?.message?.endedReason,
          hasSummary: !!payload?.message?.summary,
          hasTranscript: !!payload?.message?.transcript,
          hasArtifact: !!payload?.message?.artifact,
        },
      };

      // Process end-of-call-report
      if (messageType === "end-of-call-report") {
        console.log("[VAPI] Processing end-of-call-report...");

        try {
          const vapiPayload = payload as VapiWebhookPayload;
          const partialRecord = transformVapiToIntakeRecord(vapiPayload);
          const { rawText, ...recordFields } = partialRecord;

          console.log("[VAPI] Extracted data - name:", recordFields.name, "phone:", recordFields.phone);
          console.log("[VAPI] Raw text length:", rawText?.length || 0);

          // INSERT FIRST with pending classification
          const pendingRecord = {
            ...recordFields,
            intent: "Pending",
            department: "Pending",
            transcriptSummary: rawText?.substring(0, 200) || "Processing...",
          };

          const validation = insertIntakeRecordSchema.safeParse(pendingRecord);
          if (!validation.success) {
            console.error("[VAPI] Validation failed:", JSON.stringify(validation.error.issues));
            errorMsg = `Validation failed: ${JSON.stringify(validation.error.issues)}`;
            lastVapiPayload.error = errorMsg;
            // Still return 200 to stop Vapi retries
            return res.status(200).json({ ok: true, warning: "Validation failed", details: validation.error.issues });
          }

          console.log("[VAPI] Inserting record into database...");
          const newRecord = await storage.createRecord(validation.data);
          console.log("[VAPI] === INSERT SUCCESS === ID:", newRecord.id);

          // Respond 200 immediately
          res.status(200).json({ ok: true, recordId: newRecord.id });

          // Background: classify and update (fire-and-forget)
          setImmediate(async () => {
            try {
              console.log("[VAPI] Background: Starting classification...");
              const classification = await classifyIntake({
                rawText: rawText || "",
                channel: "Voice",
                clientId: recordFields.clientId,
              });
              console.log("[VAPI] Background: Classification result:", classification.intent, classification.department);

              await storage.updateRecord(newRecord.id, {
                intent: classification.intent,
                department: classification.department,
                transcriptSummary: classification.summary,
              });
              console.log("[VAPI] Background: Record updated with classification");

              triggerDepartmentEmail({
                ...newRecord,
                intent: classification.intent,
                department: classification.department,
                transcriptSummary: classification.summary,
              }).catch((e) => console.error("[VAPI] Background: Email failed:", e));
            } catch (bgError) {
              console.error("[VAPI] Background: Classification failed:", bgError);
            }
          });

          return;
        } catch (processError) {
          console.error("[VAPI] Processing error:", processError);
          errorMsg = String(processError);
          lastVapiPayload.error = errorMsg;
          // Still return 200
          return res.status(200).json({ ok: true, warning: "Processing error", error: errorMsg });
        }
      }

      // For all other Vapi event types (transcript, status-update, etc.)
      console.log("[VAPI] Ignoring event type:", messageType);
      return res.status(200).json({ ok: true, ignored: true, type: messageType });

    } catch (outerError) {
      // CATCH-ALL: Log everything, still return 200
      console.error("[VAPI] === OUTER ERROR ===");
      console.error("[VAPI] Error:", outerError);
      console.error("[VAPI] Stack:", outerError instanceof Error ? outerError.stack : "N/A");
      errorMsg = String(outerError);
      if (lastVapiPayload) lastVapiPayload.error = errorMsg;

      // ALWAYS return 200 to stop Vapi retries
      return res.status(200).json({ ok: true, warning: "Server error occurred", error: errorMsg });
    }
  });

  // Twilio SMS webhook endpoint
  app.post("/webhook/twilio", async (req, res) => {
    console.log("=======================================================");
    console.log("[webhook/twilio] === WEBHOOK HIT ===");
    console.log("[webhook/twilio] Time:", new Date().toISOString());
    console.log("[webhook/twilio] Headers:", JSON.stringify(req.headers, null, 2));
    console.log("[webhook/twilio] Body exists:", !!req.body);
    console.log("[webhook/twilio] Body type:", typeof req.body);
    console.log("[webhook/twilio] Body keys:", Object.keys(req.body || {}));
    console.log("[webhook/twilio] Full body:", JSON.stringify(req.body, null, 2));
    console.log("=======================================================");
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
