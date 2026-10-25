import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, accept",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Expose-Headers": "Server-Timing, Content-Type",
};

// In-memory sliding rate limiter (per Edge instance)
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
- Native-level understanding of English, Malayalam (മലയാളം), and Manglish (Malayalam written phonetically using Latin script, e.g., "innathe schedule enthanu", "entha cheyyendathu", "njan oru task add cheyyanam").
- Language selection rules:
  * If user writes in Malayalam script (മലയാളം), reply in natural, elegant Malayalam.
  * If user writes in Manglish, reply naturally in warm, friendly Manglish.
  * If user writes in English, reply in clean, articulate English.
  * If user mixes languages, mirror that natural bilingual tone.

ROLE BOUNDARIES & ACTION INTEGRITY:
- You are a companion and thoughtful guide.
- You do NOT directly create or delete calendar events or tasks in this turn.
- If asked to schedule or track something, offer helpful suggestions and invite the user to confirm them in their Tasks or Calendar view. Never fabricate that an action has been committed.
- Keep responses focused, grounded, and serene. Avoid unnecessary verbosity.

RESPONSE FORMAT:
You MUST respond ONLY with a valid JSON object matching this schema:
{
  "reply": "Your markdown response to the user",
  "detectedLanguage": "en" | "ml" | "manglish",
  "suggestedActions": ["Actionable suggestion 1", "Actionable suggestion 2"]
}`;

interface RequestPayload {
  message: string;
  stream?: boolean;
  context?: {
    activePage?: string;
    history?: Array<{ role: "user" | "echo"; text: string }>;
  };
}

// In-memory model cache for zero-overhead candidate selection across invocations
let cachedWorkingModel = "gemini-3-flash-preview";

Deno.serve(async (req: Request) => {
  const edgeStart = performance.now();

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
  const authStart = performance.now();
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
  const authDurationMs = performance.now() - authStart;

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

  // 8. Build Optimized Gemini Contents
  // Keep last 4 messages, truncated to 350 chars each to minimize tokens & latency
  const contents: Array<{ role: "user" | "model"; parts: Array<{ text: string }> }> = [];

  if (payload.context?.history && Array.isArray(payload.context.history)) {
    const recentHistory = payload.context.history.slice(-4);
    for (const h of recentHistory) {
      if (typeof h.text === "string" && h.text.trim()) {
        contents.push({
          role: h.role === "echo" ? "model" : "user",
          parts: [{ text: h.text.slice(0, 350) }],
        });
      }
    }
  }

  // Active page context tag
  const activePageContext = payload.context?.activePage
    ? `[Active Context: ${payload.context.activePage}]\n`
    : "";

  contents.push({
    role: "user",
    parts: [{ text: `${activePageContext}${rawMessage}` }],
  });

  const wantsStreaming =
    Boolean(payload.stream) ||
    Boolean(req.headers.get("accept")?.includes("text/event-stream"));

  // 9. Call Gemini API with Latency Optimization
  // Ordered candidates: start with cached working model, followed by verified candidates
  const staticCandidates = ["gemini-3-flash-preview", "gemini-2.5-flash", "gemini-flash-latest"];
  const modelsToTry = [
    cachedWorkingModel,
    ...staticCandidates.filter((m) => m !== cachedWorkingModel),
  ];

  let geminiResponseData: any = null;
  let lastApiStatus = 0;
  let successfulModel = "";
  let geminiDurationMs = 0;

  for (const model of modelsToTry) {
    const geminiStart = performance.now();
    try {
      const generationConfig: Record<string, any> = {
        temperature: 0.7,
        maxOutputTokens: 500,
        responseMimeType: "application/json",
        thinkingConfig: { thinkingBudget: 0 },
      };

      let response = await fetch(
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
            generationConfig,
          }),
          signal: AbortSignal.timeout(8000), // 8s fast timeout prevents blocking
        }
      );

      // Fallback: If 400 occurs due to thinkingConfig, retry without it
      if (response.status === 400) {
        response = await fetch(
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
                maxOutputTokens: 500,
                responseMimeType: "application/json",
              },
            }),
            signal: AbortSignal.timeout(8000),
          }
        );
      }

      geminiDurationMs = performance.now() - geminiStart;
      lastApiStatus = response.status;

      if (response.ok) {
        geminiResponseData = await response.json();
        successfulModel = model;
        cachedWorkingModel = model;
        break; // Successfully obtained response
      } else {
        const errorText = await response.text();
        console.warn(`[echo-assistant] Model ${model} returned HTTP ${response.status} in ${geminiDurationMs.toFixed(0)}ms:`, errorText.slice(0, 120));
      }
    } catch (fetchErr: any) {
      console.warn(`[echo-assistant] ${model} error:`, fetchErr.message);
    }
  }

  // Dynamic discovery fallback if static candidates fail
  if (!geminiResponseData) {
    try {
      const listRes = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
        headers: { "x-goog-api-key": geminiApiKey },
        signal: AbortSignal.timeout(5000),
      });
      if (listRes.ok) {
        const listData = await listRes.json();
        const availableModels: string[] = (listData.models || [])
          .filter((m: any) => m.supportedGenerationMethods?.includes("generateContent"))
          .map((m: any) => (m.name || "").replace("models/", ""))
          .filter(Boolean);

        for (const candidateModel of availableModels) {
          if (modelsToTry.includes(candidateModel)) continue;
          try {
            const dynamicStart = performance.now();
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
                    maxOutputTokens: 500,
                    responseMimeType: "application/json",
                    thinkingConfig: { thinkingBudget: 0 },
                  },
                }),
                signal: AbortSignal.timeout(8000),
              }
            );
            if (dynamicRes.ok) {
              geminiResponseData = await dynamicRes.json();
              successfulModel = candidateModel;
              cachedWorkingModel = candidateModel;
              geminiDurationMs = performance.now() - dynamicStart;
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
  const candidateParts = geminiResponseData?.candidates?.[0]?.content?.parts || [];
  const answerPart = candidateParts.find((p: any) => !p.thought) || candidateParts[candidateParts.length - 1];
  const rawCandidateText = answerPart?.text;

  let structured: { reply?: string; detectedLanguage?: string; suggestedActions?: string[] } | null = null;

  if (rawCandidateText) {
    try {
      structured = JSON.parse(rawCandidateText);
    } catch {
      const fenceMatch = rawCandidateText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
      if (fenceMatch && fenceMatch[1]) {
        try {
          structured = JSON.parse(fenceMatch[1].trim());
        } catch {}
      }

      if (!structured) {
        const firstBrace = rawCandidateText.indexOf("{");
        const lastBrace = rawCandidateText.lastIndexOf("}");
        if (firstBrace !== -1 && lastBrace > firstBrace) {
          try {
            structured = JSON.parse(rawCandidateText.slice(firstBrace, lastBrace + 1));
          } catch {}
        }
      }

      if (!structured || typeof structured.reply !== "string") {
        structured = {
          reply: rawCandidateText.trim(),
          detectedLanguage: "en",
          suggestedActions: [],
        };
      }
    }
  } else {
    structured = {
      reply: "I heard you, but I wasn't able to complete that thought. Could you say that again?",
      detectedLanguage: "en",
      suggestedActions: [],
    };
  }

  const totalEdgeDurationMs = performance.now() - edgeStart;

  // Safe server-side telemetry log (no prompt or credential logged)
  console.log(
    `[echo-assistant] user=${userId.slice(0, 8)} model=${successfulModel} authMs=${authDurationMs.toFixed(0)} geminiMs=${geminiDurationMs.toFixed(0)} totalMs=${totalEdgeDurationMs.toFixed(0)}`
  );

  const finalResponseObj = {
    reply: structured.reply || "I'm here with you.",
    detectedLanguage: structured.detectedLanguage || "en",
    suggestedActions: Array.isArray(structured.suggestedActions) ? structured.suggestedActions : [],
    metrics: {
      authMs: Math.round(authDurationMs),
      geminiMs: Math.round(geminiDurationMs),
      edgeMs: Math.round(totalEdgeDurationMs),
    },
  };

  // If client requested SSE streaming, stream the response via Server-Sent Events
  if (wantsStreaming) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        // Send initial chunk
        controller.enqueue(
          encoder.encode(`event: delta\ndata: ${JSON.stringify({ text: finalResponseObj.reply })}\n\n`)
        );
        // Send completion chunk with metadata
        controller.enqueue(
          encoder.encode(`event: done\ndata: ${JSON.stringify(finalResponseObj)}\n\n`)
        );
        controller.close();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        ...corsHeaders,
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Server-Timing": `auth;dur=${authDurationMs.toFixed(1)}, gemini;dur=${geminiDurationMs.toFixed(1)}, edge;dur=${totalEdgeDurationMs.toFixed(1)}`,
      },
    });
  }

  // Standard JSON response
  return new Response(JSON.stringify(finalResponseObj), {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      "Server-Timing": `auth;dur=${authDurationMs.toFixed(1)}, gemini;dur=${geminiDurationMs.toFixed(1)}, edge;dur=${totalEdgeDurationMs.toFixed(1)}`,
    },
  });
});
