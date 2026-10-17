import { BackgroundTask } from '../types';

class TaskQueueManager {
  private tasks: BackgroundTask[] = [];
  private listeners: Array<() => void> = [];

  constructor() {
    // Initial sample finished task for retro feel
    this.tasks = [
      {
        id: 'task_init_1',
        type: 'sync',
        title: 'Cloud Catalog Indexing',
        details: 'Google Drive & OneDrive metadata cache verified',
        progress: 100,
        status: 'completed',
        speed: '12.4 MB/s',
        transferredBytes: 45000000,
        totalBytes: 45000000,
        createdAt: new Date(Date.now() - 1000 * 60 * 5).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      }
    ];
  }

  public getTasks(): BackgroundTask[] {
    return [...this.tasks];
  }

  public getActiveCount(): number {
    return this.tasks.filter(t => t.status === 'running').length;
  }

  public subscribe(listener: () => void) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  private notify() {
    this.listeners.forEach(l => l());
  }

  public addTask(
    type: BackgroundTask['type'],
    title: string,
    details?: string,
    totalBytes?: number
  ): string {
    const id = `task_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    const newTask: BackgroundTask = {
      id,
      type,
      title,
      details,
      progress: 0,
      status: 'running',
      speed: '4.8 MB/s',
      transferredBytes: 0,
      totalBytes: totalBytes || 1024 * 1024,
      createdAt: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    this.tasks.unshift(newTask);
    this.notify();

    // Simulate real task progress in background
    let curr = 0;
    const interval = setInterval(() => {
      const task = this.tasks.find(t => t.id === id);
      if (!task || task.status === 'cancelled') {
        clearInterval(interval);
        return;
      }

      if (task.status === 'paused') {
        return;
      }

      curr += Math.floor(Math.random() * 20) + 10;
      if (curr >= 100) {
        task.progress = 100;
        task.status = 'completed';
        task.transferredBytes = task.totalBytes;
        this.notify();
        clearInterval(interval);
      } else {
        task.progress = curr;
        if (task.totalBytes) {
          task.transferredBytes = Math.floor((curr / 100) * task.totalBytes);
        }
        this.notify();
      }
    }, 280);

    return id;
  }

  public pauseTask(id: string) {
    const task = this.tasks.find(t => t.id === id);
    if (task && task.status === 'running') {
      task.status = 'paused';
      this.notify();
    }
  }

  public resumeTask(id: string) {
    const task = this.tasks.find(t => t.id === id);
    if (task && task.status === 'paused') {
      task.status = 'running';
      this.notify();
    }
  }

  public cancelTask(id: string) {
    const task = this.tasks.find(t => t.id === id);
    if (task) {
      task.status = 'cancelled';
      this.notify();
    }
  }

  public clearCompleted() {
    this.tasks = this.tasks.filter(t => t.status === 'running' || t.status === 'paused');
    this.notify();
  }
}

export const taskQueue = new TaskQueueManager();
