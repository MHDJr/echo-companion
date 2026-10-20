import { useState, useEffect } from "react";
import "./App.css";
import type { CalendarEvent, Message, NavPage, TaskItem } from "./types";
import { initialCalendarEvents, initialTasks } from "./data/mockData";
import { taskService } from "./services/taskService";
import { MyDayView } from "./components/MyDayView";
import { CalendarView } from "./components/CalendarView";
import { TasksView } from "./components/TasksView";
import { CompanionPanel } from "./components/CompanionPanel";

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

  function sendMessage(text = input) {
    const message = text.trim();
    if (!message) return;

    setMessages((current) => [
      ...current,
      { role: "user", text: message },
      {
        role: "echo",
        text: "I'm here. Echo's AI connection isn't enabled yet, but we're building the foundation. Soon, I'll be able to help you with this.",
      },
    ]);
    setInput("");
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
            <span className="beta-pill">EARLY PREVIEW</span>
            <div className="avatar" title="Muhammed">M</div>
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
                    <div className={`message ${message.role}`} key={index}>
                      <div className="message-label">
                        {message.role === "user" ? "YOU" : "ECHO"}
                      </div>
                      <p>{message.text}</p>
                    </div>
                  ))}
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
                      disabled={!input.trim()}
                      aria-label="Send message"
                    >
                      ↑
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

              <p className="privacy-note">
                Built for thoughtful conversations. AI is not connected yet.
              </p>
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
    </div>
  );
}

export default App;
