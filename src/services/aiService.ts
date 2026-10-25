import { getCurrentSession } from "./supabaseClient";
import type { Message } from "../types";

export interface AiAssistantResponse {
  reply: string;
  detectedLanguage?: string;
  suggestedActions?: string[];
}

export class AiServiceError extends Error {
  code: "AUTH_REQUIRED" | "AUTH_EXPIRED" | "RATE_LIMITED" | "SERVICE_UNAVAILABLE" | "NETWORK_ERROR" | "GENERAL";
  retryAfter?: number;

  constructor(
    message: string,
    code: "AUTH_REQUIRED" | "AUTH_EXPIRED" | "RATE_LIMITED" | "SERVICE_UNAVAILABLE" | "NETWORK_ERROR" | "GENERAL",
    retryAfter?: number
  ) {
    super(message);
    this.name = "AiServiceError";
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || "https://mewxhhifntjkedgptxqi.supabase.co";
const FUNCTION_URL = `${supabaseUrl}/functions/v1/echo-assistant`;

export async function sendChatMessage(
  message: string,
  context?: {
    activePage?: string;
    history?: Message[];
  }
): Promise<AiAssistantResponse> {
  const trimmed = message.trim();
  if (!trimmed) {
    throw new AiServiceError("Message cannot be empty.", "GENERAL");
  }

  // 1. Verify Authentication & obtain user access_token
  const session = await getCurrentSession();
  if (!session || !session.access_token) {
    throw new AiServiceError(
      "Please sign in with your account to converse with Echo Companion.",
      "AUTH_REQUIRED"
    );
  }

  // 2. Prepare payload
  const historyPayload = context?.history
    ?.filter((m) => !m.isError)
    ?.slice(-6)
    ?.map((m) => ({
      role: m.role,
      text: m.text,
    }));

  const payload = {
    message: trimmed,
    context: {
      activePage: context?.activePage,
      history: historyPayload,
    },
  };

  // 3. Make authenticated request with timing instrumentation
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);
  const reqStart = performance.now();

  try {
    const response = await fetch(FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const reqDuration = performance.now() - reqStart;

    const data = await response.json().catch(() => null);

    if (response.ok && data) {
      // Safe telemetry log: timings only, no prompt or credential
      const serverTiming = response.headers.get("Server-Timing");
      console.log(
        `[Echo AI Timing] Total: ${reqDuration.toFixed(0)}ms | Edge: ${data.metrics?.edgeMs || "?"}ms | Model: ${data.metrics?.geminiMs || "?"}ms | Auth: ${data.metrics?.authMs || "?"}ms | Server-Timing: ${serverTiming || "n/a"}`
      );

      return {
        reply: typeof data.reply === "string" ? data.reply : "I am here.",
        detectedLanguage: data.detectedLanguage,
        suggestedActions: Array.isArray(data.suggestedActions) ? data.suggestedActions : [],
      };
    }

    // Handle specific status codes
    if (response.status === 401) {
      throw new AiServiceError(
        "Your session has expired or is invalid. Please sign in again.",
        "AUTH_EXPIRED"
      );
    }

    if (response.status === 429) {
      const retryAfter = data?.retryAfter || 15;
      throw new AiServiceError(
        `Too many requests. Please pause for ${retryAfter}s before sending another thought.`,
        "RATE_LIMITED",
        retryAfter
      );
    }

    if (response.status === 503) {
      throw new AiServiceError(
        data?.error || "Echo AI service is temporarily unavailable. Check server configuration.",
        "SERVICE_UNAVAILABLE"
      );
    }

    throw new AiServiceError(
      data?.error || "Echo was unable to process this request. Please try again.",
      "GENERAL"
    );
  } catch (err: unknown) {
    clearTimeout(timeoutId);

    if (err instanceof AiServiceError) {
      throw err;
    }

    if (err instanceof Error && err.name === "AbortError") {
      throw new AiServiceError(
        "Request timed out. Echo took a little too long to respond. Please try again.",
        "NETWORK_ERROR"
      );
    }

    throw new AiServiceError(
      "Network connection issue reaching Echo assistant. Please check your connection.",
      "NETWORK_ERROR"
    );
  }
}

export async function streamChatMessage(
  message: string,
  callbacks: {
    onDelta?: (deltaText: string) => void;
    onComplete?: (response: AiAssistantResponse) => void;
  },
  context?: {
    activePage?: string;
    history?: Message[];
  }
): Promise<AiAssistantResponse> {
  const trimmed = message.trim();
  if (!trimmed) {
    throw new AiServiceError("Message cannot be empty.", "GENERAL");
  }

  const session = await getCurrentSession();
  if (!session || !session.access_token) {
    throw new AiServiceError(
      "Please sign in with your account to converse with Echo Companion.",
      "AUTH_REQUIRED"
    );
  }

  const historyPayload = context?.history
    ?.filter((m) => !m.isError)
    ?.slice(-4)
    ?.map((m) => ({
      role: m.role,
      text: m.text,
    }));

  const payload = {
    message: trimmed,
    stream: true,
    context: {
      activePage: context?.activePage,
      history: historyPayload,
    },
  };

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 20000);
  const reqStart = performance.now();

  try {
    const response = await fetch(FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const reqDuration = performance.now() - reqStart;

    if (!response.ok) {
      if (response.status === 401) {
        throw new AiServiceError("Your session has expired. Please sign in again.", "AUTH_EXPIRED");
      }
      if (response.status === 429) {
        throw new AiServiceError("Too many requests. Please wait a moment.", "RATE_LIMITED");
      }
      throw new AiServiceError("Echo AI service unavailable. Please try again.", "SERVICE_UNAVAILABLE");
    }

    // Process SSE stream
    if (!response.body) {
      return sendChatMessage(message, context); // fallback to standard call
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let finalResult: AiAssistantResponse = {
      reply: "",
      detectedLanguage: "en",
      suggestedActions: [],
    };

    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n\n");
      buffer = lines.pop() || "";

      for (const block of lines) {
        const dataMatch = block.match(/data:\s*(.*)/);
        if (dataMatch && dataMatch[1]) {
          try {
            const parsed = JSON.parse(dataMatch[1]);
            if (parsed.text && callbacks.onDelta) {
              callbacks.onDelta(parsed.text);
            }
            if (parsed.reply) {
              finalResult = {
                reply: parsed.reply,
                detectedLanguage: parsed.detectedLanguage || "en",
                suggestedActions: Array.isArray(parsed.suggestedActions) ? parsed.suggestedActions : [],
              };
            }
          } catch {
            // ignore non-json keepalives
          }
        }
      }
    }

    console.log(`[Echo AI Stream] Completed in ${reqDuration.toFixed(0)}ms`);
    callbacks.onComplete?.(finalResult);
    return finalResult;
  } catch (err: unknown) {
    clearTimeout(timeoutId);
    if (err instanceof AiServiceError) throw err;
    // Fall back smoothly to non-streaming if stream read encounters transport issues
    return sendChatMessage(message, context);
  }
}

