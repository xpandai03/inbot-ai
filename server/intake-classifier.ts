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

// ============================================================
// REGEX FALLBACK CLASSIFICATION (Phase 3 Remediation - Fix 5)
// ============================================================
// Context-aware patterns to reduce misclassification from keyword collision
// Patterns are ordered by specificity (most specific first)
// ============================================================

// Intent patterns with context (prevents "water pooling in pothole" → Water/Utilities)
const INTENT_PATTERNS: Array<{ pattern: RegExp; intent: string; priority: number }> = [
  // POTHOLE / ROAD DAMAGE - High priority, very specific
  // Direct mentions of road damage
  { pattern: /pothole/i, intent: "Pothole / Road Damage", priority: 100 },
  { pattern: /road\s*(damage|repair|broken|crack|issue|problem|condition)/i, intent: "Pothole / Road Damage", priority: 95 },
  { pattern: /street\s*(damage|broken|crack|condition|repair)/i, intent: "Pothole / Road Damage", priority: 95 },
  { pattern: /(pavement|asphalt|roadway)\s*(crack|damage|broken|hole|issue)/i, intent: "Pothole / Road Damage", priority: 90 },
  { pattern: /crater\s*(in|on)\s*(the\s*)?(road|street)/i, intent: "Pothole / Road Damage", priority: 90 },
  { pattern: /bump\s*(in|on)\s*(the\s*)?(road|street)/i, intent: "Pothole / Road Damage", priority: 85 },
  { pattern: /hole\s*(in|on)\s*(the\s*)?(road|street|pavement)/i, intent: "Pothole / Road Damage", priority: 85 },

  // STREETLIGHT ISSUE - Specific to lighting
  { pattern: /street\s*light/i, intent: "Streetlight Issue", priority: 90 },
  { pattern: /lamp\s*post/i, intent: "Streetlight Issue", priority: 90 },
  { pattern: /light\s*(pole|post)/i, intent: "Streetlight Issue", priority: 90 },
  { pattern: /light\s*(is\s*)?(out|broken|not\s*working|flickering|dim)/i, intent: "Streetlight Issue", priority: 85 },
  { pattern: /dark\s*street/i, intent: "Streetlight Issue", priority: 80 },
  { pattern: /(street|road|sidewalk)\s*(is\s*)?dark/i, intent: "Streetlight Issue", priority: 80 },
  { pattern: /no\s*(street\s*)?light/i, intent: "Streetlight Issue", priority: 75 },

  // WATER / UTILITIES - Require utility-specific context words
  // Prevents "water pooling" from matching (pooling is not a utility issue word)
  { pattern: /water\s*(main|line|pipe|meter|pressure|service|shut|leak|break|burst)/i, intent: "Water / Utilities", priority: 90 },
  { pattern: /(fire\s*)?hydrant/i, intent: "Water / Utilities", priority: 90 },
  { pattern: /sewer\s*(line|backup|overflow|smell|issue|problem)/i, intent: "Water / Utilities", priority: 90 },
  { pattern: /(gas|electric)\s*(leak|outage|issue|problem|smell)/i, intent: "Water / Utilities", priority: 90 },
  { pattern: /utility\s*(issue|problem|outage|bill)/i, intent: "Water / Utilities", priority: 85 },
  { pattern: /pipe\s*(leak|burst|broken|freeze|frozen)/i, intent: "Water / Utilities", priority: 85 },
  { pattern: /(storm\s*)?drain\s*(clog|block|backup|overflow)/i, intent: "Water / Utilities", priority: 80 },
  { pattern: /flood(ing|ed)?\s*(from|in|my)/i, intent: "Water / Utilities", priority: 75 },
  { pattern: /no\s*(water|power|electricity|gas)/i, intent: "Water / Utilities", priority: 85 },

  // TRASH / SANITATION - Specific to waste collection
  { pattern: /trash\s*(pickup|collection|not\s*picked|missed|schedule)/i, intent: "Trash / Sanitation", priority: 90 },
  { pattern: /garbage\s*(pickup|collection|not\s*picked|missed|truck)/i, intent: "Trash / Sanitation", priority: 90 },
  { pattern: /recycl(e|ing)\s*(pickup|bin|container|collection)/i, intent: "Trash / Sanitation", priority: 90 },
  { pattern: /missed\s*(trash|garbage|recycl|pickup|collection)/i, intent: "Trash / Sanitation", priority: 90 },
  { pattern: /(trash|garbage|waste)\s*(bin|can|container|dumpster)/i, intent: "Trash / Sanitation", priority: 85 },
  { pattern: /illegal\s*dump/i, intent: "Trash / Sanitation", priority: 85 },
  { pattern: /litter(ing)?\s*(on|in|around)/i, intent: "Trash / Sanitation", priority: 75 },
  { pattern: /bulk\s*(trash|pickup|waste|item)/i, intent: "Trash / Sanitation", priority: 80 },

  // BILLING / PAYMENT - Financial terms with context
  { pattern: /(water|utility|trash|tax)\s*bill/i, intent: "Billing / Payment", priority: 90 },
  { pattern: /bill\s*(question|issue|problem|too\s*high|incorrect|wrong)/i, intent: "Billing / Payment", priority: 90 },
  { pattern: /payment\s*(plan|option|issue|problem|arrangement)/i, intent: "Billing / Payment", priority: 90 },
  { pattern: /pay\s*(my\s*)?(bill|balance|account)/i, intent: "Billing / Payment", priority: 85 },
  { pattern: /overdue\s*(bill|payment|balance|account)/i, intent: "Billing / Payment", priority: 85 },
  { pattern: /(late|past\s*due)\s*(fee|charge|payment)/i, intent: "Billing / Payment", priority: 85 },
  { pattern: /account\s*(balance|statement|issue)/i, intent: "Billing / Payment", priority: 80 },
  { pattern: /invoice\s*(question|issue|problem)/i, intent: "Billing / Payment", priority: 80 },
];

