import { useState, useEffect, useRef, useCallback } from "react";
import type { User } from "@supabase/supabase-js";
import "./App.css";
import type { CalendarEvent, Message, NavPage, TaskItem, GoogleSyncStatus, ActionDraft } from "./types";
import { initialCalendarEvents, initialTasks } from "./data/mockData";
import { taskService } from "./services/taskService";
import { getCurrentSession, supabase } from "./services/supabaseClient";
import { sendChatMessage } from "./services/aiService";
import {
  getGoogleSyncStatus,
  getCachedGoogleSyncStatus,
  linkSessionTokens,
  fetchGoogleCalendarEvents,
  createGoogleCalendarEvent,
  updateGoogleCalendarEvent,
  deleteGoogleCalendarEvent,
  updateCalendarEventReminders,
  connectGoogleWorkspaceOAuth,
} from "./services/googleSyncService";
import { MyDayView } from "./components/MyDayView";
import { CalendarView } from "./components/CalendarView";
import { TasksView } from "./components/TasksView";
import { CompanionPanel } from "./components/CompanionPanel";
import { ActionDraftCard } from "./components/ActionDraftCard";
import { AuthModal } from "./components/AuthModal";
import { GoogleConnectPrompt } from "./components/GoogleConnectPrompt";
import { GoogleSyncBadge } from "./components/GoogleSyncBadge";

const suggestions = [
  { icon: "✍️", title: "Help me write", text: "Help me write something meaningful" },
  { icon: "📅", title: "Plan my day", text: "Help me plan my day" },
  { icon: "💡", title: "Explore an idea", text: "Help me explore a new idea" },
  { icon: "🌙", title: "Reflect & grow", text: "Give me a thoughtful reflection for today" },
];

