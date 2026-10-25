import { supabase, getCurrentSession, getAuthRedirectUrl } from "./supabaseClient";
import type { CalendarEvent, TaskItem, GoogleSyncStatus } from "../types";

const EDGE_FUNCTION_NAME = "echo-google-sync";
const STATUS_CACHE_KEY = "echo_google_sync_status_cache_v1";

/**
 * Retrieve cached status synchronously to prevent initial render latency.
 */
export function getCachedGoogleSyncStatus(): GoogleSyncStatus {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const raw = window.localStorage.getItem(STATUS_CACHE_KEY);
      if (raw) {
        return JSON.parse(raw);
      }
    }
  } catch {
    // fallback
  }
  return { isConnected: false, calendarConnected: false, tasksConnected: false };
}

/**
 * Fetch the current Google connection and sync status from the backend Edge Function.
 */
export async function getGoogleSyncStatus(): Promise<GoogleSyncStatus> {
  try {
    const session = await getCurrentSession();
    if (!session || !session.access_token) {
      return { isConnected: false, calendarConnected: false, tasksConnected: false };
    }

    const { data, error } = await supabase.functions.invoke(EDGE_FUNCTION_NAME, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    });

    if (error) {
      console.warn("[GoogleSync] Error getting sync status:", error);
      return { isConnected: false, calendarConnected: false, tasksConnected: false, error: error.message };
    }

    const status: GoogleSyncStatus = {
      isConnected: Boolean(data?.isConnected),
      calendarConnected: Boolean(data?.calendarConnected),
      tasksConnected: Boolean(data?.tasksConnected),
      googleEmail: data?.googleEmail || null,
      lastSyncedAt: data?.lastSyncedAt || null,
      scopes: data?.scopes || [],
    };

    // Cache locally for instantaneous startup on next session
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        window.localStorage.setItem(STATUS_CACHE_KEY, JSON.stringify(status));
      }
    } catch {
      // ignore
    }

    return status;
  } catch (err: any) {
    console.error("[GoogleSync] Exception fetching status:", err);
    return { isConnected: false, calendarConnected: false, tasksConnected: false, error: err?.message };
  }
}

/**
 * Initiate incremental Google OAuth for Calendar and Tasks scopes.
 * Requests offline access for token renewal without interrupting the active Supabase session.
 */
export async function connectGoogleWorkspaceOAuth(customRedirect?: string) {
  const redirectUrl = getAuthRedirectUrl(customRedirect);
  const result = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: redirectUrl,
      scopes: "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/tasks",
      queryParams: {
        access_type: "offline",
        prompt: "consent select_account",
      },
    },
  });

  if (result.data?.url && typeof window !== "undefined") {
    window.location.href = result.data.url;
  }
  return result;
}

/**
 * Sends newly received Google provider tokens from the Supabase session to the backend
 * for secure AES-GCM server-side encryption and storage.
 */
export async function linkSessionTokens(providerToken: string, providerRefreshToken?: string | null): Promise<boolean> {
  if (!providerToken) return false;

  try {
    const session = await getCurrentSession();
    if (!session || !session.access_token) return false;

    const { data, error } = await supabase.functions.invoke(
      `${EDGE_FUNCTION_NAME}/link-session-tokens`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
        body: {
          provider_token: providerToken,
          provider_refresh_token: providerRefreshToken || "",
        },
      }
    );

    if (error) {
      console.error("[GoogleSync] Failed to link provider tokens:", error);
      return false;
    }

    return Boolean(data?.success);
  } catch (err) {
    console.error("[GoogleSync] Error linking session tokens:", err);
    return false;
  }
}

/**
 * Disconnect Google Workspace: revokes tokens at Google and marks connection inactive in backend.
 */
export async function disconnectGoogleWorkspace(): Promise<boolean> {
  try {
    const session = await getCurrentSession();
    if (!session || !session.access_token) return true;

    const { data, error } = await supabase.functions.invoke(
      `${EDGE_FUNCTION_NAME}/disconnect`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      }
    );

    if (error) {
      console.error("[GoogleSync] Disconnect error:", error);
      return false;
    }

    if (data?.success) {
      try {
        if (typeof window !== "undefined" && window.localStorage) {
          window.localStorage.removeItem(STATUS_CACHE_KEY);
        }
      } catch {
        // ignore
      }
    }

    return Boolean(data?.success);
  } catch (err) {
    console.error("[GoogleSync] Exception during disconnect:", err);
    return false;
  }
}

// =========================================================================
// GOOGLE CALENDAR CRUD
// =========================================================================

/**
 * Fetch user's Google Calendar events.
 */
export async function fetchGoogleCalendarEvents(
  timeMin?: string,
  timeMax?: string
): Promise<{ events: CalendarEvent[]; syncToken?: string }> {
  const session = await getCurrentSession();
  if (!session || !session.access_token) return { events: [] };

  const queryParams = new URLSearchParams();
  if (timeMin) queryParams.set("timeMin", timeMin);
  if (timeMax) queryParams.set("timeMax", timeMax);
  const path = queryParams.toString()
    ? `${EDGE_FUNCTION_NAME}/calendar/events?${queryParams.toString()}`
    : `${EDGE_FUNCTION_NAME}/calendar/events`;

  const { data, error } = await supabase.functions.invoke(path, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
  });

  if (error) {
    console.warn("[GoogleSync] Error fetching calendar events:", error);
    throw new Error(error.message || "Failed to fetch Google Calendar events.");
  }

  return {
    events: Array.isArray(data?.events) ? data.events : [],
    syncToken: data?.syncToken,
  };
}

