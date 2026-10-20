import { useState, useEffect } from "react";
import type { User } from "@supabase/supabase-js";
import "./App.css";
import type { CalendarEvent, Message, NavPage, TaskItem } from "./types";
import { initialCalendarEvents, initialTasks } from "./data/mockData";
import { taskService } from "./services/taskService";
import { getCurrentUser, getCurrentSession, supabase } from "./services/supabaseClient";
import { sendChatMessage } from "./services/aiService";
import { MyDayView } from "./components/MyDayView";
import { CalendarView } from "./components/CalendarView";
import { TasksView } from "./components/TasksView";
import { CompanionPanel } from "./components/CompanionPanel";
import { AuthModal } from "./components/AuthModal";

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

  // Sync tasks on mount through the TaskService interface
  useEffect(() => {
    taskService.getTasks().then((loadedTasks) => {
      setTasks(loadedTasks);
    }).catch((err) => {
      console.error("[App] Failed to load tasks from taskService:", err);
    });
  }, []);

  // Sync Supabase Authentication state
  useEffect(() => {
    getCurrentUser().then((u) => setCurrentUser(u));

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setCurrentUser(session?.user ?? null);
    });

    return () => {
      subscription.unsubscribe();
    };
  }, []);

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

  async function handleExecuteSuggestedAction(actionText: string) {
    try {
      const created = await taskService.createTask({
        title: actionText,
        completed: false,
        category: "Work",
        priority: "Medium",
        dueDate: new Date().toISOString().split("T")[0],
        isTodayPriority: false,
      });
      setTasks((current) => [created, ...current.filter((t) => t.id !== created.id)]);
      setMessages((current) => [
        ...current,
        {
          role: "echo",
          text: `✓ I've added "${created.title}" to your Tasks list.`,
          id: `msg-${Date.now()}-action`,
          timestamp: Date.now(),
        },
      ]);
    } catch (err) {
      console.error("[App] Failed to add suggested task:", err);
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

  function handleAddCalendarEvent(event: Omit<CalendarEvent, "id">) {
    const newEvent: CalendarEvent = {
      ...event,
      id: `cal-${Date.now()}`,
    };
    setCalendarEvents((current) => [...current, newEvent]);
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
            <button
              type="button"
              className="avatar-btn"
              onClick={() => setAuthModalOpen(true)}
              title={currentUser ? `Connected: ${currentUser.email || "Account"}` : "Connect Account / Sign in"}
              aria-label="Account Settings"
            >
              <div className="avatar">
                {currentUser ? (currentUser.email?.[0]?.toUpperCase() || "✓") : "M"}
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
                      {message.suggestedActions && message.suggestedActions.length > 0 && (
                        <div className="message-suggestions-chips">
                          {message.suggestedActions.map((action, i) => (
                            <button
                              key={i}
                              type="button"
                              className="suggestion-action-chip"
                              onClick={() => handleExecuteSuggestedAction(action)}
                              title="Add this suggestion to Tasks"
                            >
                              <span className="chip-plus">＋</span>
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
                  rows={2}
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
                  onAskEcho={(prompt) => sendMessage(prompt)}
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
