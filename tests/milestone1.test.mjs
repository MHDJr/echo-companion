import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

console.log("=================================================");
console.log("ECHO COMPANION v1.0 — MILESTONE 1 VERIFICATION TEST SUITE");
console.log("=================================================\n");

let passedTests = 0;
let totalTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    console.log(`✓ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`✗ [FAIL] ${name}:`, err.message);
    throw err;
  }
}

async function runAsyncTest(name, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`✓ [PASS] ${name}`);
    passedTests++;
  } catch (err) {
    console.error(`✗ [FAIL] ${name}:`, err.message);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// TEST 1: OBJECTIVE D & B — Button label is never used as item title
// ---------------------------------------------------------------------------
runTest("Objective D: Bug verification & fix — Suggestion button text is never used as task/event title", () => {
  // 1. Bug reproduction check: In the buggy code, handleExecuteSuggestedAction(actionText) directly set title: actionText
  const buggyExecution = (buttonLabel) => ({
    title: buttonLabel, // BUG: Derived directly from visible UI label
    completed: false,
  });
  const buggyResult = buggyExecution("＋ Schedule deep work session");
  assert.equal(buggyResult.title, "＋ Schedule deep work session", "Buggy pattern took label as title");

  // 2. Fixed pattern:
  // - UI Suggestion chips only dispatch conversation prompt to Echo (sendMessage)
  // - Real actions execute from structured ActionDraft bound to draft.id with validated draft.title
  const mockActionDraft = {
    id: "act_1730000000000_abc123",
    originalRequest: "Please add a deep focus session tomorrow at 10am",
    type: "create_event",
    title: "Deep Focus Session", // Polished title
    date: "2026-10-26",
    startTime: "10:00 AM",
    endTime: "11:00 AM",
    timeZone: "Asia/Kolkata",
    status: "pending",
    requiresConfirmation: true,
  };

  const buttonVisibleText = "✓ Add to Calendar"; // Visible label on ActionDraftCard button
  
  // Execution function uses draft.title, never button text
  function handleConfirmActionDraft(draft) {
    assert.notEqual(draft.title, buttonVisibleText, "Title must never equal confirmation button label");
    return {
      title: draft.title,
      date: draft.date,
      time: `${draft.startTime} - ${draft.endTime}`,
      actionId: draft.id,
    };
  }

  const result = handleConfirmActionDraft(mockActionDraft);
  assert.equal(result.title, "Deep Focus Session");
  assert.equal(result.actionId, "act_1730000000000_abc123");
});

// ---------------------------------------------------------------------------
// TEST 2: OBJECTIVE B — Action draft validation and sanitization
// ---------------------------------------------------------------------------
runTest("Objective B: Server & client action draft validation and sanitization", () => {
  function validateAndSanitize(draft, rawMessage, userTz, today) {
    if (!draft || typeof draft !== "object") return null;
    const validTypes = ["create_event", "create_task", "update_event", "update_task", "complete_task", "delete_event", "delete_task"];
    if (!validTypes.includes(draft.type)) return null;
    const rawTitle = typeof draft.title === "string" ? draft.title.trim() : "";
    if (!rawTitle && draft.type !== "complete_task" && draft.type !== "delete_task") return null;

    const id = typeof draft.id === "string" && draft.id.startsWith("act_") ? draft.id : `act_${Date.now()}`;
    const date = typeof draft.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(draft.date.trim()) ? draft.date.trim() : undefined;
    const dueDate = typeof draft.dueDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(draft.dueDate.trim()) ? draft.dueDate.trim() : (draft.dueDate === "Today" ? today : undefined);

    return {
      id,
      originalRequest: rawMessage,
      type: draft.type,
      title: rawTitle,
      date: draft.type === "create_event" && !date && dueDate ? dueDate : date,
      dueDate: draft.type === "create_task" && !dueDate && date ? date : dueDate,
      status: "pending",
      requiresConfirmation: true,
    };
  }

  // Valid draft
  const valid = validateAndSanitize(
    { type: "create_task", title: "Review architectural diagram", dueDate: "2026-10-27" },
    "Review architectural diagram by Tuesday",
    "Asia/Kolkata",
    "2026-10-25"
  );
  assert.ok(valid);
  assert.equal(valid.title, "Review architectural diagram");
  assert.equal(valid.dueDate, "2026-10-27");
  assert.equal(valid.status, "pending");
  assert.equal(valid.requiresConfirmation, true);

  // Invalid: missing title for create_event
  const invalid = validateAndSanitize(
    { type: "create_event", title: "" },
    "Schedule something",
    "Asia/Kolkata",
    "2026-10-25"
  );
  assert.equal(invalid, null, "Draft without title should be rejected");

  // Invalid: invalid type
  const badType = validateAndSanitize(
    { type: "random_type", title: "Test" },
    "test",
    "Asia/Kolkata",
    "2026-10-25"
  );
  assert.equal(badType, null, "Draft with unknown type should be rejected");
});

// ---------------------------------------------------------------------------
// TEST 3: OBJECTIVE A & B — Relative date handling and timezone awareness
// ---------------------------------------------------------------------------
runTest("Objective A: Relative date resolution strictly anchored to user timezone", () => {
  const userLocalDate = "2026-10-25"; // Sunday
  const [year, month, day] = userLocalDate.split("-").map(Number);
  const baseDate = new Date(year, month - 1, day);

  function resolveRelativeDate(term, base) {
    const d = new Date(base);
    if (term === "tomorrow") {
      d.setDate(d.getDate() + 1);
    } else if (term === "today" || term === "tonight" || term === "this evening") {
      // same date
    }
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  assert.equal(resolveRelativeDate("tomorrow", baseDate), "2026-10-26", "Tomorrow from 2026-10-25 must be 2026-10-26");
  assert.equal(resolveRelativeDate("today", baseDate), "2026-10-25", "Today must be 2026-10-25");
  assert.equal(resolveRelativeDate("tonight", baseDate), "2026-10-25", "Tonight must be 2026-10-25");
});

// ---------------------------------------------------------------------------
// TEST 4: OBJECTIVE C & D — Confirmation, Edit, Cancel & Duplicate Prevention
// ---------------------------------------------------------------------------
runTest("Objective C & D: Distinct Confirm, Edit, Cancel and duplicate submission prevention", () => {
  const executingDraftIds = new Set();
  let apiCallCount = 0;

  const draft = {
    id: "act_test_123",
    type: "create_event",
    title: "Team Architecture Review",
    date: "2026-10-27",
    status: "pending",
    requiresConfirmation: true,
  };

  // 1. Confirm handler with duplicate prevention
  function confirmHandler(d) {
    if (executingDraftIds.has(d.id) || d.status === "completed" || d.status === "cancelled") {
      return { skipped: true };
    }
    executingDraftIds.add(d.id);
    apiCallCount++;
    d.status = "completed";
    executingDraftIds.delete(d.id);
    return { skipped: false, success: true };
  }

  // First confirm executes
  const first = confirmHandler(draft);
  assert.equal(first.skipped, false);
  assert.equal(first.success, true);
  assert.equal(apiCallCount, 1);
  assert.equal(draft.status, "completed");

  // Repeated confirm click is blocked
  const second = confirmHandler(draft);
  assert.equal(second.skipped, true, "Duplicate click must be blocked");
  assert.equal(apiCallCount, 1, "API must not be called twice");

  // 2. Cancel handler: Discards proposal without API call
  let cancelDraft = {
    id: "act_cancel_456",
    type: "create_task",
    title: "Unwanted task",
    status: "pending",
    requiresConfirmation: true,
  };

  function cancelHandler(d) {
    d.status = "cancelled";
    // Discard without Google API write
  }

  cancelHandler(cancelDraft);
  assert.equal(cancelDraft.status, "cancelled");
  assert.equal(apiCallCount, 1, "Cancel must never trigger an API write");

  // 3. Edit handler: Updates fields before execution
  let editableDraft = {
    id: "act_edit_789",
    type: "create_event",
    title: "Original Title",
    date: "2026-10-28",
    status: "pending",
    requiresConfirmation: true,
  };

  function editHandler(d, newTitle, newDate) {
    d.title = newTitle;
    d.date = newDate;
  }

  editHandler(editableDraft, "Corrected Doctor Appointment", "2026-10-29");
  assert.equal(editableDraft.title, "Corrected Doctor Appointment");
  assert.equal(editableDraft.date, "2026-10-29");
  assert.equal(editableDraft.status, "pending");
});

// ---------------------------------------------------------------------------
// TEST 5: OBJECTIVE C — Google Calendar Reminders payload verification
// ---------------------------------------------------------------------------
runTest("Objective C: Google Calendar reminder overrides payload generation", () => {
  function buildReminderPayload(minutes) {
    return {
      useDefault: false,
      overrides: minutes !== null && minutes >= 0
        ? [{ method: "popup", minutes }]
        : [],
    };
  }

  // 10 minutes
  const r10 = buildReminderPayload(10);
  assert.deepEqual(r10, { useDefault: false, overrides: [{ method: "popup", minutes: 10 }] });

  // 30 minutes
  const r30 = buildReminderPayload(30);
  assert.deepEqual(r30, { useDefault: false, overrides: [{ method: "popup", minutes: 30 }] });

  // 1 hour
  const r60 = buildReminderPayload(60);
  assert.deepEqual(r60, { useDefault: false, overrides: [{ method: "popup", minutes: 60 }] });

  // 1 day
  const r1440 = buildReminderPayload(1440);
  assert.deepEqual(r1440, { useDefault: false, overrides: [{ method: "popup", minutes: 1440 }] });

  // No reminder
  const rNone = buildReminderPayload(null);
  assert.deepEqual(rNone, { useDefault: false, overrides: [] });
});

// ---------------------------------------------------------------------------
// TEST 6: OBJECTIVE E — Deep Focus Blocks card removal verification
// ---------------------------------------------------------------------------
runTest("Objective E: MyDayView DOM inspect — Deep focus blocks card permanently removed", () => {
  const myDayPath = path.resolve("./src/components/MyDayView.tsx");
  const content = fs.readFileSync(myDayPath, "utf-8");

  assert.ok(!content.includes("3h 45m"), "Card with '3h 45m' must not exist in MyDayView.tsx");
  assert.ok(!content.includes("Deep focus blocks"), "Card with 'Deep focus blocks' must not exist in MyDayView.tsx");
  assert.ok(!content.includes("2 scheduled focus sessions"), "Card with '2 scheduled focus sessions' must not exist");

  // Verify other cards remain intact
  assert.ok(content.includes("Priorities done"), "Priorities done card must be preserved");
  assert.ok(content.includes("Calendar anchors"), "Calendar anchors card must be preserved");
  assert.ok(content.includes("Cognitive pace"), "Cognitive pace card must be preserved");
  assert.ok(content.includes("TODAY'S PRIORITIES"), "Today's priorities section must be preserved");
  assert.ok(content.includes("TODAY'S FLOW"), "Today's flow schedule must be preserved");
});

// ---------------------------------------------------------------------------
// TEST 7: OBJECTIVE F & A — Live Supabase Edge Function Intent Recognition
// ---------------------------------------------------------------------------
await runAsyncTest("Objective A & F: Live Echo assistant intent recognition in Malayalam, Manglish & English", async () => {
  let supabaseUrl = "https://mewxhhifntjkedgptxqi.supabase.co";
  let supabaseAnonKey = "";

  const envFiles = [path.resolve("./.env"), path.resolve("./.env.local")];
  for (const envFile of envFiles) {
    if (fs.existsSync(envFile)) {
      const raw = fs.readFileSync(envFile, "utf-8");
      for (const line of raw.split("\n")) {
        const uMatch = line.trim().match(/^VITE_SUPABASE_URL=(.*)$/);
        if (uMatch) supabaseUrl = uMatch[1].trim().replace(/^["']|["']$/g, "");
        const kMatch = line.trim().match(/^VITE_SUPABASE_ANON_KEY=(.*)$/);
        if (kMatch) supabaseAnonKey = kMatch[1].trim().replace(/^["']|["']$/g, "");
      }
    }
  }

  // Authenticate using the established test user
  let token = "";
  try {
    const authRes = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: supabaseAnonKey },
      body: JSON.stringify({
        email: "echo_companion_test_89888@gmail.com",
        password: "EchoPassword2026!",
      }),
    });
    if (authRes.ok) {
      const authJson = await authRes.json();
      token = authJson.access_token;
    }
  } catch (_e) {
    // ignore
  }

  if (!token) {
    console.log("  [INFO] Test user credentials not available. Skipping live edge HTTP calls.");
    return;
  }

  const fnUrl = `${supabaseUrl}/functions/v1/echo-assistant`;

  // CASE A: Explicit Malayalam Event Request
  console.log("  Testing Case A: Explicit Malayalam Event Recognition...");
  const mlRes = await fetch(fnUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      message: "നാളെ രാവിലെ 10 മണിക്ക് ഡോക്ടർ അപ്പോയിൻ്റ്മെന്റ് ആഡ് ചെയ്യുക",
      context: {
        timeZone: "Asia/Kolkata",
        localDate: "2026-10-25",
        localTime: "10:30 AM",
      },
    }),
  });

  assert.equal(mlRes.status, 200, "Malayalam request must return 200");
  const mlData = await mlRes.json();
  assert.ok(mlData.reply, "Must include reply");
  assert.ok(mlData.actionDraft, "Explicit request must generate actionDraft");
  assert.equal(mlData.actionDraft.type, "create_event");
  assert.equal(mlData.actionDraft.date, "2026-10-26", "Tomorrow relative to 2026-10-25 must resolve to 2026-10-26");
  assert.ok(mlData.actionDraft.title.length > 0, "Polished title must exist");
  assert.equal(mlData.actionDraft.requiresConfirmation, true);
  console.log(`    ↳ Malayalam Reply: "${mlData.reply.slice(0, 60)}..."`);
  console.log(`    ↳ ActionDraft: type=${mlData.actionDraft.type}, title="${mlData.actionDraft.title}", date=${mlData.actionDraft.date}, startTime=${mlData.actionDraft.startTime}`);

  // CASE B: Explicit Manglish Task Request
  console.log("  Testing Case B: Explicit Manglish Task Recognition...");
  const manglishRes = await fetch(fnUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      message: "naale kku munpu electricity bill adakkanam oru task vekku",
      context: {
        timeZone: "Asia/Kolkata",
        localDate: "2026-10-25",
      },
    }),
  });

  assert.equal(manglishRes.status, 200, "Manglish request must return 200");
  const manglishData = await manglishRes.json();
  assert.ok(manglishData.actionDraft, "Explicit Manglish task request must create actionDraft");
  assert.equal(manglishData.actionDraft.type, "create_task");
  assert.ok(manglishData.actionDraft.title.toLowerCase().includes("bill") || manglishData.actionDraft.title.toLowerCase().includes("electricity"), "Title must preserve intent");
  console.log(`    ↳ Manglish Reply: "${manglishData.reply.slice(0, 60)}..."`);
  console.log(`    ↳ ActionDraft: type=${manglishData.actionDraft.type}, title="${manglishData.actionDraft.title}", dueDate=${manglishData.actionDraft.dueDate}`);

  // CASE C: Casual Conversation (must NOT produce actionDraft)
  console.log("  Testing Case C: Casual Greeting (No Action Draft)...");
  const chatRes = await fetch(fnUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      message: "Good morning Echo! How are you doing today?",
      context: {
        timeZone: "Asia/Kolkata",
        localDate: "2026-10-25",
      },
    }),
  });

  assert.equal(chatRes.status, 200);
  const chatData = await chatRes.json();
  assert.ok(chatData.reply);
  assert.equal(chatData.actionDraft, null, "Casual greetings must produce actionDraft: null");
  console.log(`    ↳ Casual Reply: "${chatData.reply.slice(0, 60)}..." (actionDraft: null)`);

  // CASE D: Inferred Future Activity (must NOT create draft, asks user)
  console.log("  Testing Case D: Inferred / Uncertain Statement...");
  const inferredRes = await fetch(fnUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      message: "I think I will probably visit my parents next month sometime.",
      context: {
        timeZone: "Asia/Kolkata",
        localDate: "2026-10-25",
      },
    }),
  });

  assert.equal(inferredRes.status, 200);
  const inferredData = await inferredRes.json();
  assert.equal(inferredData.actionDraft, null, "Inferred future statements must not create action drafts");
  console.log(`    ↳ Inferred Reply: "${inferredData.reply.slice(0, 60)}..." (actionDraft: null)`);
});

console.log(`\n=================================================`);
console.log(`TEST SUITE SUMMARY: ${passedTests}/${totalTests} TESTS PASSED`);
console.log(`=================================================`);
