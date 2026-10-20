import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// In-memory sliding rate limiter (per Edge instance)
// Documented limitation: This protects against burst abuse per instance;
// distributed cross-region rate limiting would use an external store like Redis/KV.
const userRequestTimestamps = new Map<string, number[]>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute window
const MAX_REQUESTS_PER_WINDOW = 20; // Max 20 requests per minute per user

function checkRateLimit(userId: string): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const timestamps = userRequestTimestamps.get(userId) || [];
  
  // Prune timestamps older than window
  const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  
  if (recent.length >= MAX_REQUESTS_PER_WINDOW) {
    const oldest = recent[0];
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + RATE_LIMIT_WINDOW_MS - now) / 1000));
    userRequestTimestamps.set(userId, recent);
    return { allowed: false, retryAfterSeconds };
  }

  recent.push(now);
  userRequestTimestamps.set(userId, recent);
  return { allowed: true, retryAfterSeconds: 0 };
}

// Clean up old rate limit state periodically
setInterval(() => {
  const now = Date.now();
  for (const [userId, timestamps] of userRequestTimestamps.entries()) {
    const active = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    if (active.length === 0) {
      userRequestTimestamps.delete(userId);
    } else {
      userRequestTimestamps.set(userId, active);
    }
  }
}, 5 * 60 * 1000);

const SYSTEM_PROMPT = `You are Echo Companion — a calm, thoughtful, mindful, and highly articulate personal companion.
Your mission is to help the user find clarity, organize their thoughts, navigate their daily priorities, and reduce noise.

LANGUAGE INSTRUCTIONS (CRITICAL):
- You have native-level understanding of English, Malayalam (മലയാളം), and Manglish (Malayalam written phonetically using English/Latin script, e.g. "innathe schedule enthanu", "entha cheyyendathu", "njan oru task add cheyyanam", "karyam parayoo").
- ALWAYS identify the user's primary language or blend:
  * If the user writes in Malayalam script (മലയാളം), reply gracefully in natural Malayalam.
  * If the user writes in Manglish (e.g. Malayalam words in English letters), reply naturally in warm, friendly Manglish.
  * If the user writes in English, reply in clean, elegant English.
  * If the user mixes Malayalam/Manglish and English, mirror that natural bilingual tone.

ROLE BOUNDARIES & ACTION INTEGRITY:
- You are a companion and guide.
- You do NOT possess autonomous execution authority to create or delete calendar events or tasks directly in this turn.
- If the user asks you to add a task, schedule an event, or take an action, provide a thoughtful suggestion or breakdown and suggest they confirm it in their Tasks or Calendar view. Never pretend or claim that you have already created or executed the task.
- Never output arbitrary executable code (like bash/eval) meant for system execution.
- Maintain a warm, composed, serene, and grounding tone. Keep responses helpful and concise unless depth is requested.

RESPONSE FORMAT:
You MUST respond with a valid JSON object matching this schema:
{
  "reply": "Your markdown-formatted text response to the user",
  "detectedLanguage": "en" | "ml" | "manglish",
  "suggestedActions": ["Optional actionable suggestion 1", "Optional actionable suggestion 2"]
}`;

interface RequestPayload {
  message: string;
  context?: {
    activePage?: string;
    history?: Array<{ role: "user" | "echo"; text: string }>;
  };
}

