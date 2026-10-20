import type { TaskItem } from "../types";
import { initialTasks } from "../data/mockData";

const STORAGE_KEY = "echo_tasks_v1";

/**
 * TaskService Interface
 * 
 * Defines the standard task operations contract.
 * LocalStorageTaskService implements this interface for local device persistence.
 * In a future milestone, a GoogleTasksService can implement this exact interface
 * to connect with Google Tasks API without rewriting UI components.
 */
export interface TaskService {
  getTasks(): Promise<TaskItem[]>;
  createTask(task: Omit<TaskItem, "id">): Promise<TaskItem>;
  updateTask(id: string, updates: Partial<Omit<TaskItem, "id">>): Promise<TaskItem>;
  toggleTask(id: string): Promise<TaskItem>;
  deleteTask(id: string): Promise<void>;
  resetToDefaultTasks(): Promise<TaskItem[]>;
}

function isValidTask(item: unknown): item is TaskItem {
  if (!item || typeof item !== "object") return false;
  const t = item as Record<string, unknown>;
  return (
    typeof t.id === "string" &&
    typeof t.title === "string" &&
    typeof t.completed === "boolean" &&
    typeof t.dueDate === "string" &&
    typeof t.category === "string" &&
    typeof t.priority === "string"
  );
}

export class LocalStorageTaskService implements TaskService {
  private memoryFallback: TaskItem[] | null = null;

  private isStorageAvailable(): boolean {
    try {
      if (typeof window === "undefined" || !window.localStorage) {
        return false;
      }
      const testKey = "__echo_test__";
      window.localStorage.setItem(testKey, testKey);
      window.localStorage.removeItem(testKey);
      return true;
    } catch {
      return false;
    }
  }

  private readRaw(): TaskItem[] {
    if (!this.isStorageAvailable()) {
      if (!this.memoryFallback) {
        this.memoryFallback = [...initialTasks];
      }
      return this.memoryFallback;
    }

    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw === null) {
        // First run on this device: seed with initial sample tasks
        this.writeRaw(initialTasks);
        return [...initialTasks];
      }

      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        console.warn("[TaskService] Stored tasks data is not an array. Resetting safely.");
        this.writeRaw(initialTasks);
        return [...initialTasks];
      }

      const validTasks = parsed.filter(isValidTask);
      if (validTasks.length !== parsed.length) {
        console.warn("[TaskService] Filtered out malformed tasks from storage.");
        this.writeRaw(validTasks);
      }

      return validTasks;
    } catch (err) {
      console.error("[TaskService] Failed to read from localStorage:", err);
      return [...initialTasks];
    }
  }

  private writeRaw(tasks: TaskItem[]): void {
    if (!this.isStorageAvailable()) {
      this.memoryFallback = [...tasks];
      return;
    }

    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
    } catch (err) {
      console.error("[TaskService] Failed to write to localStorage:", err);
      this.memoryFallback = [...tasks];
    }
  }

  async getTasks(): Promise<TaskItem[]> {
    return this.readRaw();
  }

  async createTask(taskData: Omit<TaskItem, "id">): Promise<TaskItem> {
    const trimmedTitle = taskData.title.trim();
    if (!trimmedTitle) {
      throw new Error("Task title cannot be empty or whitespace only.");
    }

    const currentTasks = this.readRaw();
    const newTask: TaskItem = {
      ...taskData,
      title: trimmedTitle,
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    };

    const updated = [newTask, ...currentTasks];
    this.writeRaw(updated);
    return newTask;
  }

  async updateTask(id: string, updates: Partial<Omit<TaskItem, "id">>): Promise<TaskItem> {
    const currentTasks = this.readRaw();
    const index = currentTasks.findIndex((t) => t.id === id);
    if (index === -1) {
      throw new Error(`Task with ID "${id}" not found.`);
    }

    if (updates.title !== undefined) {
      const trimmed = updates.title.trim();
      if (!trimmed) {
        throw new Error("Task title cannot be empty or whitespace only.");
      }
      updates.title = trimmed;
    }

    const existing = currentTasks[index];
    const updatedTask: TaskItem = {
      ...existing,
      ...updates,
      id: existing.id, // Immutable ID
    };

    currentTasks[index] = updatedTask;
    this.writeRaw(currentTasks);
    return updatedTask;
  }

  async toggleTask(id: string): Promise<TaskItem> {
    const currentTasks = this.readRaw();
    const task = currentTasks.find((t) => t.id === id);
    if (!task) {
      throw new Error(`Task with ID "${id}" not found.`);
    }

    return this.updateTask(id, { completed: !task.completed });
  }

  async deleteTask(id: string): Promise<void> {
    const currentTasks = this.readRaw();
    const updated = currentTasks.filter((t) => t.id !== id);
    this.writeRaw(updated);
  }

  async resetToDefaultTasks(): Promise<TaskItem[]> {
    this.writeRaw(initialTasks);
    return [...initialTasks];
  }
}

/**
 * Singleton instance of TaskService for the application.
 * When Google Tasks is implemented, this export can be switched to GoogleTasksService
 * without altering UI component signatures.
 */
export const taskService: TaskService = new LocalStorageTaskService();
