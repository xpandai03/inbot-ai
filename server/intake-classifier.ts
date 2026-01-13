/**
 * Internal AI Intake Classifier
 *
 * LLM-powered classification for intent and department.
 * Uses OpenAI gpt-4o-mini for cost-efficient classification.
 * Falls back to regex-based classification if LLM fails.
 */

import OpenAI from "openai";

// Lazy-initialized OpenAI client
let openaiClient: OpenAI | null = null;

function getOpenAIClient(): OpenAI | null {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return openaiClient;
}

// Classification input/output interfaces
export interface ClassificationInput {
  rawText: string;
  channel: "Voice" | "SMS";
  clientId?: string;
}

export interface ClassificationOutput {
  intent: string;
  department: string;
  summary: string;
}

// Hardcoded Phase 1 categories
export const INTENT_CATEGORIES = [
  "Pothole / Road Damage",
  "Streetlight Issue",
  "Water / Utilities",
  "Trash / Sanitation",
  "Billing / Payment",
  "General Inquiry",
] as const;

export const DEPARTMENT_CATEGORIES = [
  "Public Works",
  "Public Safety",
  "Finance",
  "Parks & Recreation",
  "Sanitation",
  "General",
] as const;

// System prompt for classification
const CLASSIFICATION_PROMPT = `You are a municipal intake classifier. Given citizen input, classify into exactly one intent and one department.

INTENT (choose exactly one):
- Pothole / Road Damage
- Streetlight Issue
- Water / Utilities
- Trash / Sanitation
- Billing / Payment
- General Inquiry

DEPARTMENT (choose exactly one):
- Public Works
- Public Safety
- Finance
- Parks & Recreation
- Sanitation
- General

Respond with JSON only, no markdown: {"intent": "...", "department": "...", "summary": "..."}
The summary should be 1 sentence describing the citizen's issue.

If the input is unclear or doesn't fit any category, use "General Inquiry" for intent and "General" for department.`;

/**
 * Classify intake using LLM
 */
async function classifyWithLLM(input: ClassificationInput): Promise<ClassificationOutput | null> {
  const client = getOpenAIClient();
  if (!client) {
    console.log("[classifier] OpenAI client not available, skipping LLM classification");
    return null;
  }

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: CLASSIFICATION_PROMPT },
        { role: "user", content: `Channel: ${input.channel}\n\nCitizen input:\n${input.rawText}` },
      ],
      temperature: 0,
      max_tokens: 200,
      response_format: { type: "json_object" },
    });

    const content = response.choices[0]?.message?.content;
    if (!content) {
      console.error("[classifier] Empty response from OpenAI");
      return null;
    }

    const parsed = JSON.parse(content) as {
      intent?: string;
      department?: string;
      summary?: string;
    };

    // Validate response has required fields
    if (!parsed.intent || !parsed.department || !parsed.summary) {
      console.error("[classifier] Invalid response structure:", parsed);
      return null;
    }

    // Validate intent is in allowed list
    const validIntent = INTENT_CATEGORIES.includes(parsed.intent as typeof INTENT_CATEGORIES[number])
      ? parsed.intent
      : "General Inquiry";

    // Validate department is in allowed list
    const validDepartment = DEPARTMENT_CATEGORIES.includes(parsed.department as typeof DEPARTMENT_CATEGORIES[number])
      ? parsed.department
      : "General";

    console.log("[classifier] LLM classification:", { intent: validIntent, department: validDepartment });

    return {
      intent: validIntent,
      department: validDepartment,
      summary: parsed.summary,
    };
  } catch (error) {
    console.error("[classifier] LLM classification error:", error);
    return null;
  }
}

/**
 * Fallback regex-based classification (from vapi-transform.ts)
 */
function classifyWithRegex(rawText: string): ClassificationOutput {
  const text = rawText.toLowerCase();

  // Intent classification
  let intent = "General Inquiry";
  if (/pothole|road\s*(damage|repair|broken|crack)|street\s*(damage|broken|crack)|pavement|asphalt|bump|crater/.test(text)) {
    intent = "Pothole / Road Damage";
  } else if (/street\s*light|lamp\s*post|light\s*(out|broken|not working|flickering)|dark\s*street|lighting/.test(text)) {
    intent = "Streetlight Issue";
  } else if (/water|utility|utilities|pipe|leak|flood|hydrant|sewer|drain|gas|electric/.test(text)) {
    intent = "Water / Utilities";
  } else if (/trash|garbage|waste|recycl|pickup|collection|litter|dump|sanitation|bin|container/.test(text)) {
    intent = "Trash / Sanitation";
  } else if (/bill|billing|payment|pay|invoice|charge|fee|tax|account|balance|overdue/.test(text)) {
    intent = "Billing / Payment";
  }

  // Department classification
  let department = "General";
  if (/pothole|road|street|sidewalk|light|lamp|traffic|sign|drain|sewer|water main|pavement/.test(text)) {
    department = "Public Works";
  } else if (/safety|emergency|crime|police|fire|danger|accident|threat|suspicious/.test(text)) {
    department = "Public Safety";
  } else if (/tax|bill|payment|fee|permit|license|fine|revenue/.test(text)) {
    department = "Finance";
  } else if (/park|playground|recreation|facility|building|property/.test(text)) {
    department = "Parks & Recreation";
  } else if (/trash|garbage|pickup|collection|waste|recycl/.test(text)) {
    department = "Sanitation";
  }

  // Simple summary
  const summary = rawText.length > 100
    ? rawText.substring(0, 100) + "..."
    : rawText || "No description provided";

  console.log("[classifier] Regex fallback classification:", { intent, department });

  return { intent, department, summary };
}

/**
 * Main classification function
 *
 * Attempts LLM classification first, falls back to regex on failure.
 * Timeout: 3 seconds for LLM call.
 */
export async function classifyIntake(input: ClassificationInput): Promise<ClassificationOutput> {
  console.log("[classifier] Classifying intake:", { channel: input.channel, textLength: input.rawText.length });

  // Try LLM classification with timeout
  try {
    const timeoutPromise = new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), 3000);
    });

    const llmResult = await Promise.race([
      classifyWithLLM(input),
      timeoutPromise,
    ]);

    if (llmResult) {
      return llmResult;
    }

    console.log("[classifier] LLM timed out or failed, using regex fallback");
  } catch (error) {
    console.error("[classifier] Unexpected error, using regex fallback:", error);
  }

  // Fallback to regex
  return classifyWithRegex(input.rawText);
}
