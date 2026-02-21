/**
 * Department Email Routing
 *
 * Sends notification emails to department contacts after interaction records are created.
 * Fire-and-forget: never blocks record insertion, logs all attempts.
 */

import { Resend } from "resend";
import type { IntakeRecord } from "@shared/schema";
import type { VapiCallMetadata } from "./vapi-transform";
import { generateRecordingToken } from "./recording-token";

// Resend client - instantiated lazily when sending email
let resendClient: Resend | null = null;

function getResendClient(): Resend | null {
  if (!process.env.RESEND_API_KEY) {
    return null;
  }
  if (!resendClient) {
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }
  return resendClient;
}

// Sender email (must be verified in Resend dashboard)
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || "InBot AI <notifications@xpandai.com>";

export interface DepartmentEmailConfig {
  email: string;
  cc_email: string | null;
}

export interface EmailSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

/**
 * Format interaction data into email content
 *
 * Phase 4 Hardening: Reordered layout for clarity and actionability.
 * Layout order: Issue Summary → Caller details → Intent/Dept → Warning (if needed) → Recording → Transcript
 * Warning logic expanded: triggers on missing data or abnormal call ending, not just analysisSuccess.
 *
 * @param record - The intake record
 * @param callMetadata - Optional call metadata with recording URL and transcript (Voice only)
 */
