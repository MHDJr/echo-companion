export type Message = {
  role: "user" | "echo";
  text: string;
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
};

export type CalendarCategory = "Team Sync" | "Focus Time" | "Meeting" | "Personal" | "Review";

export type CalendarEvent = {
  id: string;
  title: string;
  date: string; // YYYY-MM-DD format
  time: string; // e.g. "09:00 AM - 10:00 AM"
  category: CalendarCategory;
  location?: string;
  isDemo: boolean;
};

export type NavPage = "Home" | "My day" | "Calendar" | "Tasks";
