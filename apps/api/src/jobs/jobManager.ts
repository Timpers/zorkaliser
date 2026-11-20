import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { SceneJobEvent } from '@zorkaliser/shared';

interface JobRecord {
  id: string;
  emitter: EventEmitter;
  history: SceneJobEvent[];
  finished: boolean;
  controller: AbortController;
  createdAt: number;
}

const JOB_TTL_MS = 10 * 60 * 1000;

export class SceneJobManager {
  private readonly jobs = new Map<string, JobRecord>();
  private readonly cleanupTimer: NodeJS.Timeout;

  constructor() {
    this.cleanupTimer = setInterval(() => this.pruneExpired(), 60_000);
    this.cleanupTimer.unref();
  }

  createJob(runner: (emit: (event: SceneJobEvent) => void, signal: AbortSignal) => Promise<void>): string {
    const jobId = crypto.randomUUID();
    const record: JobRecord = {
      id: jobId,
      emitter: new EventEmitter(),
      history: [],
      finished: false,
      controller: new AbortController(),
      createdAt: Date.now(),
    };
    this.jobs.set(jobId, record);

    const emit = (event: SceneJobEvent) => {
      record.history.push(event);
      if (event.type === 'completed' || event.type === 'failed') {
        record.finished = true;
      }
      record.emitter.emit('event', event);
    };

    // Execute asynchronously on the next microtask so HTTP 202 returns immediately
    queueMicrotask(() => {
      runner(emit, record.controller.signal).catch((err) => {
        if (!record.finished) {
          emit({
            type: 'failed',
            jobId,
            error: err instanceof Error ? err.message : 'Unexpected generation error',
            code: record.controller.signal.aborted ? 'cancelled' : 'provider_error',
          });
        }
      });
    });

    return jobId;
  }

  subscribe(jobId: string, listener: (event: SceneJobEvent) => void): (() => void) | null {
    const record = this.jobs.get(jobId);
    if (!record) return null;

    // Replay past events so late SSE subscribers never miss completion
    for (const pastEvent of record.history) {
      listener(pastEvent);
    }

    if (record.finished) {
      return () => {};
    }

    record.emitter.on('event', listener);
    return () => {
      record.emitter.off('event', listener);
    };
  }

  cancel(jobId: string): boolean {
    const record = this.jobs.get(jobId);
    if (!record || record.finished) return false;
    record.controller.abort();
    return true;
  }

  hasJob(jobId: string): boolean {
    return this.jobs.has(jobId);
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [id, record] of this.jobs.entries()) {
      if (now - record.createdAt > JOB_TTL_MS) {
        this.jobs.delete(id);
      }
    }
  }

  dispose(): void {
    clearInterval(this.cleanupTimer);
    for (const record of this.jobs.values()) {
      record.controller.abort();
    }
    this.jobs.clear();
  }
}
