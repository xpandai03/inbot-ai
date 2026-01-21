import type { Express, RequestHandler } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertIntakeRecordSchema, type IntakeRecord } from "@shared/schema";
import {
  isEndOfCallReport,
  transformVapiToIntakeRecord,
  getCallId,
  extractSmsFields,
  type VapiWebhookPayload,
} from "./vapi-transform";
import { sendDepartmentEmail, normalizeDepartment } from "./email";
import { requireAuth, requireSuperAdmin, getEffectiveClientId } from "./auth";
import { classifyIntake } from "./intake-classifier";
import {
  parseTwilioPayload,
  generateThankYouTwiml,
  generateTwimlResponse,
  formatPhoneNumber,
  isTwilioConfigured,
} from "./twilio";
import {
  isGuidedSmsEnabled,
  processSmsWithSession,
  deleteSession,
  getFinalizedSessionData,
  getThankYouMessage,
  startCleanupTimer,
  getAllActiveSessions,
  getSessionCount,
  getSessionDebugInfo,
  clearSession,
  type SmsSession,
  type SmsFlowResult,
} from "./sms-session";

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
  let lastVapiPayload: { timestamp: string; type: string; callId: string | null; error: string | null; body: unknown; path?: string } | null = null;

  // Circular buffer for last 20 Vapi events (for /debug/vapi-events)
  interface VapiEventLog {
    timestamp: string;
    path: string;
    messageType: string;
    didProcess: boolean;
    responseSent: boolean;
    callId: string | null;
    error: string | null;
  }
  const vapiEventBuffer: VapiEventLog[] = [];
  const MAX_VAPI_EVENTS = 20;

  function logVapiEvent(event: VapiEventLog) {
    vapiEventBuffer.push(event);
    if (vapiEventBuffer.length > MAX_VAPI_EVENTS) {
      vapiEventBuffer.shift(); // Remove oldest
    }
  }

  // Debug endpoint to see last Vapi payload
  app.get("/debug/vapi-last", (_req, res) => {
    res.json(lastVapiPayload || { message: "No Vapi webhook received yet" });
  });

  // Debug endpoint to see last 20 Vapi events
  app.get("/debug/vapi-events", (_req, res) => {
    res.json({
      count: vapiEventBuffer.length,
      events: vapiEventBuffer.slice().reverse(), // Most recent first
    });
  });

  // DEBUG: Log ALL webhook-like requests to find where Vapi is actually posting
  app.use((req, res, next) => {
    if (req.method === "POST" && (req.path.includes("vapi") || req.path.includes("webhook"))) {
      console.log("=======================================================");
      console.log("[WEBHOOK-DEBUG] POST request detected");
      console.log("[WEBHOOK-DEBUG] req.path:", req.path);
      console.log("[WEBHOOK-DEBUG] req.originalUrl:", req.originalUrl);
      console.log("[WEBHOOK-DEBUG] req.baseUrl:", req.baseUrl);
      console.log("[WEBHOOK-DEBUG] Content-Type:", req.headers["content-type"]);
      console.log("[WEBHOOK-DEBUG] Body type:", req.body?.message?.type || "no message.type");
      console.log("=======================================================");
    }
    next();
  });

  // ============================================================
  // VAPI WEBHOOK HANDLER
  // ============================================================
  // IMPORTANT: Vapi assistant webhook MUST point to Railway:
  //   https://inbot-ai-production.up.railway.app/webhook/vapi
  //
  // Replit URLs (*.replit.dev) must NEVER be used - they will
  // return 410 Gone and events will be rejected.
  // ============================================================
  const handleVapiWebhook = async (req: any, res: any) => {
    const timestamp = new Date().toISOString();
    const requestPath = req.path || req.originalUrl || "unknown";
    const requestHost = req.headers.host || "unknown";

    // ============================================================
    // STEP 1: LOG ABSOLUTE PROOF OF WHICH URL IS HIT
    // ============================================================
    console.log("=======================================================");
    console.log(`[VAPI] HIT host=${requestHost} path=${requestPath}`);
    console.log(`[VAPI] RAILWAY_PUBLIC_DOMAIN=${process.env.RAILWAY_PUBLIC_DOMAIN || "not set"}`);

    // ============================================================
    // STEP 2: HARD REJECT NON-RAILWAY DOMAINS
    // Returns 410 Gone to make misconfiguration obvious
    // ============================================================
    const allowedHost = process.env.VAPI_ALLOWED_HOST || "inbot-ai-production.up.railway.app";
    if (!requestHost.includes(allowedHost) && !requestHost.includes("localhost")) {
      console.error(`[VAPI] REJECTED NON-RAILWAY REQUEST host=${requestHost} allowed=${allowedHost}`);
      return res.status(410).json({
        error: "Gone",
        message: "This webhook endpoint has moved. Update Vapi assistant to use Railway URL.",
        expected_host: allowedHost,
        received_host: requestHost,
      });
    }

    // IMMEDIATELY extract message type - before ANY other processing
    const payload = req.body || {};
    const messageType = payload?.message?.type || "unknown";

    console.log(`[VAPI] ACCEPTED type=${messageType}`);

    // ============================================================
    // FAST PATH: ACK all non-end-of-call-report events immediately
    // This prevents 503 errors and Vapi retries
    // ============================================================
    if (messageType !== "end-of-call-report") {
      console.log(`[VAPI] ACK_ONLY event type: ${messageType} path: ${requestPath}`);

      // Log to event buffer for debugging
      logVapiEvent({
        timestamp,
        path: requestPath,
        messageType,
        didProcess: false,
        responseSent: true,
        callId: payload?.transport?.callSid || payload?.message?.call?.id || null,
        error: null,
      });

      return res.status(200).json({ ok: true, ack: true, type: messageType });
    }

    // ============================================================
    // SLOW PATH: Process end-of-call-report only
    // ============================================================
    console.log(`[VAPI] PROCESS_EOCR end-of-call-report path: ${requestPath}`);

    let callId: string | null = null;
    let errorMsg: string | null = null;

    // ALWAYS return 200 to Vapi - wrap EVERYTHING in try/catch
    try {
      console.log("[VAPI] Time:", timestamp);
      console.log("[VAPI] Path:", requestPath);

      // Call ID can be in transport.callSid (top-level) or message.call.id (nested)
      callId = payload?.transport?.callSid || payload?.message?.call?.id || null;

      console.log("[VAPI] Call ID:", callId);
      console.log("[VAPI] transport.callSid:", payload?.transport?.callSid || "N/A");
      console.log("[VAPI] customer.number:", payload?.customer?.number || "N/A");
      console.log("[VAPI] Ended reason:", payload?.message?.endedReason || "N/A");

      // Store for debugging (truncate large fields)
      lastVapiPayload = {
        timestamp,
        type: messageType,
        callId,
        error: null,
        path: requestPath,
        body: {
          messageType,
          callId,
          transportCallSid: payload?.transport?.callSid || null,
          customerNumber: payload?.customer?.number || null,
          endedReason: payload?.message?.endedReason,
          hasSummary: !!payload?.message?.summary || !!payload?.message?.analysis?.summary,
          hasTranscript: !!payload?.message?.transcript,
          hasArtifact: !!payload?.message?.artifact,
          hasAnalysis: !!payload?.message?.analysis,
        },
      };

      // Transform and insert
      console.log("[VAPI] Transforming payload...");
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

      // Log to event buffer for debugging
      logVapiEvent({
        timestamp,
        path: requestPath,
        messageType: "end-of-call-report",
        didProcess: true,
        responseSent: true,
        callId,
        error: null,
      });

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

    } catch (outerError) {
      // CATCH-ALL: Log everything, still return 200
      console.error("[VAPI] === OUTER ERROR ===");
      console.error("[VAPI] Error:", outerError);
      console.error("[VAPI] Stack:", outerError instanceof Error ? outerError.stack : "N/A");
      errorMsg = String(outerError);
      if (lastVapiPayload) lastVapiPayload.error = errorMsg;

      // Log error to event buffer
      logVapiEvent({
        timestamp,
        path: requestPath,
        messageType: "end-of-call-report",
        didProcess: false,
        responseSent: true,
        callId,
        error: errorMsg,
      });

      // ALWAYS return 200 to stop Vapi retries
      return res.status(200).json({ ok: true, warning: "Server error occurred", error: errorMsg });
    }
  };

  // ============================================================
  // VAPI WEBHOOK ROUTES
  // ============================================================
  // PRODUCTION URL (the ONLY valid URL):
  //   https://inbot-ai-production.up.railway.app/webhook/vapi
  //
  // DO NOT USE:
  //   - Replit URLs (*.replit.dev) - will return 410 Gone
  //   - Any other domain - will return 410 Gone
  //
  // Environment variable VAPI_ALLOWED_HOST controls the guard.
  // ============================================================
  app.post("/webhook/vapi", handleVapiWebhook);
  app.post("/api/webhook/vapi", handleVapiWebhook);
  app.post("/api/webhook", handleVapiWebhook);
  app.post("/webhooks/vapi", handleVapiWebhook);
  app.post("/vapi/webhook", handleVapiWebhook);
  app.post("/vapi", handleVapiWebhook);

  console.log("[routes] Vapi webhook registered on: /webhook/vapi, /api/webhook/vapi, /api/webhook, /webhooks/vapi, /vapi/webhook, /vapi");
  console.log(`[routes] VAPI_ALLOWED_HOST=${process.env.VAPI_ALLOWED_HOST || "inbot-ai-production.up.railway.app (default)"}`);

  // MessageSid tracking to prevent duplicate records from Twilio retries
  // (NOT phone-based - same phone can send multiple messages)
  const processedMessageSids = new Set<string>();

  // Store last Twilio payload for debugging (includes extraction results and session state)
  let lastTwilioPayload: {
    timestamp: string;
    messageSid: string | null;
    from: string | null;
    body: string | null;
    error: string | null;
    guidedModeEnabled?: boolean;
    extraction?: {
      name: string;
      address: string;
      nameSource: string;
      addressSource: string;
      completeness: string;
      addressIsComplete: boolean;
    };
    session?: {
      hasName: boolean;
      hasAddress: boolean;
      hasIssue: boolean;
      askedForName: boolean;
      askedForAddress: boolean;
      messageCount: number;
      action: string;
    };
  } | null = null;

  // Debug endpoint to see last Twilio payload
  app.get("/debug/twilio-last", (_req, res) => {
    res.json(lastTwilioPayload || { message: "No Twilio webhook received yet" });
  });

  // ============================================================
  // GUIDED SMS INTAKE: Helper function to create record and classify
  // ============================================================
  async function createRecordAndClassify(
    session: SmsSession,
    fromNumber: string,
    messageSid: string,
    reason: string
  ): Promise<{ recordId: string; responseMessage: string }> {
    const { name, address, issue } = getFinalizedSessionData(session);

    console.log(`[TWILIO-GUIDED] CREATE_RECORD reason=${reason} phone=*${fromNumber.slice(-4)}`);
    console.log(`[TWILIO-GUIDED] Finalized: name=${name}, address=${address}, issue=${issue.substring(0, 50)}...`);

    const pendingRecord = {
      name,
      phone: formatPhoneNumber(fromNumber),
      address,
      intent: "Pending",
      department: "Pending",
      channel: "SMS" as const,
      language: "English",
      durationSeconds: 0,
      cost: 0.0075 * session.messageCount, // Cost per message
      timestamp: new Date().toISOString(),
      transcriptSummary: issue.substring(0, 200) || "Processing...",
      clientId: "client_demo",
    };

    const validation = insertIntakeRecordSchema.safeParse(pendingRecord);
    if (!validation.success) {
      console.error("[TWILIO-GUIDED] Validation failed:", JSON.stringify(validation.error.issues));
      throw new Error(`Validation failed: ${JSON.stringify(validation.error.issues)}`);
    }

    const newRecord = await storage.createRecord(validation.data);
    console.log(`[TWILIO-GUIDED] COMPLETE phone=*${fromNumber.slice(-4)} recordId=${newRecord.id}`);

    // Mark MessageSid as processed after successful insert
    processedMessageSids.add(messageSid);

    // Delete session after record creation
    deleteSession(fromNumber);

    // Background: classify and update
    setImmediate(async () => {
      try {
        console.log("[TWILIO-GUIDED] Background: Starting classification...");
        const classification = await classifyIntake({
          rawText: issue,
          channel: "SMS",
          clientId: "client_demo",
        });
        console.log("[TWILIO-GUIDED] Background: Classification result:", classification.intent, classification.department);

        await storage.updateRecord(newRecord.id, {
          intent: classification.intent,
          department: classification.department,
          transcriptSummary: classification.summary,
        });
        console.log("[TWILIO-GUIDED] Background: Record updated with classification");

        triggerDepartmentEmail({
          ...newRecord,
          intent: classification.intent,
          department: classification.department,
          transcriptSummary: classification.summary,
        }).catch((e) => console.error("[TWILIO-GUIDED] Background: Email failed:", e));
      } catch (bgError) {
        console.error("[TWILIO-GUIDED] Background: Classification failed:", bgError);
      }
    });

    return {
      recordId: newRecord.id,
      responseMessage: getThankYouMessage(newRecord.id),
    };
  }

  // ============================================================
  // GUIDED SMS INTAKE: Timeout handler for cleanup timer
  // ============================================================
  async function handleSessionTimeout(session: SmsSession): Promise<void> {
    const hadData = !!(session.name || session.address || session.issue);
    console.log(`[TWILIO-GUIDED] TIMEOUT_HANDLER phone=*${session.phoneNumber.slice(-4)} hadData=${hadData}`);

    if (!hadData) {
      console.log(`[TWILIO-GUIDED] TIMEOUT_SKIP no data to save`);
      return;
    }

    try {
      const { name, address, issue } = getFinalizedSessionData(session);

      const pendingRecord = {
        name,
        phone: formatPhoneNumber(session.phoneNumber),
        address,
        intent: "Pending",
        department: "Pending",
        channel: "SMS" as const,
        language: "English",
        durationSeconds: 0,
        cost: 0.0075 * session.messageCount,
        timestamp: new Date().toISOString(),
        transcriptSummary: issue.substring(0, 200) || "Abandoned session",
        clientId: "client_demo",
      };

      const validation = insertIntakeRecordSchema.safeParse(pendingRecord);
      if (!validation.success) {
        console.error("[TWILIO-GUIDED] Timeout validation failed:", JSON.stringify(validation.error.issues));
        return;
      }

      const newRecord = await storage.createRecord(validation.data);
      console.log(`[TWILIO-GUIDED] TIMEOUT_RECORD_CREATED phone=*${session.phoneNumber.slice(-4)} recordId=${newRecord.id}`);

      // Background classify
      setImmediate(async () => {
        try {
          const classification = await classifyIntake({
            rawText: issue,
            channel: "SMS",
            clientId: "client_demo",
          });

          await storage.updateRecord(newRecord.id, {
            intent: classification.intent,
            department: classification.department,
            transcriptSummary: classification.summary,
          });

          triggerDepartmentEmail({
            ...newRecord,
            intent: classification.intent,
            department: classification.department,
            transcriptSummary: classification.summary,
          }).catch(() => {});
        } catch (err) {
          console.error("[TWILIO-GUIDED] Timeout classification failed:", err);
        }
      });
    } catch (err) {
      console.error("[TWILIO-GUIDED] TIMEOUT_ERROR:", err);
    }
  }

  // Start cleanup timer for session timeouts (if guided mode enabled)
  if (isGuidedSmsEnabled()) {
    console.log("[routes] Starting SMS session cleanup timer (guided mode enabled)");
    startCleanupTimer(handleSessionTimeout);
  }

  // BULLETPROOF Twilio SMS webhook - ALWAYS returns 200/TwiML
  app.post("/webhook/twilio", async (req, res) => {
    const timestamp = new Date().toISOString();
    let messageSid: string | null = null;
    let fromNumber: string | null = null;
    let messageBody: string | null = null;
    let errorMsg: string | null = null;

    // Helper to return TwiML (always 200)
    const returnTwiml = (message?: string) => {
      res.set("Content-Type", "text/xml");
      res.status(200).send(generateTwimlResponse(message));
    };

    // ALWAYS return 200 to Twilio - wrap EVERYTHING in try/catch
    try {
      console.log("=======================================================");
      console.log("[TWILIO] WEBHOOK HIT");
      console.log("[TWILIO] Time:", timestamp);
      console.log("[TWILIO] Content-Type:", req.headers["content-type"]);
      console.log("[TWILIO] Body keys:", Object.keys(req.body || {}));
      console.log("[TWILIO] Guided mode enabled:", isGuidedSmsEnabled());

      // Check if Twilio is configured
      if (!isTwilioConfigured()) {
        console.warn("[TWILIO] Not configured - returning empty TwiML");
        lastTwilioPayload = { timestamp, messageSid: null, from: null, body: null, error: "Twilio not configured" };
        return returnTwiml();
      }

      // Parse Twilio payload
      const twilioPayload = parseTwilioPayload(req.body);
      if (!twilioPayload) {
        console.error("[TWILIO] Invalid payload - returning empty TwiML");
        lastTwilioPayload = { timestamp, messageSid: null, from: null, body: null, error: "Invalid payload" };
        return returnTwiml();
      }

      messageSid = twilioPayload.MessageSid;
      fromNumber = twilioPayload.From;
      messageBody = twilioPayload.Body;

      console.log("[TWILIO] MessageSid:", messageSid);
      console.log("[TWILIO] From:", fromNumber);
      console.log("[TWILIO] Body:", messageBody?.substring(0, 100));

      // Store for debugging
      lastTwilioPayload = {
        timestamp,
        messageSid,
        from: fromNumber,
        body: messageBody?.substring(0, 100) || null,
        error: null,
        guidedModeEnabled: isGuidedSmsEnabled(),
      };

      // IDEMPOTENCY: Check if we already processed this MessageSid (Twilio retry)
      if (processedMessageSids.has(messageSid)) {
        console.log(`[TWILIO] DUPLICATE MessageSid ${messageSid} - already processed, skipping`);
        return returnTwiml("Already received, thank you!");
      }

      // ============================================================
      // GUIDED SMS INTAKE (when feature flag enabled)
      // ============================================================
      if (isGuidedSmsEnabled()) {
        console.log("[TWILIO-GUIDED] Processing with guided flow...");

        const flowResult = await processSmsWithSession(fromNumber, messageBody || "");

        // Update debug payload with session state
        if (lastTwilioPayload) {
          lastTwilioPayload.session = {
            hasName: !!flowResult.session.name,
            hasAddress: !!flowResult.session.address,
            hasIssue: !!flowResult.session.issue,
            askedForName: flowResult.session.askedForName,
            askedForAddress: flowResult.session.askedForAddress,
            messageCount: flowResult.session.messageCount,
            action: flowResult.action,
          };
        }

        switch (flowResult.action) {
          case "ask_followup": {
            console.log(`[TWILIO-GUIDED] ASK_FOLLOWUP: ${flowResult.message}`);
            // Mark this MessageSid as processed to prevent duplicate follow-ups on retry
            processedMessageSids.add(messageSid);
            return returnTwiml(flowResult.message);
          }

          case "complete": {
            const { recordId, responseMessage } = await createRecordAndClassify(
              flowResult.session,
              fromNumber,
              messageSid,
              flowResult.reason
            );
            console.log(`[TWILIO-GUIDED] COMPLETE: recordId=${recordId}`);
            return returnTwiml(responseMessage);
          }

          case "timeout": {
            // Session timed out mid-flow - create record with what we have
            console.log(`[TWILIO-GUIDED] TIMEOUT detected during processing`);
            if (flowResult.hadData) {
              const { recordId, responseMessage } = await createRecordAndClassify(
                flowResult.session,
                fromNumber,
                messageSid,
                "timeout"
              );
              return returnTwiml(responseMessage);
            } else {
              // No data - just clear and start fresh
              deleteSession(fromNumber);
              // Reprocess as new session
              const freshResult = await processSmsWithSession(fromNumber, messageBody || "");
              if (freshResult.action === "ask_followup") {
                processedMessageSids.add(messageSid);
                return returnTwiml(freshResult.message);
              }
              // Immediate complete (all fields in first message)
              const { responseMessage } = await createRecordAndClassify(
                freshResult.session,
                fromNumber,
                messageSid,
                "all_fields"
              );
              return returnTwiml(responseMessage);
            }
          }
        }
      }

      // ============================================================
      // LEGACY SINGLE-PASS SMS INTAKE (when feature flag disabled)
      // ============================================================
      console.log("[TWILIO] Legacy single-pass flow");

      const extractionResult = await extractSmsFields(messageBody || "");
      console.log("[TWILIO] Extraction result - name:", extractionResult.name, "| source:", extractionResult.nameSource);
      console.log("[TWILIO] Extraction result - address:", extractionResult.address, "| source:", extractionResult.addressSource);
      console.log("[TWILIO] Extraction completeness:", extractionResult.completeness, "| addressIsComplete:", extractionResult.addressIsComplete);

      // Update debug payload with extraction results
      if (lastTwilioPayload) {
        lastTwilioPayload.extraction = {
          name: extractionResult.name,
          address: extractionResult.address,
          nameSource: extractionResult.nameSource,
          addressSource: extractionResult.addressSource,
          completeness: extractionResult.completeness,
          addressIsComplete: extractionResult.addressIsComplete,
        };
      }

      // INSERT FIRST with pending classification
      const pendingRecord = {
        name: extractionResult.name,
        phone: formatPhoneNumber(fromNumber),
        address: extractionResult.address,
        intent: "Pending",
        department: "Pending",
        channel: "SMS" as const,
        language: "English",
        durationSeconds: 0,
        cost: 0.0075,
        timestamp: new Date().toISOString(),
        transcriptSummary: messageBody?.substring(0, 200) || "Processing...",
        clientId: "client_demo",
      };

      // Validate
      const validation = insertIntakeRecordSchema.safeParse(pendingRecord);
      if (!validation.success) {
        console.error("[TWILIO] Validation failed:", JSON.stringify(validation.error.issues));
        errorMsg = `Validation failed: ${JSON.stringify(validation.error.issues)}`;
        lastTwilioPayload.error = errorMsg;
        // Still return 200 TwiML
        return returnTwiml("Thank you for your message.");
      }

      // INSERT into database
      console.log("[TWILIO] INSERT ATTEMPTED - calling storage.createRecord...");
      const newRecord = await storage.createRecord(validation.data);
      console.log(`[TWILIO] INSERT SUCCEEDED - ID: ${newRecord.id}`);

      // IDEMPOTENCY: Mark as processed ONLY AFTER successful insert
      processedMessageSids.add(messageSid);
      console.log(`[TWILIO] DEDUP MARKED - MessageSid ${messageSid} added to processed set`);

      // Cleanup old MessageSids (keep last 1000)
      if (processedMessageSids.size > 1000) {
        const firstSid = processedMessageSids.values().next().value;
        if (firstSid) processedMessageSids.delete(firstSid);
      }

      // Return TwiML immediately with reference ID
      returnTwiml(`Thank you for your report. Reference #${newRecord.id.substring(0, 8)}. A representative will follow up.`);

      // Background: classify and update (fire-and-forget)
      setImmediate(async () => {
        try {
          console.log("[TWILIO] Background: Starting classification...");
          const classification = await classifyIntake({
            rawText: messageBody || "",
            channel: "SMS",
            clientId: "client_demo",
          });
          console.log("[TWILIO] Background: Classification result:", classification.intent, classification.department);

          await storage.updateRecord(newRecord.id, {
            intent: classification.intent,
            department: classification.department,
            transcriptSummary: classification.summary,
          });
          console.log("[TWILIO] Background: Record updated with classification");

          triggerDepartmentEmail({
            ...newRecord,
            intent: classification.intent,
            department: classification.department,
            transcriptSummary: classification.summary,
          }).catch((e) => console.error("[TWILIO] Background: Email failed:", e));
        } catch (bgError) {
          console.error("[TWILIO] Background: Classification failed:", bgError);
        }
      });

      return;
    } catch (outerError) {
      // CATCH-ALL: Log everything, still return 200 TwiML
      console.error("[TWILIO] === OUTER ERROR ===");
      console.error("[TWILIO] Error:", outerError);
      console.error("[TWILIO] Stack:", outerError instanceof Error ? outerError.stack : "N/A");
      errorMsg = String(outerError);
      if (lastTwilioPayload) lastTwilioPayload.error = errorMsg;

      // ALWAYS return 200 TwiML to stop Twilio retries
      return returnTwiml("Thank you for your message.");
    }
  });

  // ============================================================
  // DEBUG ENDPOINTS: SMS Session Management
  // ============================================================

  // List all active sessions (phone last 4 digits only)
  app.get("/debug/sms-sessions", (_req, res) => {
    const sessions = getAllActiveSessions();
    res.json({
      guidedModeEnabled: isGuidedSmsEnabled(),
      count: sessions.length,
      maxSessions: 10000,
      sessionTtlMs: 20 * 60 * 1000,
      sessions,
    });
  });

  // Lookup specific session by phone number
  app.get("/debug/sms-session/:phone", (req, res) => {
    const phone = req.params.phone;
    const session = getSessionDebugInfo(phone);

    if (session) {
      res.json({ found: true, session });
    } else {
      res.json({ found: false, phone: phone.slice(-4) });
    }
  });

  // Manual session clear
  app.delete("/debug/sms-session/:phone", (req, res) => {
    const phone = req.params.phone;
    const deleted = clearSession(phone);
    res.json({ deleted, phone: phone.slice(-4) });
  });

  return httpServer;
}