function App() {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [voiceMode, setVoiceMode] = useState(false);
  const [activePage, setActivePage] = useState<NavPage>("Home");
  const [showCompanion, setShowCompanion] = useState(true);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [isAiResponding, setIsAiResponding] = useState(false);
  const homeTextareaRef = useRef<HTMLTextAreaElement>(null);

  const isSyncingRef = useRef(false);
  const lastSyncTimeRef = useRef(0);

  // Google Workspace two-way synchronization state
  const [googleSyncStatus, setGoogleSyncStatus] = useState<GoogleSyncStatus>(() => getCachedGoogleSyncStatus());
  const [isSyncingGoogle, setIsSyncingGoogle] = useState(false);
  const [showGooglePrompt, setShowGooglePrompt] = useState(() => {
    try {
      return localStorage.getItem("echo_google_prompt_dismissed") !== "true";
    } catch {
      return true;
    }
  });

  // Auto-fit textarea height gracefully capped at 140px max
  useEffect(() => {
    if (homeTextareaRef.current) {
      homeTextareaRef.current.style.height = "auto";
      homeTextareaRef.current.style.height = `${Math.min(homeTextareaRef.current.scrollHeight, 140)}px`;
    }
  }, [input]);

  // Milestone 3: Local Persistent Tasks via TaskService
  const [tasks, setTasks] = useState<TaskItem[]>(() => {
    try {
      if (typeof window !== "undefined" && window.localStorage) {
        const raw = window.localStorage.getItem("echo_tasks_v1");
        if (raw !== null) {
          const parsed: unknown = JSON.parse(raw);
          if (Array.isArray(parsed)) return parsed as TaskItem[];
        }
      }
    } catch {
      // Fallback to initial demo tasks if storage inaccessible
    }
    return initialTasks;
  });

  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>(initialCalendarEvents);
  const [executingDraftIds, setExecutingDraftIds] = useState<Set<string>>(new Set());

  // Sync tasks on mount through the TaskService interface
  useEffect(() => {
    taskService.getTasks().then((loadedTasks) => {
      setTasks(loadedTasks);
    }).catch((err) => {
      console.error("[App] Failed to load tasks from taskService:", err);
    });
  }, []);

  // Synchronize Google Workspace data (Calendar & Tasks) - concurrency guarded and parallelized
  const syncGoogleData = useCallback(async () => {
    if (isSyncingRef.current) return;
    const session = await getCurrentSession();
    if (!session || !session.access_token) return;

    isSyncingRef.current = true;
    setIsSyncingGoogle(true);
    try {
      const status = await getGoogleSyncStatus();
      setGoogleSyncStatus(status);
      taskService.setGoogleConnected(status.isConnected);

      if (status.isConnected) {
        const [calRes, taskRes] = await Promise.allSettled([
          fetchGoogleCalendarEvents(),
          taskService.getTasks(),
        ]);

        if (calRes.status === "fulfilled" && calRes.value.events && calRes.value.events.length > 0) {
          setCalendarEvents((prev) => {
            const localNonGoogle = prev.filter((e) => !e.googleEventId && e.source !== "google");
            return [...calRes.value.events, ...localNonGoogle];
          });
        }

        if (taskRes.status === "fulfilled") {
          setTasks(taskRes.value);
        }
      }
      lastSyncTimeRef.current = Date.now();
    } catch (err) {
      console.warn("[App] Google sync status error:", err);
    } finally {
      isSyncingRef.current = false;
      setIsSyncingGoogle(false);
    }
  }, []);

  // Sync Supabase Authentication state once on mount
  useEffect(() => {
    getCurrentSession().then((session) => {
      const user = session?.user ?? null;
      setCurrentUser(user);
      if (user) {
        syncGoogleData();
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      const user = session?.user ?? null;
      setCurrentUser(user);

      if (session?.provider_token) {
        await linkSessionTokens(session.provider_token, session.provider_refresh_token);
      }

      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        syncGoogleData();
      } else if (event === "SIGNED_OUT") {
        setGoogleSyncStatus({ isConnected: false, calendarConnected: false, tasksConnected: false });
        taskService.setGoogleConnected(false);
      }
    });

    // Check for OAuth callback error in URL parameters or hash
    if (typeof window !== "undefined") {
      const urlParams = new URLSearchParams(window.location.search);
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, "?"));

      const errorDesc =
        urlParams.get("error_description") ||
        hashParams.get("error_description") ||
        urlParams.get("error") ||
        hashParams.get("error");

      if (errorDesc) {
        console.warn("[Echo Auth] OAuth callback parameter notice:", errorDesc);
        queueMicrotask(() => {
          setMessages((current) => [
            ...current,
            {
              role: "echo",
              text: `Authentication notice: ${decodeURIComponent(errorDesc.replace(/\+/g, " "))}`,
              id: `msg-${Date.now()}-e`,
              timestamp: Date.now(),
              isError: true,
            },
          ]);
          setAuthModalOpen(true);
        });
        // Clean error params from address bar
        window.history.replaceState({}, document.title, window.location.pathname);
      }
    }

    return () => {
      subscription.unsubscribe();
    };
  }, [syncGoogleData]);

  // Foreground refresh on window focus (rate limited to once every 45s)
  useEffect(() => {
    function handleWindowFocus() {
      if (Date.now() - lastSyncTimeRef.current > 45000) {
        syncGoogleData();
      }
    }
    window.addEventListener("focus", handleWindowFocus);
    return () => window.removeEventListener("focus", handleWindowFocus);
  }, [syncGoogleData]);

  async function sendMessage(text = input) {
    const message = text.trim();
    if (!message || isAiResponding) return;

    const userMessage: Message = {
      role: "user",
      text: message,
      id: `msg-${Date.now()}-u`,
      timestamp: Date.now(),
    };

    setMessages((current) => [...current, userMessage]);
    setInput("");

    // Verify authenticated session before calling Edge Function
    const session = await getCurrentSession();
    if (!session || !session.access_token) {
      setMessages((current) => [
        ...current,
        {
          role: "echo",
          text: "Echo requires a secure authenticated connection. Please sign in or use the quick demo account to continue.",
          id: `msg-${Date.now()}-e`,
          timestamp: Date.now(),
          isError: true,
          canRetry: true,
        },
      ]);
      setAuthModalOpen(true);
      return;
    }

    setIsAiResponding(true);

    try {
      const response = await sendChatMessage(message, {
        activePage,
        history: messages,
        calendarEvents: calendarEvents.map((e) => ({
          id: e.googleEventId || e.id,
          title: e.title,
          date: e.date,
          time: e.time,
        })),
        tasks: tasks.map((t) => ({
          id: t.googleTaskId || t.id,
          title: t.title,
          dueDate: t.dueDate,
          completed: t.completed,
        })),
      });

      setMessages((current) => [
        ...current,
        {
          role: "echo",
          text: response.reply,
          id: `msg-${Date.now()}-e`,
          timestamp: Date.now(),
          detectedLanguage: response.detectedLanguage,
          suggestedActions: response.suggestedActions,
          actionDraft: response.actionDraft || null,
        },
      ]);
    } catch (err: unknown) {
      const errorMsg =
        err instanceof Error
          ? err.message
          : "Echo was unable to complete that thought. Please try again.";

      setMessages((current) => [
        ...current,
        {
          role: "echo",
          text: errorMsg,
          id: `msg-${Date.now()}-e`,
          timestamp: Date.now(),
          isError: true,
          canRetry: true,
        },
      ]);
    } finally {
      setIsAiResponding(false);
    }
  }

  // Conversational chip: send prompt to Echo to converse naturally (never derives title from button text)
  function handleExecuteSuggestedAction(actionPrompt: string) {
    sendMessage(actionPrompt);
  }

  // Execute original validated proposal (Objective C & D)
  async function handleConfirmActionDraft(draft: ActionDraft) {
    if (executingDraftIds.has(draft.id) || draft.status === "completed" || draft.status === "cancelled") {
      return;
    }

    setExecutingDraftIds((prev) => new Set(prev).add(draft.id));

    try {
      let createdResourceId: string | undefined = undefined;

      if (draft.type === "create_event") {
        let createdEvent: CalendarEvent | undefined = undefined;
        if (googleSyncStatus.isConnected) {
          createdEvent = await createGoogleCalendarEvent({
            title: draft.title,
            date: draft.date || new Date().toISOString().split("T")[0],
            time: draft.startTime && draft.endTime
              ? `${draft.startTime} - ${draft.endTime}`
              : draft.startTime || "All day",
            category: "Meeting",
            description: draft.description || "",
            isDemo: false,
            source: "google",
          });
          setCalendarEvents((current) => [createdEvent!, ...current.filter((e) => e.id !== createdEvent!.id)]);
        } else {
          createdEvent = {
            id: `cal-${Date.now()}`,
            title: draft.title,
            date: draft.date || new Date().toISOString().split("T")[0],
            time: draft.startTime && draft.endTime
              ? `${draft.startTime} - ${draft.endTime}`
              : draft.startTime || "All day",
            category: "Meeting",
            description: draft.description || "",
            isDemo: false,
            source: "local",
          };
          setCalendarEvents((current) => [...current, createdEvent!]);
        }
        createdResourceId = createdEvent?.googleEventId || createdEvent?.id;
      } else if (draft.type === "create_task") {
        const createdTask = await taskService.createTask({
          title: draft.title,
          completed: false,
          category: "Work",
          priority: "Medium",
          dueDate: draft.dueDate || "Today",
          notes: draft.description || "",
          isTodayPriority: draft.dueDate === "Today" || draft.dueDate === new Date().toISOString().split("T")[0],
        });
        setTasks((current) => [createdTask, ...current.filter((t) => t.id !== createdTask.id)]);
        createdResourceId = createdTask.googleTaskId || createdTask.id;
      } else if (draft.type === "complete_task" && draft.targetResourceId) {
        const updated = await taskService.toggleTask(draft.targetResourceId);
        setTasks((current) => current.map((t) => (t.id === draft.targetResourceId ? updated : t)));
      } else if (draft.type === "delete_task" && draft.targetResourceId) {
        await taskService.deleteTask(draft.targetResourceId);
        setTasks((current) => current.filter((t) => t.id !== draft.targetResourceId));
      } else if (draft.type === "delete_event" && draft.targetResourceId) {
        await handleDeleteCalendarEvent(draft.targetResourceId);
      } else if (draft.type === "update_event" && draft.targetResourceId) {
        await handleEditCalendarEvent(draft.targetResourceId, {
          title: draft.title,
          date: draft.date,
          time: draft.startTime && draft.endTime ? `${draft.startTime} - ${draft.endTime}` : draft.startTime,
          description: draft.description,
        });
      } else if (draft.type === "update_task" && draft.targetResourceId) {
        const updated = await taskService.updateTask(draft.targetResourceId, {
          title: draft.title,
          dueDate: draft.dueDate,
          notes: draft.description,
        });
        setTasks((current) => current.map((t) => (t.id === draft.targetResourceId ? updated : t)));
      }

      setMessages((current) =>
        current.map((m) =>
          m.actionDraft?.id === draft.id
            ? {
                ...m,
                actionDraft: {
                  ...m.actionDraft,
                  status: "completed",
                  createdResourceId,
                  executionError: undefined,
                },
              }
            : m
        )
      );
    } catch (err: any) {
      console.error("[App] Action execution error:", err);
      setMessages((current) =>
        current.map((m) =>
          m.actionDraft?.id === draft.id
            ? {
                ...m,
                actionDraft: {
                  ...m.actionDraft,
                  status: "failed",
                  executionError: err?.message || "Execution failed. Please verify your connection.",
                },
              }
            : m
        )
      );
    } finally {
      setExecutingDraftIds((prev) => {
        const next = new Set(prev);
        next.delete(draft.id);
        return next;
      });
    }
  }

  function handleEditActionDraft(updatedDraft: ActionDraft) {
    setMessages((current) =>
      current.map((m) =>
        m.actionDraft?.id === updatedDraft.id
          ? { ...m, actionDraft: updatedDraft }
          : m
      )
    );
  }

  function handleCancelActionDraft(draft: ActionDraft) {
    setMessages((current) =>
      current.map((m) =>
        m.actionDraft?.id === draft.id
          ? {
              ...m,
              actionDraft: {
                ...m.actionDraft,
                status: "cancelled",
              },
            }
          : m
      )
    );
  }

  async function handleSelectReminder(draft: ActionDraft, minutes: number | null) {
    const googleEventId = draft.createdResourceId;
    if (!googleEventId) return;

    try {
      const updated = await updateCalendarEventReminders(googleEventId, minutes);
      setCalendarEvents((current) =>
        current.map((e) => (e.googleEventId === googleEventId || e.id === googleEventId ? updated : e))
      );
      setMessages((current) =>
        current.map((m) =>
          m.actionDraft?.id === draft.id
            ? {
                ...m,
                actionDraft: {
                  ...m.actionDraft,
                  selectedReminderMinutes: minutes,
                  reminderConfirmed: true,
                },
              }
            : m
        )
      );
    } catch (err) {
      console.error("[App] Failed to update calendar event reminders:", err);
    }
  }

  function startNewChat() {
    setMessages([]);
    setInput("");
    setActivePage("Home");
  }

  async function handleToggleTask(id: string) {
    try {
      const updated = await taskService.toggleTask(id);
      setTasks((current) =>
        current.map((task) => (task.id === id ? updated : task))
      );
    } catch (err) {
      console.error("[App] Failed to toggle task:", err);
    }
  }

  async function handleAddTask(task: Omit<TaskItem, "id">) {
    try {
      const created = await taskService.createTask(task);
      setTasks((current) => [created, ...current.filter((t) => t.id !== created.id)]);
    } catch (err) {
      console.error("[App] Failed to add task:", err);
    }
  }

  async function handleEditTask(id: string, updates: Partial<Omit<TaskItem, "id">>) {
    try {
      const updated = await taskService.updateTask(id, updates);
      setTasks((current) =>
        current.map((task) => (task.id === id ? updated : task))
      );
    } catch (err) {
      console.error("[App] Failed to edit task:", err);
    }
  }

  async function handleDeleteTask(id: string) {
    try {
      await taskService.deleteTask(id);
      setTasks((current) => current.filter((task) => task.id !== id));
    } catch (err) {
      console.error("[App] Failed to delete task:", err);
    }
  }

  async function handleResetTasks() {
    try {
      const reset = await taskService.resetToDefaultTasks();
      setTasks(reset);
    } catch (err) {
      console.error("[App] Failed to reset tasks:", err);
    }
  }

  async function handleAddCalendarEvent(event: Omit<CalendarEvent, "id">) {
    if (googleSyncStatus.isConnected) {
      try {
        const created = await createGoogleCalendarEvent(event);
        setCalendarEvents((current) => [created, ...current.filter((e) => e.id !== created.id)]);
        return;
      } catch (err) {
        console.warn("[App] Google Calendar event creation failed; saving locally:", err);
      }
    }

    const newEvent: CalendarEvent = {
      ...event,
      id: `cal-${Date.now()}`,
      source: "local",
    };
    setCalendarEvents((current) => [...current, newEvent]);
  }

  async function handleEditCalendarEvent(id: string, updates: Partial<CalendarEvent>) {
    const existing = calendarEvents.find((e) => e.id === id);
    if (googleSyncStatus.isConnected && existing && (existing.googleEventId || existing.source === "google")) {
      const gId = existing.googleEventId || existing.id;
      try {
        const updated = await updateGoogleCalendarEvent(gId, updates);
        setCalendarEvents((current) => current.map((e) => (e.id === id ? updated : e)));
        return;
      } catch (err) {
        console.warn("[App] Google Calendar event update failed; updating locally:", err);
      }
    }

    setCalendarEvents((current) =>
      current.map((e) => (e.id === id ? { ...e, ...updates } : e))
    );
  }

  async function handleDeleteCalendarEvent(id: string) {
    const existing = calendarEvents.find((e) => e.id === id);
    if (googleSyncStatus.isConnected && existing && (existing.googleEventId || existing.source === "google")) {
      const gId = existing.googleEventId || existing.id;
      try {
        await deleteGoogleCalendarEvent(gId);
      } catch (err) {
        console.warn("[App] Google Calendar event delete failed; removing locally:", err);
      }
    }

    setCalendarEvents((current) => current.filter((e) => e.id !== id));
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={startNewChat} aria-label="Echo Home">
          <span className="brand-mark">e</span>
          <span>
            echo<span className="brand-dot">.</span>
          </span>
        </button>

        <button className="new-chat" onClick={startNewChat}>
          <span>＋</span> New conversation
        </button>

        <p className="nav-label">WORKSPACE</p>
        <nav className="nav-list" aria-label="Workspace Navigation">
          {[
            ["⌂", "Home"],
            ["◷", "My day"],
            ["▦", "Calendar"],
            ["✓", "Tasks"],
          ].map(([icon, label]) => {
            const page = label as NavPage;
            const isSelected = activePage === page;
            return (
              <button
                key={label}
                className={`nav-item ${isSelected ? "active" : ""}`}
                onClick={() => setActivePage(page)}
                aria-current={isSelected ? "page" : undefined}
              >
                <span className="nav-icon">{icon}</span>
                {label}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-bottom">
          <div className="connection-dot" />
          <div>
            <p className="status-title">Your space, your pace.</p>
            <p className="status-subtitle">Echo 1.0 · In development</p>
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <button className="mobile-brand-btn" onClick={startNewChat} aria-label="Echo Home">
              <span className="brand-mark">e</span>
              <span className="mobile-brand-text">
                echo<span className="brand-dot">.</span>
              </span>
            </button>
            <div className="breadcrumb">
              <span>Echo</span>
              <span className="breadcrumb-sep">/</span>
              <span>{activePage}</span>
            </div>
          </div>
          <div className="topbar-right">
            <button
              type="button"
              className="mobile-new-chat-btn"
              onClick={startNewChat}
              title="New conversation"
              aria-label="New conversation"
            >
              <span>＋</span>
            </button>
            {activePage !== "Home" && (
              <button
                type="button"
                className={`companion-topbar-toggle ${showCompanion ? "active" : ""}`}
                onClick={() => setShowCompanion(!showCompanion)}
                title={showCompanion ? "Hide Companion sidebar" : "Open Companion sidebar"}
                aria-label="Toggle Echo Companion"
              >
                <span className="toggle-dot" />
                <span className="toggle-label">Companion</span>
                {messages.length > 0 && (
                  <span className="topbar-msg-count">{messages.length}</span>
                )}
              </button>
            )}
            <GoogleSyncBadge
              status={googleSyncStatus}
              isSyncing={isSyncingGoogle}
              onSyncNow={syncGoogleData}
              onStatusChange={(newStatus) => {
                setGoogleSyncStatus(newStatus);
                taskService.setGoogleConnected(newStatus.isConnected);
                if (newStatus.isConnected) syncGoogleData();
              }}
            />
            <button
              type="button"
              className="avatar-btn"
              onClick={() => setAuthModalOpen(true)}
              title={currentUser ? `Connected: ${currentUser.email || "Account"}` : "Connect Account / Sign in"}
              aria-label="Account Settings"
            >
              <div className="avatar">
                {currentUser?.user_metadata?.avatar_url || currentUser?.user_metadata?.picture ? (
                  <img
                    src={currentUser.user_metadata.avatar_url || currentUser.user_metadata.picture}
                    alt={currentUser.user_metadata?.full_name || "User Avatar"}
                    style={{ width: "100%", height: "100%", borderRadius: "50%", objectFit: "cover" }}
                    referrerPolicy="no-referrer"
                  />
                ) : currentUser ? (
                  currentUser.email?.[0]?.toUpperCase() || "✓"
                ) : (
                  "M"
                )}
              </div>
              <span className={`avatar-status-badge ${currentUser ? "online" : "offline"}`} />
            </button>
          </div>
        </header>

        {activePage === "Home" ? (
          <section className="workspace workspace-home">
            <div className="welcome-block">
              <div className="eyebrow">
                <span /> YOUR PERSONAL COMPANION
              </div>
              <h1>
                A little more clarity.
                <br />
                <span>A little less noise.</span>
              </h1>
              <p className="welcome-description">
                Think out loud, find your direction, and make room for what truly matters.
              </p>
            </div>

            {currentUser && !googleSyncStatus.isConnected && showGooglePrompt && (
              <GoogleConnectPrompt
                status={googleSyncStatus}
                onStatusChange={(newStatus) => {
                  setGoogleSyncStatus(newStatus);
                  taskService.setGoogleConnected(newStatus.isConnected);
                  if (newStatus.isConnected) syncGoogleData();
                }}
                onDismiss={() => {
                  setShowGooglePrompt(false);
                  try {
                    localStorage.setItem("echo_google_prompt_dismissed", "true");
                  } catch {
                    // ignore
                  }
                }}
              />
            )}

            <div className="chat-area">
              {messages.length === 0 ? (
                <>
                  <p className="section-label">WHAT'S ON YOUR MIND?</p>
                  <div className="suggestion-grid">
                    {suggestions.map((item) => (
                      <button
                        className="suggestion-card"
                        key={item.title}
                        onClick={() => sendMessage(item.text)}
                      >
                        <span className="suggestion-icon">{item.icon}</span>
                        <span className="suggestion-title">{item.title}</span>
                        <span className="suggestion-arrow">↗</span>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <div className="messages">
                  {messages.map((message, index) => (
                    <div
                      className={`message ${message.role} ${message.isError ? "message-error" : ""}`}
                      key={message.id || index}
                    >
                      <div className="message-label-row">
                        <span className="message-label">
                          {message.role === "user" ? "YOU" : "ECHO"}
                        </span>
                        {message.detectedLanguage && message.detectedLanguage !== "en" && (
                          <span className="message-lang-badge" title="Response language">
                            {message.detectedLanguage === "ml" ? "മലയാളം" : "Manglish"}
                          </span>
                        )}
                      </div>
                      <p>{message.text}</p>
                      {message.canRetry && (
                        <button
                          type="button"
                          className="message-retry-btn"
                          onClick={() => sendMessage(message.text)}
                        >
                          ↻ Try again
                        </button>
                      )}
                      {message.actionDraft && (
                        <ActionDraftCard
                          draft={message.actionDraft}
                          isExecuting={executingDraftIds.has(message.actionDraft.id)}
                          onConfirm={handleConfirmActionDraft}
                          onEdit={handleEditActionDraft}
                          onCancel={handleCancelActionDraft}
                          onSelectReminder={handleSelectReminder}
                        />
                      )}

                      {message.suggestedActions && message.suggestedActions.length > 0 && (
                        <div className="message-suggestions-chips">
                          {message.suggestedActions.map((action, i) => (
                            <button
                              key={i}
                              type="button"
                              className="suggestion-action-chip"
                              onClick={() => handleExecuteSuggestedAction(action)}
                              title="Ask Echo about this"
                            >
                              <span className="chip-plus">›</span>
                              <span className="chip-text">{action}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}

                  {isAiResponding && (
                    <div className="message echo message-thinking">
                      <div className="message-label">ECHO</div>
                      <div className="thinking-row">
                        <div className="thinking-dots">
                          <span />
                          <span />
                          <span />
                        </div>
                        <span className="thinking-text">Echo is reflecting...</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <form
                className="composer"
                onSubmit={(event) => {
                  event.preventDefault();
                  sendMessage();
                }}
              >
                <textarea
                  ref={homeTextareaRef}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      !event.shiftKey &&
                      !event.nativeEvent.isComposing
                    ) {
                      event.preventDefault();
                      sendMessage();
                    }
                  }}
                  placeholder="Tell Echo what's on your mind..."
                  rows={1}
                  aria-label="Message Echo"
                />
                <div className="composer-footer">
                  <span className="composer-hint">↵ Send · ⇧↵ New line</span>
                  <div className="composer-actions">
                    <button
                      type="button"
                      className={`voice-button ${voiceMode ? "voice-active" : ""}`}
                      onClick={() => setVoiceMode(!voiceMode)}
                      aria-label="Toggle voice mode"
                      title="Voice mode preview"
                    >
                      {voiceMode ? "◉" : "🎙"}
                    </button>
                    <button
                      type="submit"
                      className="send-button"
                      disabled={!input.trim() || isAiResponding}
                      aria-label="Send message"
                    >
                      {isAiResponding ? "⋯" : "↑"}
                    </button>
                  </div>
                </div>
              </form>

              {voiceMode && (
                <div className="voice-notice">
                  <span className="voice-pulse" />
                  Voice mode preview — microphone integration comes next.
                  <button type="button" onClick={() => setVoiceMode(false)}>Dismiss</button>
                </div>
              )}

              <div className="privacy-note-row">
                <span className={`privacy-indicator-dot ${currentUser ? "connected" : ""}`} />
                <p className="privacy-note">
                  {currentUser
                    ? `Connected to Echo AI via Supabase Edge Function (${currentUser.email || "Authenticated"}).`
                    : "Converse with Echo AI. Sign in for private, authenticated companion guidance."}
                </p>
                {!currentUser && (
                  <button
                    type="button"
                    className="privacy-connect-link"
                    onClick={() => setAuthModalOpen(true)}
                  >
                    Connect
                  </button>
                )}
              </div>
            </div>
          </section>
        ) : (
          <section
            className={`workspace workspace-section ${
              showCompanion ? "with-companion" : "full-width"
            }`}
          >
            <div className="workspace-main-content">
              {currentUser && !googleSyncStatus.isConnected && showGooglePrompt && (
                <GoogleConnectPrompt
                  status={googleSyncStatus}
                  onStatusChange={(newStatus) => {
                    setGoogleSyncStatus(newStatus);
                    taskService.setGoogleConnected(newStatus.isConnected);
                    if (newStatus.isConnected) syncGoogleData();
                  }}
                  onDismiss={() => {
                    setShowGooglePrompt(false);
                    try {
                      localStorage.setItem("echo_google_prompt_dismissed", "true");
                    } catch {
                      // ignore
                    }
                  }}
                />
              )}

              {activePage === "My day" && (
                <MyDayView
                  tasks={tasks}
                  onToggleTask={handleToggleTask}
                  onAddTask={handleAddTask}
                  onAskEcho={(prompt) => sendMessage(prompt)}
                />
              )}

              {activePage === "Calendar" && (
                <CalendarView
                  events={calendarEvents}
                  onAddEvent={handleAddCalendarEvent}
                  onEditEvent={handleEditCalendarEvent}
                  onDeleteEvent={handleDeleteCalendarEvent}
                  onAskEcho={(prompt) => sendMessage(prompt)}
                  isGoogleConnected={googleSyncStatus.isConnected}
                  googleEmail={googleSyncStatus.googleEmail}
                  onSyncGoogle={syncGoogleData}
                  isSyncing={isSyncingGoogle}
                  onConnectGoogle={() => connectGoogleWorkspaceOAuth()}
                />
              )}

              {activePage === "Tasks" && (
                <TasksView
                  tasks={tasks}
                  onToggleTask={handleToggleTask}
                  onAddTask={handleAddTask}
                  onEditTask={handleEditTask}
                  onDeleteTask={handleDeleteTask}
                  onResetTasks={handleResetTasks}
                  onAskEcho={(prompt) => sendMessage(prompt)}
                  isGoogleConnected={googleSyncStatus.isConnected}
                  googleEmail={googleSyncStatus.googleEmail}
                  onSyncGoogle={syncGoogleData}
                  isSyncing={isSyncingGoogle}
                  onConnectGoogle={() => connectGoogleWorkspaceOAuth()}
                />
              )}
            </div>

            <CompanionPanel
              messages={messages}
              input={input}
              setInput={setInput}
              voiceMode={voiceMode}
              setVoiceMode={setVoiceMode}
              sendMessage={sendMessage}
              activePage={activePage}
              isCollapsed={!showCompanion}
              onToggleCollapse={() => setShowCompanion(!showCompanion)}
              isAiResponding={isAiResponding}
              onRetryMessage={(txt) => sendMessage(txt)}
              onExecuteSuggestedAction={handleExecuteSuggestedAction}
              onConfirmActionDraft={handleConfirmActionDraft}
              onEditActionDraft={handleEditActionDraft}
              onCancelActionDraft={handleCancelActionDraft}
              onSelectReminder={handleSelectReminder}
              executingDraftIds={executingDraftIds}
            />
          </section>
        )}

        <footer className="app-footer">
          <span>
            echo<span className="brand-dot">.</span>
          </span>
          <span>Less noise. More meaning.</span>
        </footer>
      </main>

      <nav className="mobile-nav-bar" aria-label="Mobile Navigation">
        {[
          ["⌂", "Home"],
          ["◷", "My day"],
          ["▦", "Calendar"],
          ["✓", "Tasks"],
        ].map(([icon, label]) => {
          const page = label as NavPage;
          const isSelected = activePage === page;
          return (
            <button
              key={label}
              type="button"
              className={`mobile-nav-item ${isSelected ? "active" : ""}`}
              onClick={() => setActivePage(page)}
              aria-current={isSelected ? "page" : undefined}
            >
              <span className="mobile-nav-icon">{icon}</span>
              <span className="mobile-nav-label">{label}</span>
            </button>
          );
        })}
      </nav>

      <AuthModal
        isOpen={authModalOpen}
        onClose={() => setAuthModalOpen(false)}
        currentUser={currentUser}
        onUserChange={setCurrentUser}
      />
    </div>
  );
}

export default App;
