export type ActionType =
  | "create_event"
  | "create_task"
  | "update_event"
  | "update_task"
  | "complete_task"
  | "delete_event"
  | "delete_task"
  | "none";

export type ActionDraftStatus =
  | "pending"
  | "confirmed"
  | "completed"
  | "cancelled"
  | "failed";

export interface ActionDraft {
  id: string;
  originalRequest: string;
  type: ActionType;
  title: string;
  description?: string;
  date?: string; // YYYY-MM-DD
  startTime?: string;
  endTime?: string;
  timeZone?: string;
  dueDate?: string; // YYYY-MM-DD or relative like "Today"
  targetResourceId?: string;
  clarificationPrompt?: string;
  status: ActionDraftStatus;
  requiresConfirmation: boolean;
  executionError?: string;
  createdResourceId?: string;
  selectedReminderMinutes?: number | null;
  reminderConfirmed?: boolean;
}

export interface Message {
  role: "user" | "echo";
  text: string;
  id?: string;
  timestamp?: number;
  isError?: boolean;
  canRetry?: boolean;
  detectedLanguage?: string;
  suggestedActions?: string[];
  actionDraft?: ActionDraft | null;
}

export type TaskCategory = "Work" | "Personal" | "Health" | "Learning";
export type TaskPriority = "High" | "Medium" | "Low";

export interface TaskItem {
  id: string;
  title: string;
  completed: boolean;
  dueDate: string;
  category: TaskCategory;
  priority: TaskPriority;
  isTodayPriority?: boolean;
  googleTaskId?: string;
  googleTaskListId?: string;
  notes?: string;
  updated?: string;
  source?: "google" | "local";
}

export type CalendarCategory = "Team Sync" | "Focus Time" | "Meeting" | "Personal" | "Review";

export interface CalendarEventReminderOverride {
  method: "popup" | "email";
  minutes: number;
}

export interface CalendarEventReminders {
  useDefault: boolean;
  overrides?: CalendarEventReminderOverride[];
}

export interface CalendarEvent {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD format
  time: string; // e.g. "09:00 AM - 10:00 AM"
  category: CalendarCategory;
  location?: string;
  description?: string;
  isDemo: boolean;
  googleEventId?: string;
  source?: "google" | "local";
  reminders?: CalendarEventReminders | null;
}

export type NavPage = "Home" | "My day" | "Calendar" | "Tasks";

export interface GoogleSyncStatus {
  isConnected: boolean;
  calendarConnected: boolean;
  tasksConnected: boolean;
  googleEmail?: string | null;
  scopes?: string[];
  lastSyncedAt?: string | null;
  isSyncing?: boolean;
  error?: string | null;
}
