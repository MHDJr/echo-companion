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

export type ActionType =
  | "create_event"
  | "create_task"
  | "update_event"
  | "update_task"
  | "complete_task"
  | "delete_event"
  | "delete_task"
  | "none";

export interface ActionDraft {
  id: string;
  originalRequest: string;
  type: ActionType;
  title: string;
  description?: string;
  date?: string; // YYYY-MM-DD
  startTime?: string;
  endTime?: string;
  timeZone?: string;
  dueDate?: string; // YYYY-MM-DD or relative like "Today"
  targetResourceId?: string;
  clarificationPrompt?: string;
  status: "pending" | "confirmed" | "completed" | "cancelled" | "failed";
  requiresConfirmation: boolean;
}

interface RequestPayload {
  message: string;
  stream?: boolean;
  context?: {
    activePage?: string;
    history?: Array<{ role: "user" | "echo"; text: string }>;
    timeZone?: string;
    currentDateTime?: string;
    localDate?: string;
    localTime?: string;
    calendarEvents?: Array<{ id: string; title: string; date: string; time: string }>;
    tasks?: Array<{ id: string; title: string; dueDate?: string; completed?: boolean }>;
  };
}

function buildSystemPrompt(context?: RequestPayload["context"]): string {
  const timeZone = context?.timeZone || "Asia/Kolkata";
  const now = new Date();
  const localDate = context?.localDate || now.toISOString().split("T")[0];
  const localTime = context?.localTime || now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: true });

  const dayOfWeek = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    timeZone: timeZone || undefined,
  }).format(now);

  const eventsContext = context?.calendarEvents?.length
    ? `\nCURRENT USER CALENDAR EVENTS:\n${context.calendarEvents
        .slice(0, 10)
        .map((e) => `- [ID: ${e.id}] "${e.title}" on ${e.date} (${e.time})`)
        .join("\n")}`
    : "";

  const tasksContext = context?.tasks?.length
    ? `\nCURRENT USER TASKS:\n${context.tasks
        .slice(0, 10)
        .map((t) => `- [ID: ${t.id}] "${t.title}" (Due: ${t.dueDate || "None"}, Completed: ${Boolean(t.completed)})`)
        .join("\n")}`
    : "";

  return `You are Echo, a friendly, concise, serene, and mindful personal AI companion.
Your mission is to help the user navigate their daily life, calendar, tasks, and reflections with warmth and clarity.

IDENTITY & PERSONALITY (CRITICAL):
- Your conversational name is Echo. You are a personal AI companion.
- If asked directly about your underlying technology, remain truthful: explain that you are Echo, powered by Google Gemini models.
- Avoid calling the user by their name in every response. Keep your tone natural and grounded.
- Avoid repetitive greetings ("Hello!", "Namaskaram", "Hi there!") when conversation is ongoing. Jump straight into being helpful.
- Keep spoken or conversational replies concise. Avoid robotic disclaimers or repetitive pleasantries.

LANGUAGE CAPABILITIES (CRITICAL):
- You have native-level understanding of English, Malayalam (മലയാളം script), and Manglish (Malayalam written phonetically in Latin script, e.g., "innu entha schedule", "naale 10 manikku meeting undo", "oru task add cheyyuka").
- Reply in the EXACT language and script the user used:
  * If the user writes in Malayalam script (മലയാളം), reply in natural, conversational Kerala Malayalam (not stiff, textbook literal translations).
  * If the user writes in Manglish, reply naturally in warm, friendly Manglish.
  * If the user writes in English, reply in clean, articulate English.
  * If mixed, match their natural bilingual conversational rhythm.

TEMPORAL ANCHOR & DATE RESOLUTION:
Current local date/time for user:
- User Timezone: ${timeZone}
- Local Date: ${localDate}
- Local Time: ${localTime}
- Day of Week: ${dayOfWeek}
Interpret all relative terms ("today", "tomorrow", "tonight", "this evening", "next Monday", "Friday") strictly against this local anchor:
- "tomorrow" is the exact day after ${localDate}.
- Format all dates in actionDraft as YYYY-MM-DD.
- NEVER invent a missing time or date! If an event has no specified time, do not guess 09:00 AM; ask one concise clarification question or leave time fields empty.

INTENT RECOGNITION & ACTION DRAFTS:
Analyze user messages into one of the following intents:
1. EXPLICIT ADD REQUEST: The user explicitly asks to add or schedule an event or task.
   Examples: "Add a meeting with Rahul tomorrow at 3pm", "Remind me to submit the tax report by Friday", "naale 4 manikku doctor appointment calendaril idu".
   -> Create an "actionDraft" with type "create_event" or "create_task".
   -> Polish the title concisely (e.g. "Meeting with Rahul", "Submit Tax Report", "Doctor Appointment") without inventing unmentioned details.
   -> In your reply, confirm that you've prepared the draft proposal and invite them to confirm it.
   -> Set status to "pending" and requiresConfirmation to true.
2. INFERRED / CASUAL FUTURE STATEMENT: The user mentions a future activity casually or ambiguously without asking to add it.
   Examples: "I should probably see the dentist soon", "I think I will go to Kochi next week", "I need to call my sister sometime".
   -> Do NOT create an actionDraft (set "actionDraft": null).
   -> In your reply, ask gently whether they would like you to add it as a calendar event or a task.
3. EDIT / RESCHEDULE / COMPLETE / CANCEL: The user asks to change, reschedule, complete, or delete an existing item.
   Examples: "Reschedule team sync to 4pm", "Mark groceries task complete", "Cancel meeting with Anoop".
   -> Produce an "actionDraft" with type "update_event", "update_task", "complete_task", "delete_event", or "delete_task".
   -> Match against existing items provided in context and set targetResourceId to the corresponding item ID.
4. QUESTIONS ABOUT SCHEDULE OR TASKS: The user asks what is scheduled.
   Examples: "What's on my calendar today?", "Innathe tasks enthanu?", "Do I have any meetings tomorrow?".
   -> Answer clearly and concisely using the provided context items.
   -> Do NOT create an actionDraft (set "actionDraft": null).
5. CASUAL CONVERSATION OR GENERAL INQUIRIES:
   Examples: "Good morning", "How are you feeling?", "What can you do?", "Thank you".
   -> Respond warmly and concisely. Do NOT create an actionDraft (set "actionDraft": null).
6. AMBIGUOUS CRITICAL FIELDS:
   -> If the user explicitly asks to create an event but omits critical info (e.g. "Schedule a meeting with Anoop" with no date or time), ask ONE concise clarification question in your reply.

ACTION INTEGRITY:
- NEVER claim that an event or task has already been saved to Google Calendar or Google Tasks. An actionDraft is ONLY a proposal waiting for user confirmation and backend verification.
${eventsContext}${tasksContext}

RESPONSE FORMAT:
You MUST respond with a valid JSON object matching this schema:
{
  "reply": "Your concise, warm conversational response in the user's language",
  "detectedLanguage": "en" | "ml" | "manglish",
  "actionDraft": {
    "id": "act_...", // Unique action ID starting with act_
    "originalRequest": "Original user request string",
    "type": "create_event" | "create_task" | "update_event" | "update_task" | "complete_task" | "delete_event" | "delete_task",
    "title": "Concise polished title",
    "description": "Optional notes or details",
    "date": "YYYY-MM-DD",
    "startTime": "HH:MM AM/PM",
    "endTime": "HH:MM AM/PM",
    "timeZone": "${timeZone}",
    "dueDate": "YYYY-MM-DD",
    "targetResourceId": "ID if updating or deleting",
    "clarificationPrompt": "One concise question if a required field is ambiguous",
    "status": "pending",
    "requiresConfirmation": true
  } | null,
  "suggestedActions": [
    "Conversational follow-up query 1",
    "Conversational follow-up query 2"
  ]
}`;
}

