import React, { useState } from "react";
import type { ActionDraft } from "../types";

interface ActionDraftCardProps {
  draft: ActionDraft;
  onConfirm: (draft: ActionDraft) => Promise<void>;
  onEdit: (updatedDraft: ActionDraft) => void;
  onCancel: (draft: ActionDraft) => void;
  onSelectReminder?: (draft: ActionDraft, minutes: number | null) => Promise<void>;
  isExecuting?: boolean;
}

export const ActionDraftCard: React.FC<ActionDraftCardProps> = ({
  draft,
  onConfirm,
  onEdit,
  onCancel,
  onSelectReminder,
  isExecuting = false,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(draft.title);
  const [editDate, setEditDate] = useState(draft.date || draft.dueDate || "");
  const [editStartTime, setEditStartTime] = useState(draft.startTime || "");
  const [editEndTime, setEditEndTime] = useState(draft.endTime || "");
  const [editDescription, setEditDescription] = useState(draft.description || "");

  const [isSettingReminder, setIsSettingReminder] = useState(false);
  const [showCustomReminderInput, setShowCustomReminderInput] = useState(false);
  const [customReminderMinutes, setCustomReminderMinutes] = useState("15");

  function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editTitle.trim()) return;

    const updated: ActionDraft = {
      ...draft,
      title: editTitle.trim(),
      date: draft.type.includes("event") ? editDate : undefined,
      dueDate: draft.type.includes("task") ? editDate : undefined,
      startTime: editStartTime.trim() || undefined,
      endTime: editEndTime.trim() || undefined,
      description: editDescription.trim() || undefined,
    };

    onEdit(updated);
    setIsEditing(false);
  }

  function handleCancelEdit() {
    setEditTitle(draft.title);
    setEditDate(draft.date || draft.dueDate || "");
    setEditStartTime(draft.startTime || "");
    setEditEndTime(draft.endTime || "");
    setEditDescription(draft.description || "");
    setIsEditing(false);
  }

  async function handleReminderPick(minutes: number | null) {
    if (!onSelectReminder) return;
    setIsSettingReminder(true);
    try {
      await onSelectReminder(draft, minutes);
    } finally {
      setIsSettingReminder(false);
      setShowCustomReminderInput(false);
    }
  }

  const isEventAction = draft.type.includes("event");
  const isTaskAction = draft.type.includes("task");

  const badgeLabels: Record<string, string> = {
    create_event: "PROPOSED EVENT",
    create_task: "PROPOSED TASK",
    update_event: "RESCHEDULE EVENT",
    update_task: "UPDATE TASK",
    complete_task: "COMPLETE TASK",
    delete_event: "CANCEL EVENT",
    delete_task: "DELETE TASK",
    none: "ACTION DRAFT",
  };

  return (
    <div
      className={`action-draft-card ${draft.status}`}
      data-action-id={draft.id}
      data-action-type={draft.type}
    >
      <div className="action-draft-header">
        <span className="action-draft-badge">{badgeLabels[draft.type] || "PROPOSED ACTION"}</span>
        <span className={`action-draft-status-pill ${draft.status}`}>
          {draft.status === "completed" && "✓ Confirmed"}
          {draft.status === "cancelled" && "✕ Cancelled"}
          {draft.status === "failed" && "! Failed"}
          {draft.status === "pending" && "Pending Confirmation"}
        </span>
      </div>

      {isEditing ? (
        <form className="action-draft-edit-form" onSubmit={handleSaveEdit}>
          <div className="edit-form-group">
            <label htmlFor={`edit-title-${draft.id}`}>Title</label>
            <input
              id={`edit-title-${draft.id}`}
              type="text"
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              placeholder="Title"
              required
            />
          </div>

          <div className="edit-form-group">
            <label htmlFor={`edit-date-${draft.id}`}>Date</label>
            <input
              id={`edit-date-${draft.id}`}
              type="date"
              value={editDate}
              onChange={(e) => setEditDate(e.target.value)}
            />
          </div>

          {isEventAction && (
            <div className="edit-form-row">
              <div className="edit-form-group">
                <label htmlFor={`edit-start-${draft.id}`}>Start Time</label>
                <input
                  id={`edit-start-${draft.id}`}
                  type="text"
                  value={editStartTime}
                  onChange={(e) => setEditStartTime(e.target.value)}
                  placeholder="e.g. 10:00 AM"
                />
              </div>
              <div className="edit-form-group">
                <label htmlFor={`edit-end-${draft.id}`}>End Time</label>
                <input
                  id={`edit-end-${draft.id}`}
                  type="text"
                  value={editEndTime}
                  onChange={(e) => setEditEndTime(e.target.value)}
                  placeholder="e.g. 11:00 AM"
                />
              </div>
            </div>
          )}

          <div className="edit-form-group">
            <label htmlFor={`edit-desc-${draft.id}`}>Notes</label>
            <textarea
              id={`edit-desc-${draft.id}`}
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              placeholder="Additional notes"
              rows={2}
            />
          </div>

          <div className="action-draft-btn-group">
            <button type="submit" className="action-btn-confirm">
              ✓ Save Changes
            </button>
            <button type="button" className="action-btn-cancel" onClick={handleCancelEdit}>
              Cancel Edit
            </button>
          </div>
        </form>
      ) : (
        <div className="action-draft-body">
          <h4 className="action-draft-title">{draft.title}</h4>

          <div className="action-draft-meta-rows">
            {draft.date && (
              <div className="action-draft-meta-item">
                <span className="meta-icon">📅</span>
                <span className="meta-text">{draft.date}</span>
              </div>
            )}
            {draft.startTime && (
              <div className="action-draft-meta-item">
                <span className="meta-icon">⏰</span>
                <span className="meta-text">
                  {draft.startTime}
                  {draft.endTime ? ` - ${draft.endTime}` : ""}
                  {draft.timeZone ? ` (${draft.timeZone})` : ""}
                </span>
              </div>
            )}
            {draft.dueDate && !draft.date && (
              <div className="action-draft-meta-item">
                <span className="meta-icon">🎯</span>
                <span className="meta-text">Due: {draft.dueDate}</span>
              </div>
            )}
            {draft.description && (
              <div className="action-draft-meta-item notes">
                <span className="meta-icon">📝</span>
                <span className="meta-text">{draft.description}</span>
              </div>
            )}
          </div>

          {draft.clarificationPrompt && (
            <div className="action-draft-clarification">
              <span className="clarification-icon">💡</span>
              <span>{draft.clarificationPrompt}</span>
            </div>
          )}

          {draft.executionError && (
            <div className="action-draft-error">
              <span>⚠️ {draft.executionError}</span>
            </div>
          )}

          {draft.status === "pending" && (
            <div className="action-draft-btn-group">
              <button
                type="button"
                className="action-btn-confirm"
                disabled={isExecuting}
                onClick={() => onConfirm(draft)}
                title="Confirm and execute this action"
              >
                {isExecuting ? (
                  <span className="btn-spinner">Saving...</span>
                ) : (
                  <>✓ {isEventAction ? "Add to Calendar" : isTaskAction ? "Add to Tasks" : "Confirm"}</>
                )}
              </button>

              <button
                type="button"
                className="action-btn-edit"
                disabled={isExecuting}
                onClick={() => setIsEditing(true)}
                title="Edit proposed details before confirming"
              >
                ✎ Edit
              </button>

              <button
                type="button"
                className="action-btn-cancel"
                disabled={isExecuting}
                onClick={() => onCancel(draft)}
                title="Discard this proposal"
              >
                ✕ Cancel
              </button>
            </div>
          )}

          {draft.status === "failed" && (
            <div className="action-draft-btn-group">
              <button
                type="button"
                className="action-btn-confirm"
                disabled={isExecuting}
                onClick={() => onConfirm(draft)}
              >
                {isExecuting ? "Retrying..." : "↻ Retry Action"}
              </button>
              <button
                type="button"
                className="action-btn-edit"
                onClick={() => setIsEditing(true)}
              >
                ✎ Edit
              </button>
              <button
                type="button"
                className="action-btn-cancel"
                onClick={() => onCancel(draft)}
              >
                ✕ Dismiss
              </button>
            </div>
          )}

          {draft.status === "cancelled" && (
            <div className="action-draft-completed-notice cancelled">
              <span>Proposal discarded. No changes were made to your Google Workspace.</span>
            </div>
          )}

          {draft.status === "completed" && (
            <div className="action-draft-completed-container">
              <div className="action-draft-completed-notice">
                <span>
                  ✓ {isEventAction ? "Saved to Google Calendar." : "Saved to Google Tasks."}
                </span>
              </div>

              {/* Post-event creation reminder configuration (Objective C) */}
              {isEventAction && draft.type === "create_event" && onSelectReminder && (
                <div className="action-draft-reminder-section">
                  <div className="reminder-section-title">
                    <span className="reminder-bell">🔔</span>
                    <span>When would you like to be reminded?</span>
                  </div>

                  {draft.reminderConfirmed ? (
                    <div className="reminder-confirmed-badge">
                      ✓ Reminder set for{" "}
                      {draft.selectedReminderMinutes === null
                        ? "no notification"
                        : draft.selectedReminderMinutes === 10
                        ? "10 minutes before"
                        : draft.selectedReminderMinutes === 30
                        ? "30 minutes before"
                        : draft.selectedReminderMinutes === 60
                        ? "1 hour before"
                        : draft.selectedReminderMinutes === 1440
                        ? "1 day before"
                        : `${draft.selectedReminderMinutes} minutes before`}{" "}
                      (confirmed in Google Calendar).
                    </div>
                  ) : (
                    <div className="reminder-options-grid">
                      <button
                        type="button"
                        className={`reminder-option-btn ${draft.selectedReminderMinutes === 10 ? "active" : ""}`}
                        disabled={isSettingReminder}
                        onClick={() => handleReminderPick(10)}
                      >
                        10 minutes
                      </button>
                      <button
                        type="button"
                        className={`reminder-option-btn ${draft.selectedReminderMinutes === 30 ? "active" : ""}`}
                        disabled={isSettingReminder}
                        onClick={() => handleReminderPick(30)}
                      >
                        30 minutes
                      </button>
                      <button
                        type="button"
                        className={`reminder-option-btn ${draft.selectedReminderMinutes === 60 ? "active" : ""}`}
                        disabled={isSettingReminder}
                        onClick={() => handleReminderPick(60)}
                      >
                        1 hour
                      </button>
                      <button
                        type="button"
                        className={`reminder-option-btn ${draft.selectedReminderMinutes === 1440 ? "active" : ""}`}
                        disabled={isSettingReminder}
                        onClick={() => handleReminderPick(1440)}
                      >
                        1 day
                      </button>
                      <button
                        type="button"
                        className="reminder-option-btn"
                        disabled={isSettingReminder}
                        onClick={() => setShowCustomReminderInput(!showCustomReminderInput)}
                      >
                        Custom time
                      </button>
                      <button
                        type="button"
                        className={`reminder-option-btn none ${draft.selectedReminderMinutes === null ? "active" : ""}`}
                        disabled={isSettingReminder}
                        onClick={() => handleReminderPick(null)}
                      >
                        No reminder
                      </button>

                      {showCustomReminderInput && (
                        <div className="custom-reminder-picker">
                          <input
                            type="number"
                            min="1"
                            max="40320"
                            value={customReminderMinutes}
                            onChange={(e) => setCustomReminderMinutes(e.target.value)}
                            placeholder="Minutes"
                          />
                          <span className="picker-unit">mins before</span>
                          <button
                            type="button"
                            className="picker-save-btn"
                            disabled={isSettingReminder}
                            onClick={() => {
                              const val = parseInt(customReminderMinutes, 10);
                              if (val > 0) handleReminderPick(val);
                            }}
                          >
                            Set
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  <p className="reminder-footnote">
                    * Google Calendar popups follow your account's notification settings and limitations.
                  </p>
                </div>
              )}

              {isTaskAction && (
                <p className="task-footnote">
                  * Due date saved to Google Tasks. Google Tasks does not support per-task alarm reminders.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
