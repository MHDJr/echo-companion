import { useState } from "react";
import type { CalendarCategory, CalendarEvent } from "../types";

interface CalendarViewProps {
  events: CalendarEvent[];
  onAddEvent: (event: Omit<CalendarEvent, "id">) => void;
  onAskEcho: (prompt: string) => void;
}

export function CalendarView({
  events,
  onAddEvent,
  onAskEcho,
}: CalendarViewProps) {
  const [selectedDate, setSelectedDate] = useState("2026-10-20");
  const [showAddModal, setShowAddModal] = useState(false);
  const [newEventTitle, setNewEventTitle] = useState("");
  const [newEventTime, setNewEventTime] = useState("02:00 PM - 03:00 PM");
  const [newEventCategory, setNewEventCategory] = useState<CalendarCategory>("Focus Time");
  const [newEventLocation, setNewEventLocation] = useState("");

  // Month navigation: default October 2026
  const [currentYear, setCurrentYear] = useState(2026);
  const [currentMonth, setCurrentMonth] = useState(9); // 0-indexed: 9 = October

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
    setCurrentYear(2026);
    setCurrentMonth(9);
    setSelectedDate("2026-10-20");
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
  const formattedSelectedDate = selectedDateObj.toLocaleDateString("en-US", {
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
      isDemo: true,
    });

    setNewEventTitle("");
    setShowAddModal(false);
  }

  return (
    <div className="section-container calendar-view">
      <div className="section-header">
        <div className="eyebrow">
          <span className="pulse-dot" /> CALENDAR WORKSPACE · DEMO PREVIEW
        </div>
        <h1 className="section-title">
          Schedule & Rhythm
          <br />
          <span className="section-subtitle-span">Designed for clarity.</span>
        </h1>
        <p className="section-description">
          Review your time commitments and protect your focus. Connect to Google Calendar coming in future milestones.
        </p>
      </div>

      <div className="demo-notice-banner">
        <div className="demo-banner-content">
          <span className="demo-badge-pill">DEMO DATA</span>
          <p className="demo-banner-text">
            All events and schedules below are demonstration data for testing the Echo interface. No external Google accounts are connected yet.
          </p>
        </div>
      </div>

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
              {showAddModal ? "Cancel" : "+ Add Demo Event"}
            </button>
          </div>

          {showAddModal && (
            <form className="add-event-form" onSubmit={handleCreateEvent}>
              <p className="form-title">Add Demo Event for {selectedDate}</p>
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
                  Save Demo Event
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
              const isToday = cell.dateString === "2026-10-20";
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
            <span className="demo-pill">DEMO SCHEDULE</span>
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
                <div key={event.id} className="agenda-event-card">
                  <div className="event-time-column">
                    <span className="event-time">{event.time}</span>
                    <span className="event-demo-tag">DEMO</span>
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
    </div>
  );
}
