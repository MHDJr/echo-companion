export type Message = {
  role: "user" | "echo";
  text: string;
  id?: string;
  timestamp?: number;
  isError?: boolean;
  canRetry?: boolean;
  detectedLanguage?: string;
  suggestedActions?: string[];
};

export type TaskCategory = "Work" | "Personal" | "Health" | "Learning";
export type TaskPriority = "High" | "Medium" | "Low";

export type TaskItem = {
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
};

export type CalendarCategory = "Team Sync" | "Focus Time" | "Meeting" | "Personal" | "Review";

export type CalendarEvent = {
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
};

export type NavPage = "Home" | "My day" | "Calendar" | "Tasks";

export type GoogleSyncStatus = {
  isConnected: boolean;
  calendarConnected: boolean;
  tasksConnected: boolean;
  googleEmail?: string | null;
  scopes?: string[];
  lastSyncedAt?: string | null;
  isSyncing?: boolean;
  error?: string | null;
};

