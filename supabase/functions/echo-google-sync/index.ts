import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
};

// Simple lightweight encryption helper using Web Crypto AES-GCM
async function getCryptoKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret.padEnd(32, "0").slice(0, 32)),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
  return keyMaterial;
}

async function encryptToken(plainText: string, secret: string): Promise<string> {
  if (!plainText) return "";
  const key = await getCryptoKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(plainText)
  );
  const ivHex = Array.from(iv).map((b) => b.toString(16).padStart(2, "0")).join("");
  const encHex = Array.from(new Uint8Array(encrypted)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${ivHex}:${encHex}`;
}

async function decryptToken(cipherHex: string, secret: string): Promise<string> {
  if (!cipherHex || !cipherHex.includes(":")) return "";
  const [ivHex, encHex] = cipherHex.split(":");
  const iv = new Uint8Array(ivHex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)));
  const encBytes = new Uint8Array(encHex.match(/.{1,2}/g)!.map((byte) => parseInt(byte, 16)));
  const key = await getCryptoKey(secret);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    encBytes
  );
  return new TextDecoder().decode(decrypted);
}

// Parse 12-hour or 24-hour time string into "HH:MM:SS" (24h)
function parseTimeTo24h(tStr?: string | null): string | null {
  if (!tStr) return null;
  const trimmed = tStr.trim();
  // 12-hour format e.g. "02:00 PM", "2:00 PM", "2 PM", "02:00:00 PM", "2pm"
  const match12 = trimmed.match(/^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(AM|PM)$/i);
  if (match12) {
    let h = parseInt(match12[1], 10);
    const m = match12[2] ? parseInt(match12[2], 10) : 0;
    const s = match12[3] ? parseInt(match12[3], 10) : 0;
    const isPM = match12[4].toUpperCase() === "PM";
    if (isPM && h < 12) h += 12;
    if (!isPM && h === 12) h = 0;
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  // 24-hour format e.g. "14:00", "14:00:00"
  const match24 = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (match24) {
    const h = parseInt(match24[1], 10);
    const m = parseInt(match24[2], 10);
    const s = match24[3] ? parseInt(match24[3], 10) : 0;
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return null;
}

// Convert date, 24h time and timezone into RFC3339 string with timezone offset
function getRfc3339WithOffset(dateStr: string, time24h: string, tz?: string): { dateTime: string; timeZone: string } {
  let targetTz = (tz && tz.trim()) ? tz.trim() : "Asia/Kolkata";
  if (targetTz === "Asia/Calcutta") targetTz = "Asia/Kolkata";

  let offset = "+05:30";
  try {
    const dummyDate = new Date(`${dateStr}T12:00:00Z`);
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: targetTz,
      timeZoneName: "longOffset",
    }).formatToParts(dummyDate);
    const tzPart = parts.find((p) => p.type === "timeZoneName");
    if (tzPart?.value) {
      const match = tzPart.value.match(/GMT([+-]\d{2}:\d{2})/);
      if (match) {
        offset = match[1];
      } else if (tzPart.value === "GMT") {
        offset = "Z";
      }
    }
  } catch {
    offset = "+05:30";
  }

  const formattedTime = time24h.length === 5 ? `${time24h}:00` : time24h;

  return {
    dateTime: `${dateStr}T${formattedTime}${offset === "Z" ? "Z" : offset}`,
    timeZone: targetTz,
  };
}

// Map Google Calendar Category
function mapCalendarCategory(summary: string): "Team Sync" | "Focus Time" | "Meeting" | "Personal" | "Review" {
  const lower = (summary || "").toLowerCase();
  if (lower.includes("focus") || lower.includes("deep work") || lower.includes("study")) return "Focus Time";
  if (lower.includes("sync") || lower.includes("standup") || lower.includes("scrum")) return "Team Sync";
  if (lower.includes("review") || lower.includes("retrospective") || lower.includes("critique")) return "Review";
  if (lower.includes("personal") || lower.includes("lunch") || lower.includes("doctor") || lower.includes("gym")) return "Personal";
  return "Meeting";
}

// Map Google Calendar Event to Echo CalendarEvent
function formatGoogleEvent(gEvent: any) {
  const start = gEvent.start?.dateTime || gEvent.start?.date || "";
  const end = gEvent.end?.dateTime || gEvent.end?.date || "";
  const isAllDay = Boolean(gEvent.start?.date && !gEvent.start?.dateTime);

  let dateStr = "";
  let timeStr = "All day";

  if (start) {
    if (isAllDay) {
      dateStr = start.slice(0, 10);
      timeStr = "All day";
    } else {
      dateStr = start.slice(0, 10);

      const formatIsoTime = (rawIso: string) => {
        const tMatch = rawIso.match(/T(\d{1,2}):(\d{2})/);
        if (tMatch) {
          let hours = parseInt(tMatch[1], 10);
          const minutes = tMatch[2];
          const ampm = hours >= 12 ? "PM" : "AM";
          hours = hours % 12 || 12;
          return `${hours.toString().padStart(2, "0")}:${minutes} ${ampm}`;
        }
        return "";
      };

      const sTime = formatIsoTime(start);
      const eTime = end ? formatIsoTime(end) : "";
      timeStr = sTime && eTime ? `${sTime} - ${eTime}` : (sTime || "All day");
    }
  }

  return {
    id: `google-${gEvent.id}`,
    googleEventId: gEvent.id,
    title: gEvent.summary || "(No title)",
    date: dateStr,
    time: timeStr,
    category: mapCalendarCategory(gEvent.summary),
    location: gEvent.location || "",
    description: gEvent.description || "",
    isDemo: false,
    source: "google" as const,
    reminders: gEvent.reminders
      ? {
          useDefault: Boolean(gEvent.reminders.useDefault),
          overrides: Array.isArray(gEvent.reminders.overrides) ? gEvent.reminders.overrides : [],
        }
      : null,
  };
}

// Map Google Task to Echo TaskItem
function formatGoogleTask(gTask: any) {
  let dueDate = "Today";
  if (gTask.due) {
    try {
      const d = new Date(gTask.due);
      dueDate = d.toISOString().split("T")[0];
    } catch {
      dueDate = "Today";
    }
  }

  return {
    id: `gtask-${gTask.id}`,
    googleTaskId: gTask.id,
    title: gTask.title || "(Untitled Task)",
    completed: gTask.status === "completed",
    dueDate,
    category: "Work" as const,
    priority: "Medium" as const,
    notes: gTask.notes || "",
    updated: gTask.updated || "",
    source: "google" as const,
  };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const url = new URL(req.url);
  // Strip /functions/v1 and /echo-google-sync prefixes
  const pathname = url.pathname
    .replace(/^\/functions\/v1/, "")
    .replace(/^\/echo-google-sync/, "")
    .replace(/\/$/, "");

  const supabaseUrl = Deno.env.get("SUPABASE_URL") || "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const cryptoSecret = supabaseServiceRoleKey || "echo-default-secret-salt-2026";

  const authHeader = req.headers.get("Authorization");
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return new Response(
      JSON.stringify({ error: "Missing or invalid Authorization header." }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // Verify Supabase User
  const supabaseUserClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: { user }, error: userError } = await supabaseUserClient.auth.getUser();
  if (userError || !user) {
    return new Response(
      JSON.stringify({ error: "Unauthorized session." }),
      { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const userId = user.id;

  // Supabase Admin client for backend-isolated token storage
  const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false },
  });

  // Helper to fetch user's active Google connection record
  async function getConnectionRecord() {
    const { data, error } = await supabaseAdmin
      .from("user_google_connections")
      .select("*")
      .eq("user_id", userId)
      .eq("is_connected", true)
      .maybeSingle();

    if (error || !data) return null;
    return data;
  }

  // Helper to retrieve decrypted valid access token (refreshes if expired or forced)
  async function getValidAccessToken(forceRefresh = false): Promise<{ token: string; email: string } | null> {
    const record = await getConnectionRecord();
    if (!record) return null;

    let accessToken = "";
    if (record.encrypted_access_token) {
      try {
        accessToken = await decryptToken(record.encrypted_access_token, cryptoSecret);
      } catch {
        accessToken = "";
      }
    }

    const expiresAt = record.token_expires_at ? new Date(record.token_expires_at).getTime() : 0;
    const isExpired = Date.now() >= expiresAt - 60000; // Refresh 1 min before expiry

    if (!forceRefresh && !isExpired && accessToken) {
      return { token: accessToken, email: record.google_account_email || "" };
    }

    // Attempt token refresh via refresh token
    if (record.encrypted_refresh_token) {
      try {
        const refreshToken = await decryptToken(record.encrypted_refresh_token, cryptoSecret);
        const clientId = Deno.env.get("GOOGLE_CLIENT_ID") || "";
        const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET") || "";

        if (refreshToken && clientId && clientSecret) {
          const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              client_id: clientId,
              client_secret: clientSecret,
              refresh_token: refreshToken,
              grant_type: "refresh_token",
            }),
          });

          if (tokenRes.ok) {
            const tokenData = await tokenRes.json();
            const newAccess = tokenData.access_token;
            const newExpires = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();
            const encryptedAccess = await encryptToken(newAccess, cryptoSecret);

            await supabaseAdmin
              .from("user_google_connections")
              .update({
                encrypted_access_token: encryptedAccess,
                token_expires_at: newExpires,
                updated_at: new Date().toISOString(),
              })
              .eq("id", record.id);

            return { token: newAccess, email: record.google_account_email || "" };
          }
        }
      } catch (refreshErr) {
        console.warn("[echo-google-sync] Failed to refresh Google access token:", refreshErr);
      }
    }

    // If still have access token and not strictly forcing refresh, return it
    if (!forceRefresh && accessToken) {
      return { token: accessToken, email: record.google_account_email || "" };
    }

    return null;
  }

  // -------------------------------------------------------------
  // ROUTE 1: GET /status
  // -------------------------------------------------------------
  if (req.method === "GET" && (pathname === "" || pathname === "/status")) {
    const record = await getConnectionRecord();
    const isConnected = Boolean(record && record.is_connected);

    return new Response(
      JSON.stringify({
        isConnected,
        calendarConnected: isConnected,
        tasksConnected: isConnected,
        googleEmail: record?.google_account_email || null,
        scopes: record?.scopes || [],
        lastSyncedAt: record?.last_synced_at || null,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  // -------------------------------------------------------------
  // ROUTE 2: POST /link-session-tokens
  // -------------------------------------------------------------
  if (req.method === "POST" && pathname === "/link-session-tokens") {
    try {
      const body = await req.json();
      const providerToken = typeof body.provider_token === "string" ? body.provider_token.trim() : "";
      const providerRefreshToken = typeof body.provider_refresh_token === "string" ? body.provider_refresh_token.trim() : "";

      if (!providerToken) {
        return new Response(
          JSON.stringify({ error: "Missing provider_token." }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Verify token with Google UserInfo
      const userinfoRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
        headers: { Authorization: `Bearer ${providerToken}` },
      });

      if (!userinfoRes.ok) {
        return new Response(
          JSON.stringify({ error: "Invalid Google provider token." }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const googleUser = await userinfoRes.json();
      const googleEmail = googleUser.email || "";

      const encAccess = await encryptToken(providerToken, cryptoSecret);
      const encRefresh = providerRefreshToken ? await encryptToken(providerRefreshToken, cryptoSecret) : null;
      const expiresAt = new Date(Date.now() + 3500 * 1000).toISOString();

      const scopes = [
        "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/tasks",
      ];

      // Upsert connection record for user
      const { error: upsertErr } = await supabaseAdmin
        .from("user_google_connections")
        .upsert(
          {
            user_id: userId,
            service: "google_workspace",
            scopes,
            encrypted_access_token: encAccess,
            ...(encRefresh ? { encrypted_refresh_token: encRefresh } : {}),
            token_expires_at: expiresAt,
            google_account_email: googleEmail,
            is_connected: true,
            last_synced_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          },
          { onConflict: "user_id,service" }
        );

      if (upsertErr) {
        console.error("[echo-google-sync] Database upsert error:", upsertErr);
        return new Response(
          JSON.stringify({ error: "Failed to store connection record." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, googleEmail }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (err: any) {
      return new Response(
        JSON.stringify({ error: err.message || "Link tokens failed." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  }

  // -------------------------------------------------------------
  // ROUTE 3: POST /disconnect
  // -------------------------------------------------------------
  if (req.method === "POST" && pathname === "/disconnect") {
    try {
      const record = await getConnectionRecord();
      if (record && record.encrypted_access_token) {
        try {
          const token = await decryptToken(record.encrypted_access_token, cryptoSecret);
          if (token) {
            await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`, {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
            }).catch(() => null);
          }
        } catch {
          // ignore revocation network error
        }
      }

      await supabaseAdmin
        .from("user_google_connections")
        .update({
          is_connected: false,
          encrypted_access_token: null,
          encrypted_refresh_token: null,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId);

      return new Response(
        JSON.stringify({ success: true, message: "Google Workspace disconnected." }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } catch (err: any) {
      return new Response(
        JSON.stringify({ error: err.message || "Disconnect failed." }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  }

  // All downstream routes require an active Google access token
  const authState = await getValidAccessToken();
  if (!authState) {
    return new Response(
      JSON.stringify({
        error: "Google Workspace is not connected or token has expired. Please connect Google in settings.",
        code: "GOOGLE_NOT_CONNECTED",
      }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  let googleToken = authState.token;

  // -------------------------------------------------------------
  // ROUTE 4: Calendar Events (GET, POST, PATCH, DELETE)
  // -------------------------------------------------------------
  if (pathname === "/calendar/events" || pathname.startsWith("/calendar/events/")) {
    const eventId = pathname.replace(/^\/calendar\/events\/?/, "").trim();

    // GET /calendar/events
    if (req.method === "GET") {
      const timeMin = url.searchParams.get("timeMin") || new Date(Date.now() - 30 * 86400000).toISOString();
      const timeMax = url.searchParams.get("timeMax") || new Date(Date.now() + 60 * 86400000).toISOString();

      const gUrl = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
      gUrl.searchParams.set("singleEvents", "true");
      gUrl.searchParams.set("orderBy", "startTime");
      gUrl.searchParams.set("timeMin", timeMin);
      gUrl.searchParams.set("timeMax", timeMax);
      gUrl.searchParams.set("maxResults", "100");

      let gRes = await fetch(gUrl.toString(), {
        headers: { Authorization: `Bearer ${googleToken}` },
      });

      if (gRes.status === 401) {
        console.warn("[echo-google-sync] 401 fetching events. Attempting token refresh...");
        const refreshed = await getValidAccessToken(true);
        if (refreshed?.token) {
          googleToken = refreshed.token;
          gRes = await fetch(gUrl.toString(), {
            headers: { Authorization: `Bearer ${googleToken}` },
          });
        }
      }

      if (!gRes.ok) {
        const errorText = await gRes.text();
        return new Response(
          JSON.stringify({ error: "Failed to fetch Google Calendar events.", details: errorText }),
          { status: gRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const gData = await gRes.json();
      const items = Array.isArray(gData.items) ? gData.items : [];
      const events = items.map(formatGoogleEvent);

      // Update last_synced_at timestamp
      await supabaseAdmin
        .from("user_google_connections")
        .update({ last_synced_at: new Date().toISOString() })
        .eq("user_id", userId);

      return new Response(
        JSON.stringify({ events, syncToken: gData.nextSyncToken || null }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // POST /calendar/events (Create Event)
    if (req.method === "POST") {
      try {
        const body = await req.json();
        const title = (body.title || "New Event").trim();
        const dateStr = body.date || new Date().toISOString().split("T")[0];
        const location = body.location || "";
        const description = body.description || "";
        const timeZone = body.timeZone || "Asia/Kolkata";

        let startObj: any = { date: dateStr };
        let endObj: any = { date: dateStr };

        if (body.startDateTime && body.endDateTime) {
          const sHasOffset = /[Zz]|[+-]\d{2}:\d{2}$/.test(body.startDateTime);
          const eHasOffset = /[Zz]|[+-]\d{2}:\d{2}$/.test(body.endDateTime);
          startObj = {
            dateTime: sHasOffset ? body.startDateTime : `${body.startDateTime}+05:30`,
            timeZone,
          };
          endObj = {
            dateTime: eHasOffset ? body.endDateTime : `${body.endDateTime}+05:30`,
            timeZone,
          };
        } else {
          let rawStart = body.startTime || "";
          let rawEnd = body.endTime || "";

          if (!rawStart && body.time && body.time.includes(" - ")) {
            const [sPart, ePart] = body.time.split(" - ");
            rawStart = sPart.trim();
            rawEnd = ePart.trim();
          } else if (!rawStart && body.time && body.time !== "All day") {
            rawStart = body.time.trim();
          }

          const sTime = parseTimeTo24h(rawStart);
          let eTime = parseTimeTo24h(rawEnd);

          if (sTime) {
            if (!eTime) {
              const [sh, sm] = sTime.split(":").map(Number);
              const eh = (sh + 1) % 24;
              eTime = `${eh.toString().padStart(2, "0")}:${sm.toString().padStart(2, "0")}:00`;
            }
            startObj = getRfc3339WithOffset(dateStr, sTime, timeZone);
            endObj = getRfc3339WithOffset(dateStr, eTime, timeZone);
          }
        }

        const createPayload: Record<string, any> = {
          summary: title,
          location,
          description,
          start: startObj,
          end: endObj,
        };
        if (body.reminders !== undefined) {
          createPayload.reminders = body.reminders;
        }

        let activeToken = googleToken;
        let createRes = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${activeToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(createPayload),
        });

        // If 401 Unauthorized, force refresh token and retry once
        if (createRes.status === 401) {
          console.warn("[echo-google-sync] 401 on create event. Attempting token refresh...");
          const refreshed = await getValidAccessToken(true);
          if (refreshed?.token) {
            activeToken = refreshed.token;
            createRes = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${activeToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify(createPayload),
            });
          }
        }

        if (!createRes.ok) {
          const errText = await createRes.text();
          console.error("[echo-google-sync] Google Calendar create event error:", createRes.status, errText);
          return new Response(
            JSON.stringify({ error: "Failed to create Google Calendar event.", details: errText }),
            { status: createRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const createdData = await createRes.json();
        return new Response(
          JSON.stringify({ event: formatGoogleEvent(createdData) }),
          { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (err: any) {
        console.error("[echo-google-sync] Exception creating event:", err);
        return new Response(
          JSON.stringify({ error: err.message || "Create event failed." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // PATCH /calendar/events/:eventId
    if (req.method === "PATCH" && eventId) {
      try {
        const body = await req.json();
        const patchPayload: Record<string, any> = {};
        if (body.title !== undefined) patchPayload.summary = body.title;
        if (body.location !== undefined) patchPayload.location = body.location;
        if (body.description !== undefined) patchPayload.description = body.description;
        if (body.reminders !== undefined) patchPayload.reminders = body.reminders;

        const timeZone = body.timeZone || "Asia/Kolkata";
        const dateStr = body.date;

        if (dateStr) {
          let rawStart = body.startTime || "";
          let rawEnd = body.endTime || "";
          if (!rawStart && body.time && body.time.includes(" - ")) {
            const [sPart, ePart] = body.time.split(" - ");
            rawStart = sPart.trim();
            rawEnd = ePart.trim();
          } else if (!rawStart && body.time && body.time !== "All day") {
            rawStart = body.time.trim();
          }

          const sTime = parseTimeTo24h(rawStart);
          let eTime = parseTimeTo24h(rawEnd);

          if (sTime) {
            if (!eTime) {
              const [sh, sm] = sTime.split(":").map(Number);
              const eh = (sh + 1) % 24;
              eTime = `${eh.toString().padStart(2, "0")}:${sm.toString().padStart(2, "0")}:00`;
            }
            patchPayload.start = getRfc3339WithOffset(dateStr, sTime, timeZone);
            patchPayload.end = getRfc3339WithOffset(dateStr, eTime, timeZone);
          } else {
            patchPayload.start = { date: dateStr };
            patchPayload.end = { date: dateStr };
          }
        }

        let activeToken = googleToken;
        let patchRes = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${activeToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(patchPayload),
          }
        );

        if (patchRes.status === 401) {
          console.warn("[echo-google-sync] 401 on update event. Attempting token refresh...");
          const refreshed = await getValidAccessToken(true);
          if (refreshed?.token) {
            activeToken = refreshed.token;
            patchRes = await fetch(
              `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
              {
                method: "PATCH",
                headers: {
                  Authorization: `Bearer ${activeToken}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify(patchPayload),
              }
            );
          }
        }

        if (!patchRes.ok) {
          const errText = await patchRes.text();
          console.error("[echo-google-sync] Google Calendar update event error:", patchRes.status, errText);
          return new Response(
            JSON.stringify({ error: "Failed to update Google Calendar event.", details: errText }),
            { status: patchRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const updated = await patchRes.json();
        return new Response(
          JSON.stringify({ event: formatGoogleEvent(updated) }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (err: any) {
        console.error("[echo-google-sync] Exception updating event:", err);
        return new Response(
          JSON.stringify({ error: err.message || "Update event failed." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // DELETE /calendar/events/:eventId
    if (req.method === "DELETE" && eventId) {
      let activeToken = googleToken;
      let delRes = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${activeToken}` },
        }
      );

      if (delRes.status === 401) {
        console.warn("[echo-google-sync] 401 on delete event. Attempting token refresh...");
        const refreshed = await getValidAccessToken(true);
        if (refreshed?.token) {
          activeToken = refreshed.token;
          delRes = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(eventId)}`,
            {
              method: "DELETE",
              headers: { Authorization: `Bearer ${activeToken}` },
            }
          );
        }
      }

      if (!delRes.ok && delRes.status !== 404 && delRes.status !== 410) {
        const errText = await delRes.text();
        return new Response(
          JSON.stringify({ error: "Failed to delete Google Calendar event.", details: errText }),
          { status: delRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, deletedId: eventId }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  }

  // -------------------------------------------------------------
  // ROUTE 5: Google Tasks (GET, POST, PATCH, DELETE)
  // -------------------------------------------------------------
  if (pathname === "/tasks" || pathname.startsWith("/tasks/")) {
    const taskId = pathname.replace(/^\/tasks\/?/, "").trim();

    // GET /tasks
    if (req.method === "GET") {
      let activeToken = googleToken;
      let tasksRes = await fetch(
        "https://tasks.googleapis.com/tasks/v1/lists/@default/tasks?showCompleted=true&showHidden=true&maxResults=100",
        { headers: { Authorization: `Bearer ${activeToken}` } }
      );

      if (tasksRes.status === 401) {
        console.warn("[echo-google-sync] 401 fetching tasks. Attempting token refresh...");
        const refreshed = await getValidAccessToken(true);
        if (refreshed?.token) {
          activeToken = refreshed.token;
          tasksRes = await fetch(
            "https://tasks.googleapis.com/tasks/v1/lists/@default/tasks?showCompleted=true&showHidden=true&maxResults=100",
            { headers: { Authorization: `Bearer ${activeToken}` } }
          );
        }
      }

      if (!tasksRes.ok) {
        const errText = await tasksRes.text();
        return new Response(
          JSON.stringify({ error: "Failed to fetch Google Tasks.", details: errText }),
          { status: tasksRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const tasksData = await tasksRes.json();
      const rawTasks = Array.isArray(tasksData.items) ? tasksData.items : [];
      const tasks = rawTasks.map(formatGoogleTask);

      return new Response(
        JSON.stringify({ tasks }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // POST /tasks (Create Task)
    if (req.method === "POST") {
      try {
        const body = await req.json();
        const title = (body.title || "").trim();
        if (!title) {
          return new Response(
            JSON.stringify({ error: "Task title cannot be empty." }),
            { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const taskPayload: Record<string, any> = {
          title,
          notes: body.notes || "",
          status: body.completed ? "completed" : "needsAction",
        };

        if (body.dueDate) {
          try {
            if (body.dueDate === "Today") {
              taskPayload.due = `${new Date().toISOString().split("T")[0]}T00:00:00.000Z`;
            } else {
              taskPayload.due = `${new Date(body.dueDate).toISOString().split("T")[0]}T00:00:00.000Z`;
            }
          } catch {
            // ignore malformed date
          }
        }

        let activeToken = googleToken;
        let createRes = await fetch("https://tasks.googleapis.com/tasks/v1/lists/@default/tasks", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${activeToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(taskPayload),
        });

        if (createRes.status === 401) {
          console.warn("[echo-google-sync] 401 creating task. Attempting token refresh...");
          const refreshed = await getValidAccessToken(true);
          if (refreshed?.token) {
            activeToken = refreshed.token;
            createRes = await fetch("https://tasks.googleapis.com/tasks/v1/lists/@default/tasks", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${activeToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify(taskPayload),
            });
          }
        }

        if (!createRes.ok) {
          const errText = await createRes.text();
          console.error("[echo-google-sync] Google Tasks create error:", createRes.status, errText);
          return new Response(
            JSON.stringify({ error: "Failed to create Google task.", details: errText }),
            { status: createRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const created = await createRes.json();
        return new Response(
          JSON.stringify({ task: formatGoogleTask(created) }),
          { status: 201, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (err: any) {
        console.error("[echo-google-sync] Exception creating task:", err);
        return new Response(
          JSON.stringify({ error: err.message || "Create task failed." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // PATCH /tasks/:taskId (Update/Toggle Task)
    if (req.method === "PATCH" && taskId) {
      try {
        const body = await req.json();
        const patchPayload: Record<string, any> = {};

        if (body.title !== undefined) patchPayload.title = body.title;
        if (body.notes !== undefined) patchPayload.notes = body.notes;
        if (body.completed !== undefined) {
          patchPayload.status = body.completed ? "completed" : "needsAction";
          if (body.completed) {
            patchPayload.completed = new Date().toISOString();
          }
        }
        if (body.dueDate) {
          try {
            if (body.dueDate === "Today") {
              patchPayload.due = `${new Date().toISOString().split("T")[0]}T00:00:00.000Z`;
            } else {
              patchPayload.due = `${new Date(body.dueDate).toISOString().split("T")[0]}T00:00:00.000Z`;
            }
          } catch {
            // ignore
          }
        }

        let activeToken = googleToken;
        let patchRes = await fetch(
          `https://tasks.googleapis.com/tasks/v1/lists/@default/tasks/${encodeURIComponent(taskId)}`,
          {
            method: "PATCH",
            headers: {
              Authorization: `Bearer ${activeToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(patchPayload),
          }
        );

        if (patchRes.status === 401) {
          console.warn("[echo-google-sync] 401 updating task. Attempting token refresh...");
          const refreshed = await getValidAccessToken(true);
          if (refreshed?.token) {
            activeToken = refreshed.token;
            patchRes = await fetch(
              `https://tasks.googleapis.com/tasks/v1/lists/@default/tasks/${encodeURIComponent(taskId)}`,
              {
                method: "PATCH",
                headers: {
                  Authorization: `Bearer ${activeToken}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify(patchPayload),
              }
            );
          }
        }

        if (!patchRes.ok) {
          const errText = await patchRes.text();
          console.error("[echo-google-sync] Google Tasks update error:", patchRes.status, errText);
          return new Response(
            JSON.stringify({ error: "Failed to update Google task.", details: errText }),
            { status: patchRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }

        const updated = await patchRes.json();
        return new Response(
          JSON.stringify({ task: formatGoogleTask(updated) }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (err: any) {
        console.error("[echo-google-sync] Exception updating task:", err);
        return new Response(
          JSON.stringify({ error: err.message || "Update task failed." }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    }

    // DELETE /tasks/:taskId
    if (req.method === "DELETE" && taskId) {
      let activeToken = googleToken;
      let delRes = await fetch(
        `https://tasks.googleapis.com/tasks/v1/lists/@default/tasks/${encodeURIComponent(taskId)}`,
        {
          method: "DELETE",
          headers: { Authorization: `Bearer ${activeToken}` },
        }
      );

      if (delRes.status === 401) {
        console.warn("[echo-google-sync] 401 deleting task. Attempting token refresh...");
        const refreshed = await getValidAccessToken(true);
        if (refreshed?.token) {
          activeToken = refreshed.token;
          delRes = await fetch(
            `https://tasks.googleapis.com/tasks/v1/lists/@default/tasks/${encodeURIComponent(taskId)}`,
            {
              method: "DELETE",
              headers: { Authorization: `Bearer ${activeToken}` },
            }
          );
        }
      }

      if (!delRes.ok && delRes.status !== 404) {
        const errText = await delRes.text();
        return new Response(
          JSON.stringify({ error: "Failed to delete Google task.", details: errText }),
          { status: delRes.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({ success: true, deletedId: taskId }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  }

  return new Response(
    JSON.stringify({ error: "Not found." }),
    { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
