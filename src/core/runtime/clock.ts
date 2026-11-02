/** Time source. Inject it instead of calling `new Date()` so time-dependent rules are testable. */
export interface Clock {
  now(): Date;
  /** UTC ISO-8601 with milliseconds — the storage format of every timestamp column. */
  nowIso(): string;
  addMinutesIso(minutes: number, from?: Date): string;
}

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }

  nowIso(): string {
    return new Date().toISOString();
  }

  addMinutesIso(minutes: number, from: Date = new Date()): string {
    return new Date(from.getTime() + minutes * 60_000).toISOString();
  }
}

/** Deterministic clock for tests. */
export class FixedClock implements Clock {
  constructor(private current: Date) {}

  now(): Date {
    return new Date(this.current);
  }

  nowIso(): string {
    return this.current.toISOString();
  }

  addMinutesIso(minutes: number, from: Date = this.current): string {
    return new Date(from.getTime() + minutes * 60_000).toISOString();
  }

  advanceMinutes(minutes: number): void {
    this.current = new Date(this.current.getTime() + minutes * 60_000);
  }
}
