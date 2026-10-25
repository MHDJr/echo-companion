import { useState } from "react";
import type { TaskItem } from "../types";

interface MyDayViewProps {
  tasks: TaskItem[];
  onToggleTask: (id: string) => void;
  onAddTask: (task: Omit<TaskItem, "id">) => void;
  onAskEcho: (prompt: string) => void;
}

export function MyDayView({
  tasks,
  onToggleTask,
  onAddTask,
  onAskEcho,
}: MyDayViewProps) {
  const [newPriorityTitle, setNewPriorityTitle] = useState("");
  const [formattedDate] = useState(() =>
    new Date().toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    })
  );

  const todayPriorities = tasks.filter(
    (t) => t.isTodayPriority || t.dueDate === "Today"
  );
  const completedPriorities = todayPriorities.filter((t) => t.completed).length;

  function handleAddPriority(e: React.FormEvent) {
    e.preventDefault();
    const title = newPriorityTitle.trim();
    if (!title) return;

    onAddTask({
      title,
      completed: false,
      dueDate: "Today",
      category: "Work",
      priority: "High",
      isTodayPriority: true,
    });
    setNewPriorityTitle("");
  }

  return (
    <div className="section-container my-day-view">
      <div className="section-header">
        <div className="eyebrow">
          <span className="pulse-dot" /> TODAY'S OVERVIEW
        </div>
        <h1 className="section-title">
          {formattedDate}
          <br />
          <span className="section-subtitle-span">Your intentional focus.</span>
        </h1>
        <p className="section-description">
          A calm overview of what matters today. Keep your commitments light and your attention clear.
        </p>
      </div>

      <div className="overview-grid">
        <div className="overview-card">
          <div className="overview-icon">✓</div>
          <div className="overview-data">
            <span className="overview-value">
              {completedPriorities}/{todayPriorities.length}
            </span>
            <span className="overview-label">Priorities done</span>
          </div>
          <div className="overview-detail">
            {todayPriorities.length - completedPriorities === 0
              ? "All today's priorities complete!"
              : `${todayPriorities.length - completedPriorities} remaining for today`}
          </div>
        </div>

        <div className="overview-card">
          <div className="overview-icon">▦</div>
          <div className="overview-data">
            <span className="overview-value">3 events</span>
            <span className="overview-label">Calendar anchors</span>
          </div>
          <div className="overview-detail">Next: Team Sync at 11:00 AM</div>
        </div>

        <div className="overview-card">
          <div className="overview-icon">🌱</div>
          <div className="overview-data">
            <span className="overview-value">Balanced</span>
            <span className="overview-label">Cognitive pace</span>
          </div>
          <div className="overview-detail">Optimal morning peak state</div>
        </div>
      </div>

      <div className="content-card priorities-card">
        <div className="card-header-row">
          <div>
            <p className="section-label">TODAY'S PRIORITIES</p>
            <h2 className="card-heading">Key Focus Items</h2>
          </div>
          <span className="card-counter-badge">
            {completedPriorities} of {todayPriorities.length} completed
          </span>
        </div>

        <div className="priorities-list">
          {todayPriorities.map((item) => (
            <div
              key={item.id}
              className={`priority-row ${item.completed ? "completed" : ""}`}
            >
              <button
                type="button"
                className={`custom-checkbox ${item.completed ? "checked" : ""}`}
                onClick={() => onToggleTask(item.id)}
                aria-label={`Mark "${item.title}" as ${item.completed ? "incomplete" : "complete"}`}
              >
                {item.completed && <span className="check-mark">✓</span>}
              </button>

              <div className="priority-info" onClick={() => onToggleTask(item.id)}>
                <span className="priority-title">{item.title}</span>
                <div className="priority-tags">
                  <span className={`tag-pill priority-${item.priority.toLowerCase()}`}>
                    {item.priority}
                  </span>
                  <span className="tag-pill category-tag">{item.category}</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        <form className="quick-add-form" onSubmit={handleAddPriority}>
          <input
            type="text"
            value={newPriorityTitle}
            onChange={(e) => setNewPriorityTitle(e.target.value)}
            placeholder="+ Add a priority for today..."
            aria-label="Add a priority for today"
            className="quick-add-input"
          />
          <button
            type="submit"
            disabled={!newPriorityTitle.trim()}
            className="quick-add-btn"
          >
            Add
          </button>
        </form>
      </div>

      <div className="content-card schedule-snapshot-card">
        <div className="card-header-row">
          <div>
            <p className="section-label">TODAY'S FLOW</p>
            <h2 className="card-heading">Schedule Snapshot</h2>
          </div>
          <span className="demo-pill">DEMO DATA</span>
        </div>

        <div className="timeline-list">
          <div className="timeline-item past">
            <div className="timeline-time">09:00 AM</div>
            <div className="timeline-dot" />
            <div className="timeline-details">
              <span className="timeline-title">Morning Grounding & Daily Kickoff</span>
              <span className="timeline-meta">30 min · Completed</span>
            </div>
          </div>

          <div className="timeline-item current">
            <div className="timeline-time">11:00 AM</div>
            <div className="timeline-dot pulse" />
            <div className="timeline-details">
              <span className="timeline-title">Echo Architecture & Design Review</span>
              <span className="timeline-meta">Google Meet · Virtual</span>
            </div>
          </div>

          <div className="timeline-item upcoming">
            <div className="timeline-time">02:00 PM</div>
            <div className="timeline-dot" />
            <div className="timeline-details">
              <span className="timeline-title">Deep Work: React State & Polish</span>
              <span className="timeline-meta">1h 30m · Dedicated Focus</span>
            </div>
          </div>

          <div className="timeline-item upcoming">
            <div className="timeline-time">05:00 PM</div>
            <div className="timeline-dot" />
            <div className="timeline-details">
              <span className="timeline-title">Day Closure & Thoughtful Reflection</span>
              <span className="timeline-meta">Echo Companion · Wind-down</span>
            </div>
          </div>
        </div>
      </div>

      <div className="reflection-box">
        <div className="reflection-content">
          <span className="reflection-icon">🌱</span>
          <div>
            <p className="reflection-title">Thought for today</p>
            <p className="reflection-quote">
              "Clarity comes from creating space between thoughts, not by doing more things faster."
            </p>
          </div>
        </div>
        <button
          type="button"
          className="reflection-btn"
          onClick={() =>
            onAskEcho("Let's reflect on today's priorities and how to pace my energy.")
          }
        >
          Discuss with Echo ↗
        </button>
      </div>
    </div>
  );
}
