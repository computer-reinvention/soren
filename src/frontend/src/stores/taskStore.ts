import { create } from 'zustand';
import type { Task } from '../types/task';

interface TaskState {
  tasks: Task[];
  setTasks: (tasks: Task[]) => void;
}

export const useTaskStore = create<TaskState>((set) => ({
  tasks: [],
  setTasks: (tasks) => set({ tasks }),
}));
