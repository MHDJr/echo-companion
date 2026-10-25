import { useState, useRef, useEffect } from "react";
import type { TaskCategory, TaskItem, TaskPriority } from "../types";

interface TasksViewProps {
  tasks: TaskItem[];
  onToggleTask: (id: string) => void;
  onAddTask: (task: Omit<TaskItem, "id">) => void;
  onEditTask: (id: string, updates: Partial<Omit<TaskItem, "id">>) => void;
  onDeleteTask: (id: string) => void;
  onResetTasks?: () => void;
  onAskEcho: (prompt: string) => void;
  isGoogleConnected?: boolean;
  googleEmail?: string | null;
  onSyncGoogle?: () => void;
  isSyncing?: boolean;
  onConnectGoogle?: () => void;
}

type FilterType = "All" | "Today" | "Work" | "Personal" | "Completed";

export function TasksView({
  tasks,
  onToggleTask,
  onAddTask,
  onEditTask,
  onDeleteTask,
  onResetTasks,
  onAskEcho,
  isGoogleConnected = false,
  googleEmail,
  onSyncGoogle,
  isSyncing = false,
  onConnectGoogle,
}: TasksViewProps) {
  const [filter, setFilter] = useState<FilterType>("All");

  // Create form state
  const [newTitle, setNewTitle] = useState("");
  const [newCategory, setNewCategory] = useState<TaskCategory>("Work");
  const [newPriority, setNewPriority] = useState<TaskPriority>("Medium");
  const [newDueDate, setNewDueDate] = useState("Today");
  const [createError, setCreateError] = useState<string | null>(null);

  // Edit task state
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editCategory, setEditCategory] = useState<TaskCategory>("Work");
  const [editPriority, setEditPriority] = useState<TaskPriority>("Medium");
  const [editDueDate, setEditDueDate] = useState("Today");
  const [editError, setEditError] = useState<string | null>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  // Delete confirmation state
  const [deletingTaskId, setDeletingTaskId] = useState<string | null>(null);

  // Auto-focus edit input when entering edit mode
  useEffect(() => {
    if (editingTaskId && editInputRef.current) {
      editInputRef.current.focus();
    }
  }, [editingTaskId]);

  const totalCount = tasks.length;
  const completedCount = tasks.filter((t) => t.completed).length;
  const progressPercent =
    totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  const filteredTasks = tasks.filter((task) => {
    if (filter === "Completed") return task.completed;
    if (filter === "Today") return task.dueDate === "Today" || task.isTodayPriority;
    if (filter === "Work") return task.category === "Work";
    if (filter === "Personal")
      return task.category === "Personal" || task.category === "Health";
    return true; // "All"
  });

  function handleCreateTask(e: React.FormEvent) {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title) {
      setCreateError("Please enter a task title before adding.");
      return;
    }

    setCreateError(null);
    onAddTask({
      title,
      completed: false,
      dueDate: newDueDate,
      category: newCategory,
      priority: newPriority,
      isTodayPriority: newDueDate === "Today",
    });

    setNewTitle("");
  }

  function startEditing(task: TaskItem) {
    setEditingTaskId(task.id);
    setEditTitle(task.title);
    setEditCategory(task.category);
    setEditPriority(task.priority);
    setEditDueDate(task.dueDate);
    setEditError(null);
    setDeletingTaskId(null);
  }

  function cancelEditing() {
    setEditingTaskId(null);
    setEditTitle("");
    setEditError(null);
  }

  function handleSaveEdit(id: string) {
    const title = editTitle.trim();
    if (!title) {
      setEditError("Task title cannot be empty.");
      return;
    }

    onEditTask(id, {
      title,
      dueDate: editDueDate,
      category: editCategory,
      priority: editPriority,
      isTodayPriority: editDueDate === "Today",
    });

    setEditingTaskId(null);
    setEditTitle("");
    setEditError(null);
  }

  return (
    <div className="section-container tasks-view">
      <div className="section-header">
        <div className="eyebrow">
          <span className="pulse-dot" /> ACTION ITEMS
        </div>
        <h1 className="section-title">
          Tasks & Commitments
          <br />
          <span className="section-subtitle-span">Keep work meaningful.</span>
        </h1>
        <p className="section-description">
          Organize your commitments with intention. Tasks are saved reliably to your device storage and persist across sessions.
        </p>
      </div>

      {isGoogleConnected ? (
        <div className="storage-status-banner live-sync-banner">
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            <span className="live-sync-badge-pill">✓ GOOGLE TASKS ACTIVE</span>
            <span className="storage-status-text">
              Connected as <strong>{googleEmail || "Google Account"}</strong>. Actions sync directly with your Google Tasks list.
            </span>
          </div>
          {onSyncGoogle && (
            <button
              type="button"
              className="banner-sync-btn"
              onClick={onSyncGoogle}
              disabled={isSyncing}
            >
              {isSyncing ? "↻ Syncing..." : "↻ Refresh Tasks"}
            </button>
          )}
        </div>
      ) : (
        <div className="storage-status-banner">
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
            <span className="storage-badge-pill">LOCAL PERSISTENCE</span>
            <span className="storage-status-text">
              Saved to browser local storage · Connect Google Tasks for automatic two-way synchronization.
            </span>
          </div>
          {onConnectGoogle && (
            <button
              type="button"
              className="banner-connect-btn"
              onClick={onConnectGoogle}
            >
              Connect Google Tasks
            </button>
          )}
        </div>
      )}

      <div className="tasks-progress-card">
        <div className="progress-info-row">
          <div>
            <span className="progress-label">PROGRESS OVERVIEW</span>
            <h3 className="progress-value">
              {completedCount} of {totalCount} completed
            </h3>
          </div>
          <span className="progress-percentage">{progressPercent}%</span>
        </div>
        <div
          className="progress-track"
          role="progressbar"
          aria-valuenow={progressPercent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="progress-fill"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      <div className="content-card task-create-card">
        <p className="section-label">CREATE NEW TASK</p>
        <form className="task-add-form" onSubmit={handleCreateTask}>
          <div className="task-input-wrapper">
            <input
              type="text"
              placeholder="What needs your attention? (e.g. Review design tokens)"
              value={newTitle}
              onChange={(e) => {
                setNewTitle(e.target.value);
                if (createError) setCreateError(null);
              }}
              className={`task-input-field ${createError ? "input-error" : ""}`}
              aria-label="New task title"
            />
            {createError && (
              <span className="field-error-message" role="alert">
                {createError}
              </span>
            )}
          </div>

          <div className="task-options-row">
            <div className="task-select-group">
              <label htmlFor="task-due-select">Due:</label>
              <select
                id="task-due-select"
                value={newDueDate}
                onChange={(e) => setNewDueDate(e.target.value)}
                className="task-select"
              >
                <option value="Today">Today</option>
                <option value="Tomorrow">Tomorrow</option>
                <option value="Oct 24">Oct 24</option>
                <option value="Next week">Next week</option>
              </select>
            </div>

            <div className="task-select-group">
              <label htmlFor="task-category-select">Category:</label>
              <select
                id="task-category-select"
                value={newCategory}
                onChange={(e) => setNewCategory(e.target.value as TaskCategory)}
                className="task-select"
              >
                <option value="Work">Work</option>
                <option value="Personal">Personal</option>
                <option value="Health">Health</option>
                <option value="Learning">Learning</option>
              </select>
            </div>

            <div className="task-select-group">
              <label htmlFor="task-priority-select">Priority:</label>
              <select
                id="task-priority-select"
                value={newPriority}
                onChange={(e) => setNewPriority(e.target.value as TaskPriority)}
                className="task-select"
              >
                <option value="High">High</option>
                <option value="Medium">Medium</option>
                <option value="Low">Low</option>
              </select>
            </div>

            <button
              type="submit"
              className="task-add-btn"
            >
              Add Task
            </button>
          </div>
        </form>
      </div>

      <div className="content-card tasks-list-card">
        <div className="tasks-filter-bar" role="tablist">
          {(["All", "Today", "Work", "Personal", "Completed"] as FilterType[]).map(
            (tab) => {
              const count = tasks.filter((t) => {
                if (tab === "Completed") return t.completed;
                if (tab === "Today")
                  return t.dueDate === "Today" || t.isTodayPriority;
                if (tab === "Work") return t.category === "Work";
                if (tab === "Personal")
                  return (
                    t.category === "Personal" || t.category === "Health"
                  );
                return true;
              }).length;

              return (
                <button
                  key={tab}
                  type="button"
                  role="tab"
                  aria-selected={filter === tab}
                  className={`filter-tab ${filter === tab ? "active" : ""}`}
                  onClick={() => setFilter(tab)}
                >
                  {tab} <span className="tab-count">{count}</span>
                </button>
              );
            }
          )}
        </div>

        <div className="tasks-items-container">
          {filteredTasks.length === 0 ? (
            <div className="empty-tasks-state">
              <span className="empty-icon">✓</span>
              <p className="empty-title">
                {filter === "Completed"
                  ? "No completed tasks yet."
                  : filter === "Today"
                  ? "No tasks due today."
                  : filter === "All"
                  ? "No tasks found."
                  : `No tasks in ${filter}.`}
              </p>
              <p className="empty-desc">
                {filter === "Completed"
                  ? "Complete an item from your list to celebrate your progress here."
                  : filter === "Today"
                  ? "Enjoy the open mental space, or add what you want to focus on today."
                  : "Organize your commitments with intention, or ask Echo to help plan."}
              </p>
              {onResetTasks && tasks.length === 0 && (
                <button
                  type="button"
                  className="restore-tasks-btn"
                  onClick={onResetTasks}
                >
                  Restore Sample Tasks
                </button>
              )}
            </div>
          ) : (
            filteredTasks.map((task) => {
              const isEditing = editingTaskId === task.id;
              const isDeleting = deletingTaskId === task.id;

              if (isEditing) {
                return (
                  <div key={task.id} className="task-row task-row-editing">
                    <form
                      className="task-edit-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        handleSaveEdit(task.id);
                      }}
                    >
                      <div className="edit-input-group">
                        <input
                          ref={editInputRef}
                          type="text"
                          value={editTitle}
                          onChange={(e) => {
                            setEditTitle(e.target.value);
                            if (editError) setEditError(null);
                          }}
                          className={`task-input-field ${
                            editError ? "input-error" : ""
                          }`}
                          placeholder="Task title..."
                          aria-label="Edit task title"
                        />
                        {editError && (
                          <span className="field-error-message" role="alert">
                            {editError}
                          </span>
                        )}
                      </div>

                      <div className="task-edit-options">
                        <div className="task-select-group">
                          <label htmlFor={`edit-due-${task.id}`}>Due:</label>
                          <select
                            id={`edit-due-${task.id}`}
                            value={editDueDate}
                            onChange={(e) => setEditDueDate(e.target.value)}
                            className="task-select"
                          >
                            <option value="Today">Today</option>
                            <option value="Tomorrow">Tomorrow</option>
                            <option value="Oct 24">Oct 24</option>
                            <option value="Next week">Next week</option>
                          </select>
                        </div>

                        <div className="task-select-group">
                          <label htmlFor={`edit-cat-${task.id}`}>Category:</label>
                          <select
                            id={`edit-cat-${task.id}`}
                            value={editCategory}
                            onChange={(e) =>
                              setEditCategory(e.target.value as TaskCategory)
                            }
                            className="task-select"
                          >
                            <option value="Work">Work</option>
                            <option value="Personal">Personal</option>
                            <option value="Health">Health</option>
                            <option value="Learning">Learning</option>
                          </select>
                        </div>

                        <div className="task-select-group">
                          <label htmlFor={`edit-pri-${task.id}`}>Priority:</label>
                          <select
                            id={`edit-pri-${task.id}`}
                            value={editPriority}
                            onChange={(e) =>
                              setEditPriority(e.target.value as TaskPriority)
                            }
                            className="task-select"
                          >
                            <option value="High">High</option>
                            <option value="Medium">Medium</option>
                            <option value="Low">Low</option>
                          </select>
                        </div>

                        <div className="task-edit-actions">
                          <button
                            type="button"
                            className="task-cancel-btn"
                            onClick={cancelEditing}
                          >
                            Cancel
                          </button>
                          <button
                            type="submit"
                            className="task-save-btn"
                          >
                            Save
                          </button>
                        </div>
                      </div>
                    </form>
                  </div>
                );
              }

              return (
                <div
                  key={task.id}
                  className={`task-row ${task.completed ? "task-completed" : ""}`}
                >
                  <button
                    type="button"
                    className={`custom-checkbox ${
                      task.completed ? "checked" : ""
                    }`}
                    onClick={() => onToggleTask(task.id)}
                    aria-label={`Mark "${task.title}" as ${
                      task.completed ? "incomplete" : "complete"
                    }`}
                  >
                    {task.completed && <span className="check-mark">✓</span>}
                  </button>

                  <div
                    className="task-main-content"
                    onClick={() => onToggleTask(task.id)}
                  >
                    <span className="task-item-title">{task.title}</span>
                    <div className="task-item-meta">
                      {(task.source === "google" || task.googleTaskId) && (
                        <span className="tag-pill google-pill" title="Synchronized with Google Tasks">
                          Google Task
                        </span>
                      )}
                      <span className="tag-pill due-pill">
                        📅 {task.dueDate}
                      </span>
                      <span
                        className={`tag-pill priority-${task.priority.toLowerCase()}`}
                      >
                        {task.priority}
                      </span>
                      <span className="tag-pill category-tag">
                        {task.category}
                      </span>
                    </div>
                  </div>

                  {isDeleting ? (
                    <div className="delete-confirm-wrapper" role="alert">
                      <span className="delete-confirm-label">Delete?</span>
                      <button
                        type="button"
                        className="delete-confirm-btn"
                        onClick={() => {
                          onDeleteTask(task.id);
                          setDeletingTaskId(null);
                        }}
                        aria-label={`Confirm delete "${task.title}"`}
                      >
                        Delete
                      </button>
                      <button
                        type="button"
                        className="delete-cancel-btn"
                        onClick={() => setDeletingTaskId(null)}
                        aria-label="Cancel deletion"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="task-actions-group">
                      <button
                        type="button"
                        className="task-edit-btn"
                        onClick={() => startEditing(task)}
                        title="Edit task"
                        aria-label={`Edit "${task.title}"`}
                      >
                        ✎
                      </button>
                      <button
                        type="button"
                        className="task-delete-btn"
                        onClick={() => setDeletingTaskId(task.id)}
                        title="Delete task"
                        aria-label={`Delete "${task.title}"`}
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="reflection-box">
        <div className="reflection-content">
          <span className="reflection-icon">💡</span>
          <div>
            <p className="reflection-title">Echo Assistance</p>
            <p className="reflection-quote">
              Overwhelmed by your commitments? Ask Echo to help you prioritize and break tasks into 15-minute micro-actions.
            </p>
          </div>
        </div>
        <button
          type="button"
          className="reflection-btn"
          onClick={() =>
            onAskEcho(
              "Help me review my tasks and prioritize what matters most today."
            )
          }
        >
          Prioritize with Echo ↗
        </button>
      </div>
    </div>
  );
}
