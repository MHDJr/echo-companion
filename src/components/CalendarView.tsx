import { useState } from "react";
import type { CalendarCategory, CalendarEvent } from "../types";

interface CalendarViewProps {
  events: CalendarEvent[];
  onAddEvent: (event: Omit<CalendarEvent, "id">) => void;
  onEditEvent?: (id: string, updates: Partial<CalendarEvent>) => void;
  onDeleteEvent?: (id: string) => void;
  onAskEcho: (prompt: string) => void;
  isGoogleConnected?: boolean;
  googleEmail?: string | null;
  onSyncGoogle?: () => void;
  isSyncing?: boolean;
  onConnectGoogle?: () => void;
}

export function CalendarView({
  events,
  onAddEvent,
  onEditEvent,
  onDeleteEvent,
  onAskEcho,
  isGoogleConnected = false,
  googleEmail,
  onSyncGoogle,
  isSyncing = false,
  onConnectGoogle,
}: CalendarViewProps) {
  // Use today's date format YYYY-MM-DD
  const todayStr = new Date().toISOString().split("T")[0];
  const [selectedDate, setSelectedDate] = useState(todayStr);

  // Add modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [newEventTitle, setNewEventTitle] = useState("");
  const [newEventTime, setNewEventTime] = useState("02:00 PM - 03:00 PM");
  const [newEventCategory, setNewEventCategory] = useState<CalendarCategory>("Focus Time");
  const [newEventLocation, setNewEventLocation] = useState("");

  // Edit / Delete modal state
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editTime, setEditTime] = useState("");
  const [editCategory, setEditCategory] = useState<CalendarCategory>("Meeting");
  const [editLocation, setEditLocation] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Month navigation: default current month/year
  const todayDate = new Date();
  const [currentYear, setCurrentYear] = useState(todayDate.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(todayDate.getMonth()); // 0-indexed

  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  function handlePrevMonth() {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear((y) => y - 1);
    } else {
      setCurrentMonth((m) => m - 1);
    }
  }

  function handleNextMonth() {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear((y) => y + 1);
    } else {
      setCurrentMonth((m) => m + 1);
    }
  }

  function handleToday() {
    const now = new Date();
    setCurrentYear(now.getFullYear());
    setCurrentMonth(now.getMonth());
    setSelectedDate(todayStr);
  }

  // Calculate calendar grid days
  const firstDayOfMonth = new Date(currentYear, currentMonth, 1).getDay();
  // Adjust so Monday is 0, Sunday is 6
  const startDayIndex = (firstDayOfMonth + 6) % 7;
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

  // Days in previous month
  const daysInPrevMonth = new Date(currentYear, currentMonth, 0).getDate();

  const calendarDays = [];

  // Previous month padding days
  for (let i = startDayIndex - 1; i >= 0; i--) {
    calendarDays.push({
      day: daysInPrevMonth - i,
      isCurrentMonth: false,
      dateString: "",
    });
  }

  // Current month days
  for (let d = 1; d <= daysInMonth; d++) {
    const monthStr = String(currentMonth + 1).padStart(2, "0");
    const dayStr = String(d).padStart(2, "0");
    const dateString = `${currentYear}-${monthStr}-${dayStr}`;
    calendarDays.push({
      day: d,
      isCurrentMonth: true,
      dateString,
    });
  }

  // Next month padding days to complete 35 or 42 cells
  const totalCells = calendarDays.length > 35 ? 42 : 35;
  const remainingCells = totalCells - calendarDays.length;
  for (let d = 1; d <= remainingCells; d++) {
    calendarDays.push({
      day: d,
      isCurrentMonth: false,
      dateString: "",
    });
  }

  const selectedDateEvents = events.filter((e) => e.date === selectedDate);

  // Format selected date nicely
  const selectedDateObj = new Date(selectedDate + "T12:00:00");
  const formattedSelectedDate = isNaN(selectedDateObj.getTime())
    ? selectedDate
    : selectedDateObj.toLocaleDateString("en-US", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      });

  function handleCreateEvent(e: React.FormEvent) {
    e.preventDefault();
    if (!newEventTitle.trim()) return;

    onAddEvent({
      title: newEventTitle.trim(),
      date: selectedDate,
      time: newEventTime,
      category: newEventCategory,
      location: newEventLocation.trim() || "Virtual Workspace",
      isDemo: !isGoogleConnected,
      source: isGoogleConnected ? "google" : "local",
    });

    setNewEventTitle("");
    setShowAddModal(false);
  }

  function startEditEvent(event: CalendarEvent) {
    setEditingEvent(event);
    setEditTitle(event.title);
    setEditTime(event.time);
    setEditCategory(event.category);
    setEditLocation(event.location || "");
    setConfirmDeleteId(null);
  }

  function handleSaveEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingEvent || !onEditEvent || !editTitle.trim()) return;

    onEditEvent(editingEvent.id, {
      title: editTitle.trim(),
      time: editTime.trim(),
      category: editCategory,
      location: editLocation.trim(),
    });

    setEditingEvent(null);
  }

  function handleDeleteCurrentEvent() {
    if (!editingEvent || !onDeleteEvent) return;
    onDeleteEvent(editingEvent.id);
    setEditingEvent(null);
    setConfirmDeleteId(null);
  }

  return (
    <div className="section-container calendar-view">
      <div className="section-header">
        <div className="eyebrow">
          <span className="pulse-dot" /> {isGoogleConnected ? "GOOGLE WORKSPACE · LIVE SYNC" : "CALENDAR WORKSPACE"}
        </div>
        <h1 className="section-title">
          Schedule & Rhythm
          <br />
          <span className="section-subtitle-span">Designed for clarity.</span>
        </h1>
        <p className="section-description">
          Review your time commitments and protect your focus. Two-way Google Calendar synchronization keeps your schedule effortlessly aligned.
        </p>
      </div>

      {isGoogleConnected ? (
        <div className="demo-notice-banner live-sync-banner">
          <div className="demo-banner-content">
            <span className="live-sync-badge-pill">✓ GOOGLE CALENDAR ACTIVE</span>
            <p className="demo-banner-text">
              Connected as <strong>{googleEmail || "Google Account"}</strong>. Changes made in Echo sync to Google Calendar, and your Google events appear here.
            </p>
          </div>
          {onSyncGoogle && (
            <button
              type="button"
              className="banner-sync-btn"
              onClick={onSyncGoogle}
              disabled={isSyncing}
            >
              {isSyncing ? "↻ Syncing..." : "↻ Refresh Calendar"}
            </button>
          )}
        </div>
      ) : (
        <div className="demo-notice-banner">
          <div className="demo-banner-content">
            <span className="demo-badge-pill">PREVIEW MODE</span>
            <p className="demo-banner-text">
              Connect your Google Calendar to synchronize your real-world meetings, focus blocks, and events two-way.
            </p>
          </div>
          {onConnectGoogle && (
            <button
              type="button"
              className="banner-connect-btn"
              onClick={onConnectGoogle}
            >
              Connect Google Calendar
            </button>
          )}
        </div>
      )}

      <div className="calendar-workspace-layout">
        <div className="content-card calendar-grid-card">
          <div className="calendar-toolbar">
            <div className="calendar-month-selector">
              <h2 className="calendar-month-title">
                {monthNames[currentMonth]} {currentYear}
              </h2>
              <div className="calendar-nav-buttons">
                <button
                  type="button"
                  className="calendar-nav-btn"
                  onClick={handlePrevMonth}
                  aria-label="Previous Month"
                >
                  ‹
                </button>
                <button
                  type="button"
                  className="calendar-nav-btn"
                  onClick={handleNextMonth}
                  aria-label="Next Month"
                >
                  ›
                </button>
                <button
                  type="button"
                  className="calendar-today-btn"
                  onClick={handleToday}
                >
                  Today
                </button>
              </div>
            </div>
            <button
              type="button"
              className="add-event-toggle-btn"
              onClick={() => setShowAddModal(!showAddModal)}
            >
              {showAddModal ? "Cancel" : isGoogleConnected ? "+ Add Event" : "+ Add Preview Event"}
            </button>
          </div>

          {showAddModal && (
            <form className="add-event-form" onSubmit={handleCreateEvent}>
              <p className="form-title">
                {isGoogleConnected ? "Add Google Calendar Event" : "Add Event"} for {selectedDate}
              </p>
              <div className="form-grid">
                <input
                  type="text"
                  placeholder="Event title (e.g. Design critique)"
                  value={newEventTitle}
                  onChange={(e) => setNewEventTitle(e.target.value)}
                  className="form-input"
                  required
                />
                <input
                  type="text"
                  placeholder="Time (e.g. 02:00 PM - 03:00 PM)"
                  value={newEventTime}
                  onChange={(e) => setNewEventTime(e.target.value)}
                  className="form-input"
                  required
                />
                <select
                  value={newEventCategory}
                  onChange={(e) =>
                    setNewEventCategory(e.target.value as CalendarCategory)
                  }
                  className="form-select"
                >
                  <option value="Team Sync">Team Sync</option>
                  <option value="Focus Time">Focus Time</option>
                  <option value="Meeting">Meeting</option>
                  <option value="Personal">Personal</option>
                  <option value="Review">Review</option>
                </select>
                <input
                  type="text"
                  placeholder="Location or link (optional)"
                  value={newEventLocation}
                  onChange={(e) => setNewEventLocation(e.target.value)}
                  className="form-input"
                />
              </div>
              <div className="form-actions">
                <button
                  type="button"
                  className="form-cancel-btn"
                  onClick={() => setShowAddModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="form-submit-btn">
                  {isGoogleConnected ? "Save to Google Calendar" : "Save Event"}
                </button>
              </div>
            </form>
          )}

          <div className="calendar-weekdays">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => (
              <div key={day} className="weekday-header">
                <span className="weekday-full">{day}</span>
                <span className="weekday-short">{day.slice(0, 1)}</span>
              </div>
            ))}
          </div>

          <div className="calendar-grid">
            {calendarDays.map((cell, idx) => {
              if (!cell.isCurrentMonth) {
                return (
                  <div key={idx} className="calendar-cell outside-month">
                    <span className="cell-day-num">{cell.day}</span>
                  </div>
                );
              }

              const isSelected = cell.dateString === selectedDate;
              const isToday = cell.dateString === todayStr;
              const dayEvents = events.filter((e) => e.date === cell.dateString);

              return (
                <button
                  key={idx}
                  type="button"
                  className={`calendar-cell current-month ${
                    isSelected ? "selected" : ""
                  } ${isToday ? "today" : ""}`}
                  onClick={() => setSelectedDate(cell.dateString)}
                >
                  <div className="cell-top">
                    <span className={`cell-day-num ${isToday ? "today-badge" : ""}`}>
                      {cell.day}
                    </span>
                    {dayEvents.length > 0 && (
                      <span className="cell-event-count">
                        {dayEvents.length}
                      </span>
                    )}
                  </div>
                  <div className="cell-event-dots">
                    {dayEvents.slice(0, 3).map((event) => (
                      <span
                        key={event.id}
                        className={`cell-event-dot cat-${event.category.toLowerCase().replace(/\s+/g, "-")}`}
                        title={event.title}
                      />
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="content-card day-agenda-card">
          <div className="card-header-row">
            <div>
              <p className="section-label">SELECTED DAY AGENDA</p>
              <h2 className="card-heading">{formattedSelectedDate}</h2>
            </div>
            <span className="demo-pill">
              {isGoogleConnected ? "LIVE SYNCED" : "PREVIEW SCHEDULE"}
            </span>
          </div>

          <div className="agenda-events-list">
            {selectedDateEvents.length === 0 ? (
              <div className="empty-agenda-state">
                <span className="empty-icon">🌿</span>
                <p className="empty-title">No events scheduled</p>
                <p className="empty-desc">
                  This date is completely clear. A great opportunity for uninterrupted focus or personal reflection.
                </p>
                <button
                  type="button"
                  className="quick-action-btn"
                  onClick={() =>
                    onAskEcho(`Help me plan a productive deep focus block for ${selectedDate}`)
                  }
                >
                  Plan focus block with Echo ↗
                </button>
              </div>
            ) : (
              selectedDateEvents.map((event) => (
                <div
                  key={event.id}
                  className="agenda-event-card interactive"
                  onClick={() => startEditEvent(event)}
                  title="Click to view or edit event"
                >
                  <div className="event-time-column">
                    <span className="event-time">{event.time}</span>
                    <span className={`event-demo-tag ${event.source === "google" || event.googleEventId ? "google-tag" : ""}`}>
                      {event.source === "google" || event.googleEventId ? "GOOGLE" : "PREVIEW"}
                    </span>
                  </div>
                  <div className="event-details">
                    <div className="event-title-row">
                      <h3 className="event-title">{event.title}</h3>
                      <span
                        className={`tag-pill cat-${event.category
                          .toLowerCase()
                          .replace(/\s+/g, "-")}`}
                      >
                        {event.category}
                      </span>
                    </div>
                    {event.location && (
                      <p className="event-location">📍 {event.location}</p>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Edit / Delete Event Modal */}
      {editingEvent && (
        <div className="auth-modal-backdrop" onClick={() => setEditingEvent(null)} role="dialog" aria-modal="true">
          <div className="auth-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="auth-modal-header">
              <div className="auth-modal-badge">
                {editingEvent.source === "google" || editingEvent.googleEventId ? "GOOGLE CALENDAR EVENT" : "EVENT DETAILS"}
              </div>
              <button className="auth-modal-close" onClick={() => setEditingEvent(null)} aria-label="Close dialog">
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="auth-form" style={{ marginTop: "1rem" }}>
              <label className="auth-field">
                <span>Title</span>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  required
                />
              </label>

              <label className="auth-field">
                <span>Time</span>
                <input
                  type="text"
                  value={editTime}
                  onChange={(e) => setEditTime(e.target.value)}
                  placeholder="02:00 PM - 03:00 PM"
                  required
                />
              </label>

              <label className="auth-field">
                <span>Category</span>
                <select
                  value={editCategory}
                  onChange={(e) => setEditCategory(e.target.value as CalendarCategory)}
                  className="form-select"
                  style={{ width: "100%", padding: "0.5rem", borderRadius: "8px", background: "var(--color-surface, #fcfcf9)", border: "1px solid var(--color-border, #e5e5df)" }}
                >
                  <option value="Team Sync">Team Sync</option>
                  <option value="Focus Time">Focus Time</option>
                  <option value="Meeting">Meeting</option>
                  <option value="Personal">Personal</option>
                  <option value="Review">Review</option>
                </select>
              </label>

              <label className="auth-field">
                <span>Location</span>
                <input
                  type="text"
                  value={editLocation}
                  onChange={(e) => setEditLocation(e.target.value)}
                  placeholder="Optional meeting link or room"
                />
              </label>

              <div className="auth-actions-row" style={{ marginTop: "1.25rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                {confirmDeleteId === editingEvent.id ? (
                  <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                    <span style={{ fontSize: "0.8rem", color: "#b91c1c" }}>Confirm?</span>
                    <button
                      type="button"
                      className="auth-signout-btn"
                      onClick={handleDeleteCurrentEvent}
                      style={{ padding: "0.4rem 0.75rem", fontSize: "0.8rem" }}
                    >
                      Yes, delete
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteId(null)}
                      style={{ background: "none", border: "none", cursor: "pointer", fontSize: "0.8rem", color: "#666" }}
                    >
                      No
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="auth-signout-btn"
                    onClick={() => setConfirmDeleteId(editingEvent.id)}
                    style={{ padding: "0.5rem 1rem", fontSize: "0.85rem" }}
                  >
                    Delete Event
                  </button>
                )}

                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <button
                    type="button"
                    className="form-cancel-btn"
                    onClick={() => setEditingEvent(null)}
                  >
                    Cancel
                  </button>
                  <button type="submit" className="auth-done-btn">
                    Save Changes
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