// Department patterns with context
const DEPARTMENT_PATTERNS: Array<{ pattern: RegExp; department: string; priority: number }> = [
  // PUBLIC WORKS - Infrastructure
  { pattern: /pothole|road\s*(damage|repair|issue)|street\s*(damage|repair)/i, department: "Public Works", priority: 100 },
  { pattern: /sidewalk|curb|pavement|asphalt/i, department: "Public Works", priority: 90 },
  { pattern: /street\s*light|lamp\s*post|light\s*pole/i, department: "Public Works", priority: 90 },
  { pattern: /traffic\s*(light|sign|signal)/i, department: "Public Works", priority: 90 },
  { pattern: /storm\s*drain|sewer|water\s*main/i, department: "Public Works", priority: 85 },
  { pattern: /road\s*(sign|marking|line)/i, department: "Public Works", priority: 80 },

  // PUBLIC SAFETY - Emergency/safety issues
  { pattern: /emergency|911/i, department: "Public Safety", priority: 100 },
  { pattern: /police|crime|theft|break\s*in/i, department: "Public Safety", priority: 95 },
  { pattern: /fire\s*(department|hazard|danger)/i, department: "Public Safety", priority: 95 },
  { pattern: /danger(ous)?\s*(condition|situation|area)/i, department: "Public Safety", priority: 90 },
  { pattern: /accident|collision|crash/i, department: "Public Safety", priority: 85 },
  { pattern: /suspicious\s*(person|activity|vehicle)/i, department: "Public Safety", priority: 85 },
  { pattern: /threat|assault|violence/i, department: "Public Safety", priority: 90 },

  // FINANCE - Financial matters
  { pattern: /(property|city|county)\s*tax/i, department: "Finance", priority: 95 },
  { pattern: /(water|utility|trash)\s*bill/i, department: "Finance", priority: 90 },
  { pattern: /payment\s*(plan|option|arrangement)/i, department: "Finance", priority: 90 },
  { pattern: /permit\s*(fee|application|cost)/i, department: "Finance", priority: 85 },
  { pattern: /license\s*(fee|renewal|cost)/i, department: "Finance", priority: 85 },
  { pattern: /fine|citation|penalty/i, department: "Finance", priority: 80 },

  // PARKS & RECREATION - Parks and facilities
  { pattern: /park\s*(issue|problem|damage|maintenance)/i, department: "Parks & Recreation", priority: 90 },
  { pattern: /playground\s*(issue|broken|damage|unsafe)/i, department: "Parks & Recreation", priority: 90 },
  { pattern: /recreation\s*(center|facility|program)/i, department: "Parks & Recreation", priority: 90 },
  { pattern: /community\s*(center|pool|facility)/i, department: "Parks & Recreation", priority: 85 },
  { pattern: /trail\s*(issue|damage|maintenance)/i, department: "Parks & Recreation", priority: 80 },
  { pattern: /sports\s*(field|court|facility)/i, department: "Parks & Recreation", priority: 80 },

  // SANITATION - Waste management
  { pattern: /trash\s*(pickup|collection|missed)/i, department: "Sanitation", priority: 95 },
  { pattern: /garbage\s*(pickup|collection|truck)/i, department: "Sanitation", priority: 95 },
  { pattern: /recycl(e|ing)\s*(pickup|bin|collection)/i, department: "Sanitation", priority: 95 },
  { pattern: /waste\s*(collection|pickup|management)/i, department: "Sanitation", priority: 90 },
  { pattern: /bulk\s*(pickup|trash|item)/i, department: "Sanitation", priority: 85 },
  { pattern: /dumpster|compost/i, department: "Sanitation", priority: 80 },
];

/**
 * Fallback regex-based classification with context-aware patterns
 * Patterns require context words to reduce misclassification
 */
function classifyWithRegex(rawText: string): ClassificationOutput {
  const text = rawText.toLowerCase();

  // Find best matching intent (highest priority match)
  let intent = "General Inquiry";
  let bestIntentPriority = 0;

  for (const { pattern, intent: matchIntent, priority } of INTENT_PATTERNS) {
    if (priority > bestIntentPriority && pattern.test(text)) {
      intent = matchIntent;
      bestIntentPriority = priority;
      console.log(`[classifier] Intent pattern matched: "${pattern.source}" → ${matchIntent} (priority: ${priority})`);
    }
  }

  // Find best matching department (highest priority match)
  let department = "General";
  let bestDeptPriority = 0;

  for (const { pattern, department: matchDept, priority } of DEPARTMENT_PATTERNS) {
    if (priority > bestDeptPriority && pattern.test(text)) {
      department = matchDept;
      bestDeptPriority = priority;
      console.log(`[classifier] Department pattern matched: "${pattern.source}" → ${matchDept} (priority: ${priority})`);
    }
  }

  // Simple summary
  const summary = rawText.length > 100
    ? rawText.substring(0, 100) + "..."
    : rawText || "No description provided";

  console.log("[classifier] Regex fallback classification:", { intent, department, intentPriority: bestIntentPriority, deptPriority: bestDeptPriority });

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