/**
 * Create a new event in Google Calendar.
 */
export async function createGoogleCalendarEvent(
  event: Omit<CalendarEvent, "id">
): Promise<CalendarEvent> {
  const session = await getCurrentSession();
  if (!session || !session.access_token) {
    throw new Error("You must be signed in to create Google Calendar events.");
  }

  const { data, error } = await supabase.functions.invoke(
    `${EDGE_FUNCTION_NAME}/calendar/events`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
      body: event,
    }
  );

  if (error || !data?.event) {
    throw new Error(error?.message || "Failed to create event on Google Calendar.");
  }

  return data.event;
}

/**
 * Update an existing event in Google Calendar.
 */
export async function updateGoogleCalendarEvent(
  googleEventId: string,
  updates: Partial<CalendarEvent>
): Promise<CalendarEvent> {
  const session = await getCurrentSession();
  if (!session || !session.access_token) {
    throw new Error("You must be signed in to update Google Calendar events.");
  }

  const cleanId = googleEventId.replace(/^google-/, "");
  const { data, error } = await supabase.functions.invoke(
    `${EDGE_FUNCTION_NAME}/calendar/events/${encodeURIComponent(cleanId)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
      body: updates,
    }
  );

  if (error || !data?.event) {
    throw new Error(error?.message || "Failed to update event on Google Calendar.");
  }

  return data.event;
}

/**
 * Update reminder configuration for a Google Calendar event.
 * minutes = null removes custom reminders (overrides: []).
 * minutes = number sets a popup reminder N minutes before the event.
 */
export async function updateCalendarEventReminders(
  googleEventId: string,
  minutes: number | null
): Promise<CalendarEvent> {
  const session = await getCurrentSession();
  if (!session || !session.access_token) {
    throw new Error("You must be signed in to configure Google Calendar reminders.");
  }

  const cleanId = googleEventId.replace(/^google-/, "");
  const remindersPayload = {
    useDefault: false,
    overrides: minutes !== null && minutes >= 0
      ? [{ method: "popup", minutes }]
      : [],
  };

  const { data, error } = await supabase.functions.invoke(
    `${EDGE_FUNCTION_NAME}/calendar/events/${encodeURIComponent(cleanId)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
      body: {
        reminders: remindersPayload,
      },
    }
  );

  if (error || !data?.event) {
    throw new Error(error?.message || "Failed to update reminder settings on Google Calendar.");
  }

  return data.event;
}

/**
 * Delete an event from Google Calendar.
 */
export async function deleteGoogleCalendarEvent(googleEventId: string): Promise<void> {
  const session = await getCurrentSession();
  if (!session || !session.access_token) {
    throw new Error("You must be signed in to delete Google Calendar events.");
  }

  const cleanId = googleEventId.replace(/^google-/, "");
  const { error } = await supabase.functions.invoke(
    `${EDGE_FUNCTION_NAME}/calendar/events/${encodeURIComponent(cleanId)}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    }
  );

  if (error) {
    throw new Error(error.message || "Failed to delete event from Google Calendar.");
  }
}

// =========================================================================
// GOOGLE TASKS CRUD
// =========================================================================

/**
 * Fetch user's Google Tasks.
 */
export async function fetchGoogleTasks(): Promise<TaskItem[]> {
  const session = await getCurrentSession();
  if (!session || !session.access_token) return [];

  const { data, error } = await supabase.functions.invoke(`${EDGE_FUNCTION_NAME}/tasks`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
  });

  if (error) {
    console.warn("[GoogleSync] Error fetching tasks:", error);
    throw new Error(error.message || "Failed to fetch Google Tasks.");
  }

  return Array.isArray(data?.tasks) ? data.tasks : [];
}

/**
 * Create a task in Google Tasks.
 */
export async function createGoogleTask(task: Omit<TaskItem, "id">): Promise<TaskItem> {
  const session = await getCurrentSession();
  if (!session || !session.access_token) {
    throw new Error("You must be signed in to create Google tasks.");
  }

  const { data, error } = await supabase.functions.invoke(`${EDGE_FUNCTION_NAME}/tasks`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
    },
    body: task,
  });

  if (error || !data?.task) {
    throw new Error(error?.message || "Failed to create Google task.");
  }

  return data.task;
}

/**
 * Update/toggle a task in Google Tasks.
 */
export async function updateGoogleTask(
  googleTaskId: string,
  updates: Partial<Omit<TaskItem, "id">>
): Promise<TaskItem> {
  const session = await getCurrentSession();
  if (!session || !session.access_token) {
    throw new Error("You must be signed in to update Google tasks.");
  }

  const cleanId = googleTaskId.replace(/^gtask-/, "");
  const { data, error } = await supabase.functions.invoke(
    `${EDGE_FUNCTION_NAME}/tasks/${encodeURIComponent(cleanId)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
      body: updates,
    }
  );

  if (error || !data?.task) {
    throw new Error(error?.message || "Failed to update Google task.");
  }

  return data.task;
}

/**
 * Delete a task in Google Tasks.
 */
export async function deleteGoogleTask(googleTaskId: string): Promise<void> {
  const session = await getCurrentSession();
  if (!session || !session.access_token) {
    throw new Error("You must be signed in to delete Google tasks.");
  }

  const cleanId = googleTaskId.replace(/^gtask-/, "");
  const { error } = await supabase.functions.invoke(
    `${EDGE_FUNCTION_NAME}/tasks/${encodeURIComponent(cleanId)}`,
    {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
      },
    }
  );

  if (error) {
    throw new Error(error.message || "Failed to delete Google task.");
  }
}