function validateAndSanitizeActionDraft(
  draft: any,
  originalRequest: string,
  userTimeZone: string,
  todayStr: string
): ActionDraft | null {
  if (!draft || typeof draft !== "object") return null;

  const validTypes: ActionType[] = [
    "create_event",
    "create_task",
    "update_event",
    "update_task",
    "complete_task",
    "delete_event",
    "delete_task",
  ];

  if (!validTypes.includes(draft.type)) {
    return null;
  }

  const rawTitle = typeof draft.title === "string" ? draft.title.trim() : "";
  if (!rawTitle && draft.type !== "complete_task" && draft.type !== "delete_task") {
    return null;
  }

  const id =
    typeof draft.id === "string" && draft.id.startsWith("act_")
      ? draft.id
      : `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  // Validate date format YYYY-MM-DD
  let date =
    typeof draft.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(draft.date.trim())
      ? draft.date.trim()
      : undefined;

  let dueDate =
    typeof draft.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(draft.dueDate.trim())
      ? draft.dueDate.trim()
      : draft.dueDate === "Today"
      ? todayStr
      : undefined;

  // Cross-fill if create_task or create_event had date in opposite field
  if (draft.type === "create_task" && !dueDate && date) {
    dueDate = date;
  }
  if (draft.type === "create_event" && !date && dueDate) {
    date = dueDate;
  }

  return {
    id,
    originalRequest: originalRequest || (typeof draft.originalRequest === "string" ? draft.originalRequest : ""),
    type: draft.type,
    title: rawTitle || "Untitled Item",
    description: typeof draft.description === "string" && draft.description.trim() ? draft.description.trim() : undefined,
    date,
    startTime: typeof draft.startTime === "string" && draft.startTime.trim() ? draft.startTime.trim() : undefined,
    endTime: typeof draft.endTime === "string" && draft.endTime.trim() ? draft.endTime.trim() : undefined,
    timeZone: typeof draft.timeZone === "string" && draft.timeZone.trim() ? draft.timeZone : userTimeZone,
    dueDate,
    targetResourceId: typeof draft.targetResourceId === "string" && draft.targetResourceId.trim() ? draft.targetResourceId : undefined,
    clarificationPrompt: typeof draft.clarificationPrompt === "string" && draft.clarificationPrompt.trim() ? draft.clarificationPrompt.trim() : undefined,
    status: "pending",
    requiresConfirmation: true,
  };
}

// In-memory model cache for zero-overhead candidate selection across invocations
let cachedWorkingModel = "gemini-flash-lite-latest";

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

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

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

  // 8. Build Optimized Gemini Contents with Dynamic System Prompt
  const userTimeZone = payload.context?.timeZone || "Asia/Kolkata";
  const userLocalDate = payload.context?.localDate || new Date().toISOString().split("T")[0];
  const dynamicSystemPrompt = buildSystemPrompt(payload.context);

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

  const activePageContext = payload.context?.activePage
    ? `[Active Page: ${payload.context.activePage}]\n`
    : "";

  contents.push({
    role: "user",
    parts: [{ text: `${activePageContext}${rawMessage}` }],
  });

  const wantsStreaming =
    Boolean(payload.stream) ||
    Boolean(req.headers.get("accept")?.includes("text/event-stream"));

  // 9. Call Gemini API with Latency Optimization
  const staticCandidates = [
    "gemini-flash-lite-latest",
    "gemini-3.1-flash-lite-preview",
    "gemma-4-26b-a4b-it",
  ];
  const modelsToTry = [
    cachedWorkingModel,
    ...staticCandidates.filter((m) => m !== cachedWorkingModel),
  ];

  let geminiResponseData: any = null;
  let lastApiStatus = 0;
  let successfulModel = "";
  let geminiDurationMs = 0;
  const triedCandidates: Array<{ model: string; status: number; durationMs: number; error?: string }> = [];

  for (const model of modelsToTry) {
    const geminiStart = performance.now();
    try {
      const generationConfig: Record<string, any> = {
        temperature: 0.5,
        maxOutputTokens: 700,
        responseMimeType: "application/json",
      };

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
              parts: [{ text: dynamicSystemPrompt }],
            },
            contents,
            generationConfig,
          }),
          signal: AbortSignal.timeout(4000),
        }
      );

      geminiDurationMs = performance.now() - geminiStart;
      lastApiStatus = response.status;

      if (response.ok) {
        geminiResponseData = await response.json();
        successfulModel = model;
        cachedWorkingModel = model;
        triedCandidates.push({ model, status: response.status, durationMs: Math.round(geminiDurationMs) });
        break;
      } else {
        const errorText = await response.text();
        triedCandidates.push({
          model,
          status: response.status,
          durationMs: Math.round(geminiDurationMs),
          error: errorText.slice(0, 100),
        });
        console.warn(
          `[echo-assistant] Model ${model} returned HTTP ${response.status} in ${geminiDurationMs.toFixed(0)}ms:`,
          errorText.slice(0, 120)
        );
      }
    } catch (fetchErr: any) {
      triedCandidates.push({
        model,
        status: 0,
        durationMs: Math.round(performance.now() - geminiStart),
        error: fetchErr.message,
      });
      console.warn(`[echo-assistant] ${model} error:`, fetchErr.message);
    }
  }

  // Dynamic discovery fallback if static candidates fail
  if (!geminiResponseData) {
    const deadModels = new Set([
      "gemini-2.0-flash",
      "gemini-1.5-flash",
      "gemini-flash-latest",
      "gemini-2.5-flash",
      "gemini-2.5-pro",
      "gemini-2.5-flash-preview-tts",
      "gemini-2.5-pro-preview-tts",
      "gemini-pro-latest",
      "gemini-2.5-flash-lite",
      "gemini-2.5-flash-image",
      "gemini-3-flash-preview",
      "gemini-3.1-pro-preview",
      "gemini-3.1-pro-preview-customtools",
      "gemma-4-31b-it",
    ]);
    try {
      const listRes = await fetch("https://generativelanguage.googleapis.com/v1beta/models", {
        headers: { "x-goog-api-key": geminiApiKey },
        signal: AbortSignal.timeout(4000),
      });
      if (listRes.ok) {
        const listData = await listRes.json();
        const availableModels: string[] = (listData.models || [])
          .filter((m: any) => m.supportedGenerationMethods?.includes("generateContent"))
          .map((m: any) => (m.name || "").replace("models/", ""))
          .filter((m: string) => Boolean(m) && !deadModels.has(m) && !modelsToTry.includes(m));

        for (const candidateModel of availableModels) {
          const dynamicStart = performance.now();
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
                  systemInstruction: { parts: [{ text: dynamicSystemPrompt }] },
                  contents,
                  generationConfig: {
                    temperature: 0.5,
                    maxOutputTokens: 700,
                    responseMimeType: "application/json",
                  },
                }),
                signal: AbortSignal.timeout(4000),
              }
            );
            const dDur = performance.now() - dynamicStart;
            if (dynamicRes.ok) {
              geminiResponseData = await dynamicRes.json();
              successfulModel = candidateModel;
              cachedWorkingModel = candidateModel;
              geminiDurationMs = dDur;
              triedCandidates.push({ model: candidateModel, status: dynamicRes.status, durationMs: Math.round(dDur) });
              break;
            } else {
              const errTxt = await dynamicRes.text();
              triedCandidates.push({ model: candidateModel, status: dynamicRes.status, durationMs: Math.round(dDur), error: errTxt.slice(0, 100) });
            }
          } catch (dynErr: any) {
            triedCandidates.push({ model: candidateModel, status: 0, durationMs: Math.round(performance.now() - dynamicStart), error: dynErr.message });
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

  let structured: {
    reply?: string;
    detectedLanguage?: string;
    suggestedActions?: string[];
    actionDraft?: any;
  } | null = null;

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
          actionDraft: null,
        };
      }
    }
  } else {
    structured = {
      reply: "I heard you, but I wasn't able to complete that thought. Could you say that again?",
      detectedLanguage: "en",
      suggestedActions: [],
      actionDraft: null,
    };
  }

  // Validate and sanitize action draft on the server before execution
  const validatedActionDraft = validateAndSanitizeActionDraft(
    structured.actionDraft,
    rawMessage,
    userTimeZone,
    userLocalDate
  );

  const totalEdgeDurationMs = performance.now() - edgeStart;

  console.log(
    `[echo-assistant] user=${userId.slice(0, 8)} model=${successfulModel} authMs=${authDurationMs.toFixed(0)} geminiMs=${geminiDurationMs.toFixed(0)} totalMs=${totalEdgeDurationMs.toFixed(0)} actionDraft=${validatedActionDraft ? validatedActionDraft.type : "none"}`
  );

  const finalResponseObj = {
    reply: structured.reply || "I'm here with you.",
    detectedLanguage: structured.detectedLanguage || "en",
    actionDraft: validatedActionDraft,
    suggestedActions: Array.isArray(structured.suggestedActions)
      ? structured.suggestedActions.filter((s) => typeof s === "string" && s.trim().length > 0)
      : [],
    metrics: {
      authMs: Math.round(authDurationMs),
      geminiMs: Math.round(geminiDurationMs),
      edgeMs: Math.round(totalEdgeDurationMs),
      model: successfulModel,
      triedCandidates,
    },
  };

  // If client requested SSE streaming, stream the response via Server-Sent Events
  if (wantsStreaming) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(`event: delta\ndata: ${JSON.stringify({ text: finalResponseObj.reply })}\n\n`)
        );
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