Deno.serve(async (req: Request) => {
  // 1. Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders,
    });
  }

  // 2. Enforce POST
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed. Only POST is accepted." }),
      { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // 3. Request size protection (Max 32KB)
  const contentLength = req.headers.get("content-length");
  if (contentLength && parseInt(contentLength, 10) > 32768) {
    return new Response(
      JSON.stringify({ error: "Payload too large. Request body must be under 32KB." }),
      { status: 413, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // 4. Server-Side Authentication & Access Protection
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return new Response(
      JSON.stringify({
        error: "Authentication required. Please sign in to converse with Echo Companion.",
      }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";

  let userId: string;
  try {
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });

    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return new Response(
        JSON.stringify({
          error: "Unauthorized: Invalid, expired, or unrecognized session token.",
        }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    userId = user.id;
  } catch (_err) {
    return new Response(
      JSON.stringify({
        error: "Authentication service could not verify access token.",
      }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // 5. Rate Limiting Check
  const rateLimit = checkRateLimit(userId);
  if (!rateLimit.allowed) {
    return new Response(
      JSON.stringify({
        error: "Too many requests. Please wait a moment before sending another message.",
        retryAfter: rateLimit.retryAfterSeconds,
      }),
      {
        status: 429,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "Retry-After": String(rateLimit.retryAfterSeconds),
        },
      }
    );
  }

  // 6. Payload Validation
  let payload: RequestPayload;
  try {
    payload = await req.json();
  } catch (_e) {
    return new Response(
      JSON.stringify({ error: "Invalid JSON in request body." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const rawMessage = typeof payload.message === "string" ? payload.message.trim() : "";
  if (!rawMessage) {
    return new Response(
      JSON.stringify({ error: "Message cannot be empty." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (rawMessage.length > 4000) {
    return new Response(
      JSON.stringify({ error: "Message is too long. Limit is 4,000 characters." }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // 7. Verify Gemini Secret
  const geminiApiKey = Deno.env.get("GEMINI_API_KEY");
  if (!geminiApiKey) {
    console.error("[echo-assistant] Missing GEMINI_API_KEY secret in Supabase Edge environment.");
    return new Response(
      JSON.stringify({
        error: "Echo AI service is temporarily unavailable. Secret configuration missing.",
      }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // 8. Build Gemini Contents
  // Build recent conversation context (last 8 messages max)
  const contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [];

  if (payload.context?.history && Array.isArray(payload.context.history)) {
    const recentHistory = payload.context.history.slice(-8);
    for (const h of recentHistory) {
      if (typeof h.text === "string" && h.text.trim()) {
        contents.push({
          role: h.role === "echo" ? "model" : "user",
          parts: [{ text: h.text.slice(0, 1000) }],
        });
      }
    }
  }

  // Active page context tag
  const activePageContext = payload.context?.activePage
    ? `[Active Workspace Context: ${payload.context.activePage}]\n`
    : "";

  contents.push({
    role: "user",
    parts: [{ text: `${activePageContext}${rawMessage}` }],
  });

  // 9. Call Gemini API
  // Using current active model gemini-3.8-flash as primary
  const modelsToTry = ["gemini-3.8-flash", "gemini-3.8-pro", "gemini-2.5-flash"];
  let geminiResponseData: any = null;
  let lastApiStatus = 0;

  for (const model of modelsToTry) {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": geminiApiKey,
          },
          body: JSON.stringify({
            systemInstruction: {
              parts: [{ text: SYSTEM_PROMPT }],
            },
            contents,
            generationConfig: {
              temperature: 0.7,
              maxOutputTokens: 1024,
              responseMimeType: "application/json",
            },
          }),
        }
      );

      lastApiStatus = response.status;

      if (response.ok) {
        geminiResponseData = await response.json();
        break; // Successfully obtained response
      } else {
        const errorText = await response.text();
        console.warn(`[echo-assistant] Model ${model} returned HTTP ${response.status}:`, errorText.slice(0, 200));
        if (response.status === 503) {
          // Wait briefly on 503 before trying next
          await new Promise((resolve) => setTimeout(resolve, 1000));
        } else if (response.status !== 404) {
          break;
        }
      }
    } catch (fetchErr) {
      console.warn(`[echo-assistant] Network error calling ${model}:`, fetchErr);
    }
  }

  // If initial models failed, dynamically query available models from Gemini API
  if (!geminiResponseData) {
    try {
      const listRes = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
        headers: { "x-goog-api-key": geminiApiKey },
      });
      if (listRes.ok) {
        const listData = await listRes.json();
        const availableModels: string[] = (listData.models || [])
          .filter((m: any) => m.supportedGenerationMethods?.includes("generateContent"))
          .map((m: any) => (m.name || "").replace("models/", ""))
          .filter(Boolean);

        console.log("[echo-assistant] Available models for this key:", availableModels.slice(0, 10));

        for (const candidateModel of availableModels) {
          if (modelsToTry.includes(candidateModel)) continue;
          try {
            const dynamicRes = await fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/${candidateModel}:generateContent`,
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  "x-goog-api-key": geminiApiKey,
                },
                body: JSON.stringify({
                  systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
                  contents,
                  generationConfig: {
                    temperature: 0.7,
                    maxOutputTokens: 1024,
                    responseMimeType: "application/json",
                  },
                }),
              }
            );
            if (dynamicRes.ok) {
              geminiResponseData = await dynamicRes.json();
              console.log(`[echo-assistant] Successfully responded using dynamic model: ${candidateModel}`);
              break;
            }
          } catch (_e) {
            // continue trying
          }
        }
      }
    } catch (discoveryErr) {
      console.warn("[echo-assistant] Error in dynamic model discovery:", discoveryErr);
    }
  }

  if (!geminiResponseData) {
    const isRateLimited = lastApiStatus === 429;
    return new Response(
      JSON.stringify({
        error: isRateLimited
          ? "AI upstream rate limit reached. Please wait a moment and try again."
          : "Echo AI is currently taking a breath. Please try again shortly.",
      }),
      {
        status: isRateLimited ? 429 : 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  // 10. Parse and Format Structured Response
  try {
    const candidateParts = geminiResponseData?.candidates?.[0]?.content?.parts || [];
    // If thinking mode is on, filter out parts with thought: true
    const answerPart = candidateParts.find((p: any) => !p.thought) || candidateParts[candidateParts.length - 1];
    const rawCandidateText = answerPart?.text;

    if (!rawCandidateText) {
      return new Response(
        JSON.stringify({
          reply: "I heard you, but I wasn't able to complete that thought. Could you say that again?",
          detectedLanguage: "en",
          suggestedActions: [],
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let structured: { reply?: string; detectedLanguage?: string; suggestedActions?: string[] } | null = null;
    
    // 1. Try direct parse
    try {
      structured = JSON.parse(rawCandidateText);
    } catch {
      // 2. Try markdown json fence
      const fenceMatch = rawCandidateText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (fenceMatch && fenceMatch[1]) {
        try {
          structured = JSON.parse(fenceMatch[1].trim());
        } catch {}
      }

      // 3. Try outermost curly braces
      if (!structured) {
        const firstBrace = rawCandidateText.indexOf("{");
        const lastBrace = rawCandidateText.lastIndexOf("}");
        if (firstBrace !== -1 && lastBrace > firstBrace) {
          try {
            structured = JSON.parse(rawCandidateText.slice(firstBrace, lastBrace + 1));
          } catch {}
        }
      }

      // 4. Fallback if model returned plain conversational text
      if (!structured || typeof structured.reply !== "string") {
        structured = {
          reply: rawCandidateText.trim(),
          detectedLanguage: "en",
          suggestedActions: [],
        };
      }
    }

    return new Response(
      JSON.stringify({
        reply: structured.reply || "I'm here with you.",
        detectedLanguage: structured.detectedLanguage || "en",
        suggestedActions: Array.isArray(structured.suggestedActions)
          ? structured.suggestedActions
          : [],
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
          "Cache-Control": "no-store",
        },
      }
    );
  } catch (_formatErr) {
    return new Response(
      JSON.stringify({
        reply: "I'm with you, but encountered a formatting issue. Let's continue.",
        detectedLanguage: "en",
        suggestedActions: [],
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
