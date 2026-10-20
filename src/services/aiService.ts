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

  // 3. Make authenticated request with timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25000);

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

    const data = await response.json().catch(() => null);

    if (response.ok && data) {
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
