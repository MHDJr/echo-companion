import type { Message, NavPage } from "../types";

interface CompanionPanelProps {
  messages: Message[];
  input: string;
  setInput: (value: string) => void;
  voiceMode: boolean;
  setVoiceMode: (value: boolean) => void;
  sendMessage: (text?: string) => void;
  activePage: NavPage;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

const pageSuggestions: Record<string, { icon: string; title: string; text: string }[]> = {
  "My day": [
    { icon: "✨", title: "Prioritize today", text: "Help me prioritize what matters most today" },
    { icon: "🎯", title: "Focus block", text: "Suggest an optimal focus time for my deep work" },
    { icon: "🌿", title: "Midday reset", text: "Give me a quick 2-minute mindful reset prompt" },
  ],
  Calendar: [
    { icon: "📅", title: "Review schedule", text: "Summarize today's calendar anchors and free slots" },
    { icon: "⚡", title: "Meeting prep", text: "Help me prep for the Architecture & Design Review" },
    { icon: "🛡️", title: "Protect focus", text: "How can I block distraction-free time tomorrow?" },
  ],
  Tasks: [
    { icon: "✓", title: "Break down task", text: "Help me break down my highest priority task" },
    { icon: "⚡", title: "Quick win", text: "Which task is best to tackle for quick momentum?" },
    { icon: "🧘", title: "Reduce overwhelm", text: "How can I simplify my task list today?" },
  ],
};

export function CompanionPanel({
  messages,
  input,
  setInput,
  voiceMode,
  setVoiceMode,
  sendMessage,
  activePage,
  isCollapsed = false,
  onToggleCollapse,
}: CompanionPanelProps) {
  const suggestions = pageSuggestions[activePage] || [
    { icon: "💡", title: "Ask Echo", text: "Help me find clarity with my current task" },
    { icon: "✍️", title: "Reflect", text: "Help me reflect on today's progress" },
  ];

  if (isCollapsed) {
    return (
      <aside className="companion-panel collapsed" aria-label="Echo Companion Sidebar">
        <button
          className="companion-reopen-btn"
          onClick={onToggleCollapse}
          title="Open Echo Companion"
        >
          <span className="companion-status-dot pulse" />
          <span className="companion-reopen-icon">💬</span>
          <span className="companion-reopen-label">Echo</span>
          {messages.length > 0 && (
            <span className="companion-badge">{messages.length}</span>
          )}
        </button>
      </aside>
    );
  }

  return (
    <aside className="companion-panel" aria-label="Echo Companion Workspace">
      <div className="companion-header">
        <div className="companion-header-left">
          <span className="companion-status-dot pulse" />
          <div>
            <h3 className="companion-title">Echo Companion</h3>
            <p className="companion-subtitle">Always here · Section aware</p>
          </div>
        </div>
        <div className="companion-header-actions">
          {messages.length > 0 && (
            <span className="companion-badge">{messages.length} msgs</span>
          )}
          {onToggleCollapse && (
            <button
              className="companion-collapse-btn"
              onClick={onToggleCollapse}
              title="Collapse Companion panel"
              aria-label="Collapse Companion panel"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      <div className="companion-body">
        {messages.length === 0 ? (
          <div className="companion-empty">
            <p className="companion-context-label">
              ASK ECHO ABOUT {activePage.toUpperCase()}
            </p>
            <div className="companion-suggestions">
              {suggestions.map((item) => (
                <button
                  key={item.title}
                  className="companion-suggestion-card"
                  onClick={() => sendMessage(item.text)}
                >
                  <span className="companion-suggestion-icon">{item.icon}</span>
                  <div className="companion-suggestion-content">
                    <span className="companion-suggestion-title">{item.title}</span>
                    <span className="companion-suggestion-text">{item.text}</span>
                  </div>
                  <span className="companion-suggestion-arrow">↗</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="companion-messages-container">
            <div className="messages companion-messages">
              {messages.map((message, index) => (
                <div className={`message ${message.role}`} key={index}>
                  <div className="message-label">
                    {message.role === "user" ? "YOU" : "ECHO"}
                  </div>
                  <p>{message.text}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="companion-footer">
        <form
          className="composer companion-composer"
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
            placeholder={`Ask Echo about ${activePage.toLowerCase()}...`}
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
      </div>
    </aside>
  );
}