function formatEmailContent(
  record: IntakeRecord,
  callMetadata?: VapiCallMetadata
): { subject: string; html: string; text: string } {
  const subject = `[${record.department}] New Intake: ${record.name}`;

  // Format timestamp in Eastern Time (America/New_York) for municipal staff
  const timestamp = new Date(record.timestamp).toLocaleString("en-US", {
    timeZone: "America/New_York",
    dateStyle: "medium",
    timeStyle: "short",
  }) + " ET";

  console.log(`[email] Timestamp raw: ${record.timestamp}, formatted ET: ${timestamp}`);

  // Build recording section (Voice only, if URL present)
  // Links route through inbot.ai proxy — never expose raw Vapi URLs in emails
  const hasRecording = record.channel === "Voice" &&
    (callMetadata?.recordingUrl || callMetadata?.stereoRecordingUrl);

  let recordingHtml = "";
  let recordingText = "";

  if (hasRecording) {
    const baseUrl = process.env.APP_URL || `https://${process.env.RAILWAY_PUBLIC_DOMAIN || "inbot-ai-production.up.railway.app"}`;
    const token = generateRecordingToken(record.id);
    const recordingLink = `${baseUrl}/api/recordings/${record.id}?tok=${token}`;

    recordingHtml = `
      <div style="background: #f0fdf4; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #22c55e;">
        <h3 style="margin: 0 0 10px 0; color: #1a1a1a;">Call Recording</h3>
        <p style="margin: 0;">
          <a href="${recordingLink}" style="color: #16a34a; text-decoration: underline; font-weight: 500;">
            Listen to Call Recording
          </a>
        </p>
      </div>
    `;

    recordingText = `\nCall Recording:\n${recordingLink}\n`;
  }

  // Build transcript section (Voice only, if transcript present)
  const transcript = callMetadata?.transcript;
  const transcriptPreview = transcript ? transcript.substring(0, 500) : null;
  const transcriptHtml = (record.channel === "Voice" && transcriptPreview) ? `
      <div style="background: #fef3c7; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #f59e0b;">
        <h3 style="margin: 0 0 10px 0; color: #1a1a1a;">Call Transcript</h3>
        <pre style="margin: 0; white-space: pre-wrap; word-wrap: break-word; font-family: inherit; font-size: 14px; color: #374151; background: #fffbeb; padding: 10px; border-radius: 4px;">${transcriptPreview}${transcript && transcript.length > 500 ? "..." : ""}</pre>
      </div>
  ` : "";

  const transcriptText = (record.channel === "Voice" && transcriptPreview)
    ? `\nCall Transcript (first 500 chars):\n${transcriptPreview}${transcript && transcript.length > 500 ? "..." : ""}\n`
    : "";

  // ============================================================
  // Review advisory: gated by the persisted needsReview flag
  // (computed at insert time by deriveNeedsReview with full context).
  // Reasons are still enumerated for descriptive bullet points.
  // ============================================================
  const showReviewAdvisory = record.needsReview;

  const reviewReasons: string[] = [];
  if (showReviewAdvisory) {
    const addressMissing = !record.address || record.address === "Not provided" || record.address.trim() === "";
    const nameMissing = !record.name || record.name === "Not provided" || record.name === "Unknown Caller" || record.name.trim() === "";
    const callEndedAbnormally = record.channel === "Voice" && callMetadata
      && !["customer-ended-call", "assistant-ended-call", "silence-timed-out",
           "customer-did-not-give-microphone-permission", "assistant-said-end-call-phrase"]
        .includes(callMetadata.endedReason);
    const analysisFailed = record.channel === "Voice" && callMetadata
      && !callMetadata.analysisSuccess;

    if (addressMissing) reviewReasons.push("No address was captured.");
    if (nameMissing) reviewReasons.push("Caller name was not identified.");
    if (callEndedAbnormally) reviewReasons.push(`Call ended unexpectedly (${callMetadata?.endedReason || "unknown"}).`);
    if (analysisFailed && !callEndedAbnormally) reviewReasons.push("Call analysis did not complete successfully.");
    // Fallback if flag was set by a condition we don't enumerate here
    if (reviewReasons.length === 0) reviewReasons.push("This record was flagged for review.");
  }

  console.log(`[email] Review advisory: show=${showReviewAdvisory}, reasons=${JSON.stringify(reviewReasons)}`);

  const reviewAdvisoryHtml = showReviewAdvisory ? `
      <div style="background: #fffbeb; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #f59e0b;">
        <h3 style="margin: 0 0 10px 0; color: #1a1a1a;">Note: Some details may need verification</h3>
        <ul style="margin: 0; padding-left: 20px; color: #374151;">
          ${reviewReasons.map(r => `<li style="margin: 4px 0;">${r}</li>`).join("\n          ")}
        </ul>
      </div>
  ` : "";

  const reviewAdvisoryText = showReviewAdvisory
    ? `\nNote: Some details may need verification\n${reviewReasons.map(r => `- ${r}`).join("\n")}\n`
    : "";

  // ============================================================
  // Phase 4 Hardening: Reordered email layout
  // 1. Issue Summary (top — most actionable info)
  // 2. Caller details table (with Intent + Department)
  // 3. Review advisory (only if triggered)
  // 4. Call recording
  // 5. Call transcript
  // 6. Footer
  // ============================================================

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #1a1a1a; border-bottom: 2px solid #3b82f6; padding-bottom: 10px;">
        New Intake Report
      </h2>

      <div style="background: #f0f9ff; padding: 15px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #3b82f6;">
        <h3 style="margin: 0 0 10px 0; color: #1a1a1a;">Issue Summary</h3>
        <p style="margin: 0; color: #374151; font-size: 15px;">${record.transcriptSummary || "No summary available"}</p>
      </div>

      <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        <tr>
          <td style="padding: 8px 0; color: #666; width: 140px;">Caller Name:</td>
          <td style="padding: 8px 0; font-weight: 500;">${record.name}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666;">Phone:</td>
          <td style="padding: 8px 0;">${record.phone}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666;">Address:</td>
          <td style="padding: 8px 0;">${record.address || "Not provided"}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666;">Issue Type:</td>
          <td style="padding: 8px 0;">${record.intent}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666;">Department:</td>
          <td style="padding: 8px 0; font-weight: bold;">${record.department}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666;">Timestamp:</td>
          <td style="padding: 8px 0;">${timestamp}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666;">Channel:</td>
          <td style="padding: 8px 0;">${record.channel}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666;">Language:</td>
          <td style="padding: 8px 0;">${record.language}</td>
        </tr>
        <tr>
          <td style="padding: 8px 0; color: #666;">Duration:</td>
          <td style="padding: 8px 0;">${Math.round(record.durationSeconds / 60)} min ${record.durationSeconds % 60} sec</td>
        </tr>
      </table>

      ${reviewAdvisoryHtml}

      ${recordingHtml}

      ${transcriptHtml}

      <p style="color: #9ca3af; font-size: 12px; margin-top: 30px; border-top: 1px solid #e5e7eb; padding-top: 15px;">
        This email was automatically generated by InBot AI. Record ID: ${record.id}
      </p>
    </div>
  `;

  const text = `
New Intake Report
=================

Issue Summary:
${record.transcriptSummary || "No summary available"}

Caller Name: ${record.name}
Phone: ${record.phone}
Address: ${record.address || "Not provided"}
Issue Type: ${record.intent}
Department: ${record.department}
Timestamp: ${timestamp}
Channel: ${record.channel}
Language: ${record.language}
Duration: ${Math.round(record.durationSeconds / 60)} min ${record.durationSeconds % 60} sec
${reviewAdvisoryText}${recordingText}${transcriptText}
---
Record ID: ${record.id}
  `.trim();

  return { subject, html, text };
}

/**
 * Send department notification email
 * Returns result immediately, never throws
 * @param record - The intake record to notify about
 * @param config - Email configuration for the department
 * @param callMetadata - Optional Vapi call metadata with recording/transcript (Voice only)
 */
export async function sendDepartmentEmail(
  record: IntakeRecord,
  config: DepartmentEmailConfig,
  callMetadata?: VapiCallMetadata
): Promise<EmailSendResult> {
  // Get Resend client (lazy initialization)
  const resend = getResendClient();
  if (!resend) {
    console.warn("[email] RESEND_API_KEY not configured, skipping email send");
    return { success: false, error: "RESEND_API_KEY not configured" };
  }

  try {
    const { subject, html, text } = formatEmailContent(record, callMetadata);

    const recipients = [config.email];
    const ccRecipients = config.cc_email ? [config.cc_email] : undefined;

    console.log(`[email] Sending to ${config.email}${config.cc_email ? ` (CC: ${config.cc_email})` : ""}`);

    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: recipients,
      cc: ccRecipients,
      subject,
      html,
      text,
    });

    if (error) {
      console.error("[email] Resend error:", error);
      return { success: false, error: error.message };
    }

    console.log(`[email] Sent successfully, message ID: ${data?.id}`);
    return { success: true, messageId: data?.id };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error("[email] Exception:", errorMessage);
    return { success: false, error: errorMessage };
  }
}

/**
 * Map unknown departments to known categories
 * Any unrecognized department falls back to "General"
 */
export function normalizeDepartment(department: string): string {
  const knownDepartments = [
    "Public Works",
    "Public Safety",
    "Finance",
    "Parks & Public Property",
    "Parks & Recreation",
    "Sanitation",
    "Utilities",
    "Planning and Zoning",
    "General",
  ];

  // Exact match
  if (knownDepartments.includes(department)) {
    return department;
  }

  // Case-insensitive match
  const normalized = knownDepartments.find(
    (d) => d.toLowerCase() === department.toLowerCase()
  );
  if (normalized) {
    return normalized;
  }

  // Fallback to General
  console.log(`[email] Unknown department "${department}", mapping to "General"`);
  return "General";
}
