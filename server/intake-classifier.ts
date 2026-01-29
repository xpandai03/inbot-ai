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
  "Safety Concern / Suspicious Activity",  // Phase 2: Added for crime/safety reports
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
- Safety Concern / Suspicious Activity
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

Use "Safety Concern / Suspicious Activity" for crime reports, suspicious persons, break-ins, vandalism, trespassing, or safety hazards. Route these to "Public Safety".

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
// Phase 1 Spanish Hardening: Added Spanish keyword patterns
const INTENT_PATTERNS: Array<{ pattern: RegExp; intent: string; priority: number }> = [
  // POTHOLE / ROAD DAMAGE - High priority, very specific
  // Direct mentions of road damage (English)
  { pattern: /pothole/i, intent: "Pothole / Road Damage", priority: 100 },
  { pattern: /road\s*(damage|repair|broken|crack|issue|problem|condition)/i, intent: "Pothole / Road Damage", priority: 95 },
  { pattern: /street\s*(damage|broken|crack|condition|repair)/i, intent: "Pothole / Road Damage", priority: 95 },
  { pattern: /(pavement|asphalt|roadway)\s*(crack|damage|broken|hole|issue)/i, intent: "Pothole / Road Damage", priority: 90 },
  { pattern: /crater\s*(in|on)\s*(the\s*)?(road|street)/i, intent: "Pothole / Road Damage", priority: 90 },
  { pattern: /bump\s*(in|on)\s*(the\s*)?(road|street)/i, intent: "Pothole / Road Damage", priority: 85 },
  { pattern: /hole\s*(in|on)\s*(the\s*)?(road|street|pavement)/i, intent: "Pothole / Road Damage", priority: 85 },
  // Spanish: pothole / road damage
  { pattern: /bache/i, intent: "Pothole / Road Damage", priority: 100 },  // pothole
  { pattern: /hoyo\s*(en\s*)?(la\s*)?(calle|carretera|camino)/i, intent: "Pothole / Road Damage", priority: 95 },  // hole in the street
  { pattern: /calle\s*(dañada|rota|en\s*mal\s*estado)/i, intent: "Pothole / Road Damage", priority: 90 },  // damaged/broken street
  { pattern: /pavimento\s*(dañado|roto|agrietado)/i, intent: "Pothole / Road Damage", priority: 90 },  // damaged pavement
  { pattern: /carretera\s*(dañada|en\s*mal\s*estado)/i, intent: "Pothole / Road Damage", priority: 85 },  // damaged road

  // STREETLIGHT ISSUE - Specific to lighting
  // English
  { pattern: /street\s*light/i, intent: "Streetlight Issue", priority: 90 },
  { pattern: /lamp\s*post/i, intent: "Streetlight Issue", priority: 90 },
  { pattern: /light\s*(pole|post)/i, intent: "Streetlight Issue", priority: 90 },
  { pattern: /light\s*(is\s*)?(out|broken|not\s*working|flickering|dim)/i, intent: "Streetlight Issue", priority: 85 },
  { pattern: /dark\s*street/i, intent: "Streetlight Issue", priority: 80 },
  { pattern: /(street|road|sidewalk)\s*(is\s*)?dark/i, intent: "Streetlight Issue", priority: 80 },
  { pattern: /no\s*(street\s*)?light/i, intent: "Streetlight Issue", priority: 75 },
  // Spanish: streetlight
  { pattern: /luz\s*(de\s*(la\s*)?)?calle/i, intent: "Streetlight Issue", priority: 90 },  // streetlight
  { pattern: /poste\s*(de\s*)?luz/i, intent: "Streetlight Issue", priority: 90 },  // light post
  { pattern: /l[aá]mpara\s*(de\s*)?(la\s*)?(calle|poste)/i, intent: "Streetlight Issue", priority: 90 },  // street lamp
  { pattern: /alumbrado\s*(p[uú]blico)?/i, intent: "Streetlight Issue", priority: 85 },  // public lighting
  { pattern: /farol/i, intent: "Streetlight Issue", priority: 85 },  // lamp/lantern
  { pattern: /calle\s*(est[aá]\s*)?(oscura|sin\s*luz)/i, intent: "Streetlight Issue", priority: 80 },  // dark street
  { pattern: /no\s*hay\s*luz/i, intent: "Streetlight Issue", priority: 75 },  // no light

  // WATER / UTILITIES - Require utility-specific context words
  // Prevents "water pooling" from matching (pooling is not a utility issue word)
  // English
  { pattern: /water\s*(main|line|pipe|meter|pressure|service|shut|leak|break|burst)/i, intent: "Water / Utilities", priority: 90 },
  { pattern: /(fire\s*)?hydrant/i, intent: "Water / Utilities", priority: 90 },
  { pattern: /sewer\s*(line|backup|overflow|smell|issue|problem)/i, intent: "Water / Utilities", priority: 90 },
  { pattern: /(gas|electric)\s*(leak|outage|issue|problem|smell)/i, intent: "Water / Utilities", priority: 90 },
  { pattern: /utility\s*(issue|problem|outage|bill)/i, intent: "Water / Utilities", priority: 85 },
  { pattern: /pipe\s*(leak|burst|broken|freeze|frozen)/i, intent: "Water / Utilities", priority: 85 },
  { pattern: /(storm\s*)?drain\s*(clog|block|backup|overflow)/i, intent: "Water / Utilities", priority: 80 },
  { pattern: /flood(ing|ed)?\s*(from|in|my)/i, intent: "Water / Utilities", priority: 75 },
  { pattern: /no\s*(water|power|electricity|gas)/i, intent: "Water / Utilities", priority: 85 },
  // Spanish: water/utilities
  { pattern: /tuber[ií]a\s*(rota|da[ñn]ada|con\s*fuga)/i, intent: "Water / Utilities", priority: 90 },  // broken/leaking pipe
  { pattern: /fuga\s*(de\s*)?(agua|gas)/i, intent: "Water / Utilities", priority: 90 },  // water/gas leak
  { pattern: /alcantarilla/i, intent: "Water / Utilities", priority: 90 },  // sewer
  { pattern: /hidrante/i, intent: "Water / Utilities", priority: 90 },  // hydrant
  { pattern: /no\s*hay\s*(agua|luz|gas)/i, intent: "Water / Utilities", priority: 85 },  // no water/power/gas
  { pattern: /medidor\s*(de\s*)?(agua|luz|gas)/i, intent: "Water / Utilities", priority: 85 },  // water/electric/gas meter
  { pattern: /corte\s*(de\s*)?(agua|luz|gas)/i, intent: "Water / Utilities", priority: 85 },  // service cut

  // TRASH / SANITATION - Specific to waste collection
  // English
  { pattern: /trash\s*(pickup|collection|not\s*picked|missed|schedule)/i, intent: "Trash / Sanitation", priority: 90 },
  { pattern: /garbage\s*(pickup|collection|not\s*picked|missed|truck)/i, intent: "Trash / Sanitation", priority: 90 },
  { pattern: /recycl(e|ing)\s*(pickup|bin|container|collection)/i, intent: "Trash / Sanitation", priority: 90 },
  { pattern: /missed\s*(trash|garbage|recycl|pickup|collection)/i, intent: "Trash / Sanitation", priority: 90 },
  { pattern: /(trash|garbage|waste)\s*(bin|can|container|dumpster)/i, intent: "Trash / Sanitation", priority: 85 },
  { pattern: /illegal\s*dump/i, intent: "Trash / Sanitation", priority: 85 },
  { pattern: /litter(ing)?\s*(on|in|around)/i, intent: "Trash / Sanitation", priority: 75 },
  { pattern: /bulk\s*(trash|pickup|waste|item)/i, intent: "Trash / Sanitation", priority: 80 },
  // Spanish: trash/sanitation
  { pattern: /basura/i, intent: "Trash / Sanitation", priority: 95 },  // trash/garbage
  { pattern: /recoger\s*(la\s*)?basura/i, intent: "Trash / Sanitation", priority: 90 },  // trash pickup
  { pattern: /recolecci[oó]n\s*(de\s*)?(basura|desechos)/i, intent: "Trash / Sanitation", priority: 90 },  // trash collection
  { pattern: /cami[oó]n\s*(de\s*)?(la\s*)?basura/i, intent: "Trash / Sanitation", priority: 90 },  // garbage truck
  { pattern: /no\s*(pas[oó]|vino)\s*(el\s*)?(cami[oó]n|la\s*basura)/i, intent: "Trash / Sanitation", priority: 90 },  // missed pickup
  { pattern: /reciclaje/i, intent: "Trash / Sanitation", priority: 90 },  // recycling
  { pattern: /contenedor\s*(de\s*)?(basura)?/i, intent: "Trash / Sanitation", priority: 85 },  // trash container
  { pattern: /tiradero\s*ilegal/i, intent: "Trash / Sanitation", priority: 85 },  // illegal dump

  // BILLING / PAYMENT - Financial terms with context
  // English
  { pattern: /(water|utility|trash|tax)\s*bill/i, intent: "Billing / Payment", priority: 90 },
  { pattern: /bill\s*(question|issue|problem|too\s*high|incorrect|wrong)/i, intent: "Billing / Payment", priority: 90 },
  { pattern: /payment\s*(plan|option|issue|problem|arrangement)/i, intent: "Billing / Payment", priority: 90 },
  { pattern: /pay\s*(my\s*)?(bill|balance|account)/i, intent: "Billing / Payment", priority: 85 },
  { pattern: /overdue\s*(bill|payment|balance|account)/i, intent: "Billing / Payment", priority: 85 },
  { pattern: /(late|past\s*due)\s*(fee|charge|payment)/i, intent: "Billing / Payment", priority: 85 },
  { pattern: /account\s*(balance|statement|issue)/i, intent: "Billing / Payment", priority: 80 },
  { pattern: /invoice\s*(question|issue|problem)/i, intent: "Billing / Payment", priority: 80 },
  // Spanish: billing/payment
  { pattern: /factura/i, intent: "Billing / Payment", priority: 95 },  // bill/invoice
  { pattern: /recibo\s*(de\s*)?(agua|luz|gas)/i, intent: "Billing / Payment", priority: 90 },  // utility bill
  { pattern: /pagar\s*(mi\s*)?(factura|recibo|cuenta)/i, intent: "Billing / Payment", priority: 90 },  // pay my bill
  { pattern: /cuenta\s*(de\s*)?(agua|luz|gas)/i, intent: "Billing / Payment", priority: 90 },  // utility account
  { pattern: /cobro\s*(excesivo|incorrecto|alto)/i, intent: "Billing / Payment", priority: 85 },  // excessive/incorrect charge
  { pattern: /plan\s*(de\s*)?pago/i, intent: "Billing / Payment", priority: 85 },  // payment plan
  { pattern: /deuda|adeudo/i, intent: "Billing / Payment", priority: 80 },  // debt/amount owed

  // SAFETY CONCERN / SUSPICIOUS ACTIVITY - Crime, safety hazards, suspicious persons
  // Phase 2 Hardening: Added for public safety intake routing
  // English - Crime/Break-in
  { pattern: /break(ing)?\s*in(to)?/i, intent: "Safety Concern / Suspicious Activity", priority: 95 },
  { pattern: /burglar(y)?|theft|stolen/i, intent: "Safety Concern / Suspicious Activity", priority: 95 },
  { pattern: /car\s*(break|theft|stolen|burglar)/i, intent: "Safety Concern / Suspicious Activity", priority: 95 },
  { pattern: /prowl(er|ing)/i, intent: "Safety Concern / Suspicious Activity", priority: 95 },
  { pattern: /trespass(er|ing)?/i, intent: "Safety Concern / Suspicious Activity", priority: 90 },
  { pattern: /vandal(ism|ize|izing)?/i, intent: "Safety Concern / Suspicious Activity", priority: 90 },
  // English - Suspicious behavior
  { pattern: /suspicious\s*(person|activity|vehicle|behavior|individual)/i, intent: "Safety Concern / Suspicious Activity", priority: 95 },
  { pattern: /checking\s*(car|door|window|lock|handle)/i, intent: "Safety Concern / Suspicious Activity", priority: 90 },
  { pattern: /trying\s*to\s*(open|break|get\s*into|enter)/i, intent: "Safety Concern / Suspicious Activity", priority: 90 },
  { pattern: /someone\s*(walking|looking|hanging|lurking)\s*around/i, intent: "Safety Concern / Suspicious Activity", priority: 85 },
  { pattern: /strange\s*(person|man|woman|individual)/i, intent: "Safety Concern / Suspicious Activity", priority: 85 },
  { pattern: /looking\s*(in|into|through)\s*(car|window|door)/i, intent: "Safety Concern / Suspicious Activity", priority: 90 },
  { pattern: /casing\s*(the|my)?\s*(house|car|neighborhood)/i, intent: "Safety Concern / Suspicious Activity", priority: 90 },
  // Spanish - Crime/suspicious
  { pattern: /sospechoso/i, intent: "Safety Concern / Suspicious Activity", priority: 95 },  // suspicious
  { pattern: /robo|robando|ladr[oó]n/i, intent: "Safety Concern / Suspicious Activity", priority: 95 },  // robbery/thief
  { pattern: /intruso/i, intent: "Safety Concern / Suspicious Activity", priority: 95 },  // intruder
  { pattern: /entr(ar|ando)\s*(a\s*)?(la\s*)?(fuerza|robar)/i, intent: "Safety Concern / Suspicious Activity", priority: 90 },  // breaking in
  { pattern: /persona\s*(extra[ñn]a|sospechosa)/i, intent: "Safety Concern / Suspicious Activity", priority: 85 },  // strange/suspicious person
  { pattern: /revisando\s*(carros|puertas|ventanas)/i, intent: "Safety Concern / Suspicious Activity", priority: 90 },  // checking cars/doors/windows
];

