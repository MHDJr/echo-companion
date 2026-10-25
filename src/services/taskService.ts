import type { TaskItem } from "../types";
import { initialTasks } from "../data/mockData";
import {
  fetchGoogleTasks,
  createGoogleTask,
  updateGoogleTask,
  deleteGoogleTask,
} from "./googleSyncService";

const STORAGE_KEY = "echo_tasks_v1";

export interface TaskService {
  getTasks(): Promise<TaskItem[]>;
  createTask(task: Omit<TaskItem, "id">): Promise<TaskItem>;
  updateTask(id: string, updates: Partial<Omit<TaskItem, "id">>): Promise<TaskItem>;
  toggleTask(id: string): Promise<TaskItem>;
  deleteTask(id: string): Promise<void>;
  resetToDefaultTasks(): Promise<TaskItem[]>;
  setGoogleConnected(connected: boolean): void;
  isGoogleConnected(): boolean;
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

export class HybridTaskService implements TaskService {
  private memoryFallback: TaskItem[] | null = null;
  private googleConnected = false;

  setGoogleConnected(connected: boolean): void {
    this.googleConnected = connected;
  }

  isGoogleConnected(): boolean {
    return this.googleConnected;
  }

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
        this.writeRaw(initialTasks);
        return [...initialTasks];
      }

      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        this.writeRaw(initialTasks);
        return [...initialTasks];
      }

      const validTasks = parsed.filter(isValidTask);
      if (validTasks.length !== parsed.length) {
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
    const localTasks = this.readRaw();

    if (!this.googleConnected) {
      return localTasks;
    }

    try {
      const gTasks = await fetchGoogleTasks();
      if (!Array.isArray(gTasks)) return localTasks;

      // Merge Google tasks with local tasks without duplicates
      // Any task whose googleTaskId matches replaces or augments
      const googleMap = new Map<string, TaskItem>();
      gTasks.forEach((gt) => {
        if (gt.googleTaskId) googleMap.set(gt.googleTaskId, gt);
        googleMap.set(gt.id, gt);
      });

      const merged: TaskItem[] = [...gTasks];

      // Keep local-only tasks that don't have a googleTaskId
      localTasks.forEach((lt) => {
        if (!lt.googleTaskId && !googleMap.has(lt.id)) {
          merged.push(lt);
        }
      });

      this.writeRaw(merged);
      return merged;
    } catch (err) {
      console.warn("[TaskService] Could not refresh Google Tasks; using local cache:", err);
      return localTasks;
    }
  }

  async createTask(taskData: Omit<TaskItem, "id">): Promise<TaskItem> {
    const trimmedTitle = taskData.title.trim();
    if (!trimmedTitle) {
      throw new Error("Task title cannot be empty or whitespace only.");
    }

    // If Google Workspace is connected, create in Google Tasks first
    if (this.googleConnected) {
      try {
        const createdGoogle = await createGoogleTask({
          ...taskData,
          title: trimmedTitle,
        });

        const currentTasks = this.readRaw();
        const updated = [createdGoogle, ...currentTasks.filter((t) => t.id !== createdGoogle.id)];
        this.writeRaw(updated);
        return createdGoogle;
      } catch (err) {
        console.warn("[TaskService] Google task creation failed; creating locally with retry marker:", err);
      }
    }

    const currentTasks = this.readRaw();
    const newTask: TaskItem = {
      ...taskData,
      title: trimmedTitle,
      id: `task-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      source: "local",
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

    // If task belongs to Google Tasks and Google is connected, sync update to Google
    if (this.googleConnected && (existing.googleTaskId || existing.source === "google")) {
      const gId = existing.googleTaskId || existing.id;
      try {
        const updatedGoogle = await updateGoogleTask(gId, updates);
        currentTasks[index] = updatedGoogle;
        this.writeRaw(currentTasks);
        return updatedGoogle;
      } catch (err) {
        console.warn("[TaskService] Google task update failed; applying locally:", err);
      }
    }

    const updatedTask: TaskItem = {
      ...existing,
      ...updates,
      id: existing.id,
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
    const task = currentTasks.find((t) => t.id === id);

    if (this.googleConnected && task && (task.googleTaskId || task.source === "google")) {
      const gId = task.googleTaskId || task.id;
      try {
        await deleteGoogleTask(gId);
      } catch (err) {
        console.warn("[TaskService] Google task deletion failed; removing locally:", err);
      }
    }

    const updated = currentTasks.filter((t) => t.id !== id);
    this.writeRaw(updated);
  }

  async resetToDefaultTasks(): Promise<TaskItem[]> {
    this.writeRaw(initialTasks);
    return [...initialTasks];
  }
}

export const taskService: TaskService = new HybridTaskService();