// Department patterns with context
// Phase 1 Spanish Hardening: Added Spanish keyword patterns
const DEPARTMENT_PATTERNS: Array<{ pattern: RegExp; department: string; priority: number }> = [
  // PUBLIC WORKS - Infrastructure
  // English
  { pattern: /pothole|road\s*(damage|repair|issue)|street\s*(damage|repair)/i, department: "Public Works", priority: 100 },
  { pattern: /sidewalk|curb|pavement|asphalt/i, department: "Public Works", priority: 90 },
  { pattern: /street\s*light|lamp\s*post|light\s*pole/i, department: "Public Works", priority: 90 },
  { pattern: /traffic\s*(light|sign|signal)/i, department: "Public Works", priority: 90 },
  { pattern: /storm\s*drain|sewer|water\s*main/i, department: "Public Works", priority: 85 },
  { pattern: /road\s*(sign|marking|line)/i, department: "Public Works", priority: 80 },
  // Spanish
  { pattern: /bache|hoyo\s*(en\s*)?(la\s*)?(calle|carretera)/i, department: "Public Works", priority: 100 },  // pothole
  { pattern: /acera|banqueta|pavimento/i, department: "Public Works", priority: 90 },  // sidewalk/pavement
  { pattern: /poste\s*(de\s*)?luz|alumbrado/i, department: "Public Works", priority: 90 },  // streetlight
  { pattern: /sem[aá]foro/i, department: "Public Works", priority: 90 },  // traffic light
  { pattern: /alcantarilla|drenaje/i, department: "Public Works", priority: 85 },  // sewer/drain
  { pattern: /se[ñn]al(amiento)?\s*(de\s*)?(tr[aá]nsito|calle)/i, department: "Public Works", priority: 80 },  // traffic sign

  // PUBLIC SAFETY - Emergency/safety issues
  // English
  { pattern: /emergency|911/i, department: "Public Safety", priority: 100 },
  { pattern: /police|crime|theft|break\s*in/i, department: "Public Safety", priority: 95 },
  { pattern: /fire\s*(department|hazard|danger)/i, department: "Public Safety", priority: 95 },
  { pattern: /danger(ous)?\s*(condition|situation|area)/i, department: "Public Safety", priority: 90 },
  { pattern: /accident|collision|crash/i, department: "Public Safety", priority: 85 },
  { pattern: /suspicious\s*(person|activity|vehicle)/i, department: "Public Safety", priority: 85 },
  { pattern: /threat|assault|violence/i, department: "Public Safety", priority: 90 },
  // Spanish
  { pattern: /emergencia/i, department: "Public Safety", priority: 100 },  // emergency
  { pattern: /polic[ií]a|robo|asalto/i, department: "Public Safety", priority: 95 },  // police/theft/assault
  { pattern: /bomberos|incendio/i, department: "Public Safety", priority: 95 },  // firefighters/fire
  { pattern: /peligro(so)?/i, department: "Public Safety", priority: 90 },  // danger(ous)
  { pattern: /accidente|choque/i, department: "Public Safety", priority: 85 },  // accident/crash
  { pattern: /sospechoso/i, department: "Public Safety", priority: 85 },  // suspicious

  // FINANCE - Financial matters
  // English
  { pattern: /(property|city|county)\s*tax/i, department: "Finance", priority: 95 },
  { pattern: /(water|utility|trash)\s*bill/i, department: "Finance", priority: 90 },
  { pattern: /payment\s*(plan|option|arrangement)/i, department: "Finance", priority: 90 },
  { pattern: /permit\s*(fee|application|cost)/i, department: "Finance", priority: 85 },
  { pattern: /license\s*(fee|renewal|cost)/i, department: "Finance", priority: 85 },
  { pattern: /fine|citation|penalty/i, department: "Finance", priority: 80 },
  // Spanish
  { pattern: /impuesto|predial/i, department: "Finance", priority: 95 },  // tax/property tax
  { pattern: /factura|recibo\s*(de\s*)?(agua|luz|gas)/i, department: "Finance", priority: 90 },  // bill/utility receipt
  { pattern: /plan\s*(de\s*)?pago/i, department: "Finance", priority: 90 },  // payment plan
  { pattern: /permiso|licencia/i, department: "Finance", priority: 85 },  // permit/license
  { pattern: /multa|infracci[oó]n/i, department: "Finance", priority: 80 },  // fine/citation

  // PARKS & RECREATION - Parks and facilities
  // English
  { pattern: /park\s*(issue|problem|damage|maintenance)/i, department: "Parks & Recreation", priority: 90 },
  { pattern: /playground\s*(issue|broken|damage|unsafe)/i, department: "Parks & Recreation", priority: 90 },
  { pattern: /recreation\s*(center|facility|program)/i, department: "Parks & Recreation", priority: 90 },
  { pattern: /community\s*(center|pool|facility)/i, department: "Parks & Recreation", priority: 85 },
  { pattern: /trail\s*(issue|damage|maintenance)/i, department: "Parks & Recreation", priority: 80 },
  { pattern: /sports\s*(field|court|facility)/i, department: "Parks & Recreation", priority: 80 },
  // Spanish
  { pattern: /parque\s*(problema|da[ñn]o|mantenimiento)/i, department: "Parks & Recreation", priority: 90 },  // park issue
  { pattern: /juegos\s*(infantiles)?|[aá]rea\s*de\s*juegos/i, department: "Parks & Recreation", priority: 90 },  // playground
  { pattern: /centro\s*(comunitario|recreativo)/i, department: "Parks & Recreation", priority: 85 },  // community/rec center
  { pattern: /alberca|piscina/i, department: "Parks & Recreation", priority: 85 },  // pool
  { pattern: /sendero|vereda/i, department: "Parks & Recreation", priority: 80 },  // trail

  // SANITATION - Waste management
  // English
  { pattern: /trash\s*(pickup|collection|missed)/i, department: "Sanitation", priority: 95 },
  { pattern: /garbage\s*(pickup|collection|truck)/i, department: "Sanitation", priority: 95 },
  { pattern: /recycl(e|ing)\s*(pickup|bin|collection)/i, department: "Sanitation", priority: 95 },
  { pattern: /waste\s*(collection|pickup|management)/i, department: "Sanitation", priority: 90 },
  { pattern: /bulk\s*(pickup|trash|item)/i, department: "Sanitation", priority: 85 },
  { pattern: /dumpster|compost/i, department: "Sanitation", priority: 80 },
  // Spanish
  { pattern: /basura|recolecci[oó]n/i, department: "Sanitation", priority: 95 },  // trash/collection
  { pattern: /cami[oó]n\s*(de\s*)?(la\s*)?basura/i, department: "Sanitation", priority: 95 },  // garbage truck
  { pattern: /reciclaje/i, department: "Sanitation", priority: 95 },  // recycling
  { pattern: /contenedor/i, department: "Sanitation", priority: 85 },  // container
  { pattern: /composta/i, department: "Sanitation", priority: 80 },  // compost
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

// ============================================================
// STRONG INTENT KEYWORDS (Phase 1 Final Hardening)
// ============================================================
// If these keywords appear ANYWHERE in the text, we should NOT
// fall back to "General Inquiry". Used for post-LLM validation.
// ============================================================

const STRONG_INTENT_KEYWORDS: Array<{ keywords: RegExp[]; intent: string; department: string }> = [
  // Pothole / Road Damage (EXPANDED - Phase 2 Hardening)
  // Must match all the ways callers describe potholes/road issues
  {
    keywords: [
      /pothole/i,                                           // Direct: "pothole"
      /pot\s*hole/i,                                        // Spaced: "pot hole"
      /bache/i,                                             // Spanish: pothole
      /road\s*(damage|repair|broken|crack|issue|problem|condition)/i,  // "road damage", "road problem", etc.
      /street\s*(damage|broken|crack|repair|issue|problem)/i,          // "street damage", "street problem", etc.
      /hole\s*(in|on)\s*(the\s*)?(road|street|pavement)/i,            // "hole in the road", "hole on the street"
      /big\s*hole/i,                                        // "big hole" (implies road context)
      /(road|street)\s*(has|with)\s*(a\s*)?(hole|crack|damage)/i,     // "street has a hole"
      /damaged\s*(road|street|pavement)/i,                  // "damaged road"
      /bad\s*(road|street)/i,                               // "bad road"
      /crater/i,                                            // "crater" in road context
      /bump\s*(in|on)\s*(the\s*)?(road|street)/i,          // "bump in the road"
      /(road|street)\s+needs?\s+(repair|fixing|work)/i,    // "road needs repair"
      /hoyo\s*(en\s*)?(la\s*)?(calle|carretera)/i,         // Spanish: hole in street
      /calle\s*(dañada|rota|en\s*mal\s*estado)/i,          // Spanish: damaged street
    ],
    intent: "Pothole / Road Damage",
    department: "Public Works",
  },
  // Streetlight Issue
  {
    keywords: [/street\s*light/i, /lamp\s*post/i, /light\s*pole/i, /poste\s*de\s*luz/i, /alumbrado/i],
    intent: "Streetlight Issue",
    department: "Public Works",
  },
  // Water / Utilities
  {
    keywords: [/water\s*(leak|main|pipe|meter)/i, /hydrant/i, /sewer/i, /fuga\s*de\s*agua/i, /tuber[ií]a/i],
    intent: "Water / Utilities",
    department: "Public Works",
  },
  // Trash / Sanitation
  {
    keywords: [/trash\s*(pickup|collection|missed)/i, /garbage/i, /basura/i, /recycl/i, /reciclaje/i],
    intent: "Trash / Sanitation",
    department: "Sanitation",
  },
  // Billing / Payment
  {
    keywords: [/(water|utility|trash)\s*bill/i, /factura/i, /payment\s*plan/i, /recibo/i],
    intent: "Billing / Payment",
    department: "Finance",
  },
  // Safety Concern / Suspicious Activity (Phase 2 Hardening)
  {
    keywords: [
      /suspicious/i, 
      /break\s*in/i, 
      /prowler/i, 
      /burglar/i,
      /checking\s*(car|door|lock)/i,
      /trying\s*to\s*(open|break|get\s*into)/i,
      /someone\s*(walking|looking|hanging)\s*around/i,
      /sospechoso/i,
      /intruso/i,
      /robo/i,
      /ladr[oó]n/i,
    ],
    intent: "Safety Concern / Suspicious Activity",
    department: "Public Safety",
  },
];

/**
 * Check if strong intent keywords are present in text
 * Returns the strongest match or null if no strong keywords found
 */
function detectStrongIntent(text: string): { intent: string; department: string } | null {
  const lowerText = text.toLowerCase();
  
  for (const { keywords, intent, department } of STRONG_INTENT_KEYWORDS) {
    for (const keyword of keywords) {
      if (keyword.test(lowerText)) {
        console.log(`[classifier] Strong keyword detected: "${keyword.source}" → ${intent}`);
        return { intent, department };
      }
    }
  }
  
  return null;
}

/**
 * Main classification function
 *
 * Attempts LLM classification first, falls back to regex on failure.
 * Phase 1 Final Hardening: If LLM returns "General Inquiry" but strong
 * keywords are present, override with the specific intent.
 * Timeout: 3 seconds for LLM call.
 */
export async function classifyIntake(input: ClassificationInput): Promise<ClassificationOutput> {
  console.log("[classifier] Classifying intake:", { channel: input.channel, textLength: input.rawText.length });
  
  // Log first 500 chars of raw text for debugging classification issues
  const textPreview = input.rawText.substring(0, 500);
  console.log(`[classifier] Raw text preview: "${textPreview}${input.rawText.length > 500 ? '...' : ''}"`);

  // Pre-check for strong intent keywords
  const strongIntent = detectStrongIntent(input.rawText);
  if (strongIntent) {
    console.log(`[classifier] Strong intent PRE-DETECTED: ${strongIntent.intent} → ${strongIntent.department}`);
  } else {
    console.log("[classifier] No strong intent keywords detected in raw text");
  }

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
      // Phase 1 Final Hardening: Override "General Inquiry" if strong keywords present
      if (llmResult.intent === "General Inquiry" && strongIntent) {
        console.log(`[classifier] OVERRIDE: LLM returned "General Inquiry" but strong keyword found → ${strongIntent.intent}`);
        return {
          intent: strongIntent.intent,
          department: strongIntent.department,
          summary: llmResult.summary,
        };
      }
      return llmResult;
    }

    console.log("[classifier] LLM timed out or failed, using regex fallback");
  } catch (error) {
    console.error("[classifier] Unexpected error, using regex fallback:", error);
  }

  // Fallback to regex
  const regexResult = classifyWithRegex(input.rawText);
  
  // Phase 1 Final Hardening: Override regex "General Inquiry" if strong keywords present
  if (regexResult.intent === "General Inquiry" && strongIntent) {
    console.log(`[classifier] OVERRIDE: Regex returned "General Inquiry" but strong keyword found → ${strongIntent.intent}`);
    return {
      intent: strongIntent.intent,
      department: strongIntent.department,
      summary: regexResult.summary,
    };
  }
  
  return regexResult;
}
