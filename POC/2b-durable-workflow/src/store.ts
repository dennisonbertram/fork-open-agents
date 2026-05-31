// Durable persistence backend for the workflow engine.
//
// Backed by a REAL on-disk SQLite database (bun:sqlite) so that "re-instantiate
// from the persisted log only" is a genuine claim: the process can die and a
// brand-new process can open the same file and reconstruct every run's state.
// This is the local-development analogue of the DevKit's "World" abstraction
// (Local World = filesystem JSON, Vercel World = Redis/Queues, Postgres World =
// graphile-worker). Swapping this class for a Postgres/Drizzle-backed store is
// the only change needed to move from prototype to the repo's Neon database.

import { Database } from "bun:sqlite";
import type {
  EventWaiterRecord,
  RunRecord,
  RunStatus,
  SleepRecord,
  StepRecord,
  StepStatus,
} from "./types";

export class WorkflowStore {
  private db: Database;

  constructor(path: string) {
    this.db = new Database(path, { create: true });
    // WAL = durable + safe across a hard process kill mid-write.
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA synchronous = FULL;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS runs (
        runId TEXT PRIMARY KEY,
        workflowName TEXT NOT NULL,
        status TEXT NOT NULL,
        inputJson TEXT NOT NULL,
        resultJson TEXT,
        errorMessage TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS steps (
        runId TEXT NOT NULL,
        stepKey TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        status TEXT NOT NULL,
        resultJson TEXT,
        errorMessage TEXT,
        attempts INTEGER NOT NULL,
        startedAt TEXT NOT NULL,
        finishedAt TEXT NOT NULL,
        PRIMARY KEY (runId, stepKey)
      );
      CREATE TABLE IF NOT EXISTS sleeps (
        runId TEXT NOT NULL,
        stepKey TEXT NOT NULL,
        wakeAt TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        firedAt TEXT,
        PRIMARY KEY (runId, stepKey)
      );
      CREATE TABLE IF NOT EXISTS event_waiters (
        runId TEXT NOT NULL,
        stepKey TEXT NOT NULL,
        token TEXT NOT NULL,
        payloadJson TEXT,
        createdAt TEXT NOT NULL,
        deliveredAt TEXT,
        PRIMARY KEY (runId, stepKey)
      );
      CREATE INDEX IF NOT EXISTS idx_waiters_token ON event_waiters(token);
    `);
  }

  private now(): string {
    return new Date().toISOString();
  }

  // ---- runs ----

  createRun(runId: string, workflowName: string, input: unknown): RunRecord {
    const now = this.now();
    const inputJson = JSON.stringify(input ?? null);
    this.db
      .query(
        `INSERT INTO runs (runId, workflowName, status, inputJson, resultJson, errorMessage, createdAt, updatedAt)
         VALUES (?, ?, 'running', ?, NULL, NULL, ?, ?)
         ON CONFLICT(runId) DO NOTHING`,
      )
      .run(runId, workflowName, inputJson, now, now);
    const run = this.getRun(runId);
    if (!run) {
      throw new Error(`failed to create run ${runId}`);
    }
    return run;
  }

  getRun(runId: string): RunRecord | null {
    return (
      (this.db
        .query("SELECT * FROM runs WHERE runId = ?")
        .get(runId) as RunRecord | null) ?? null
    );
  }

  setRunStatus(
    runId: string,
    status: RunStatus,
    extra?: { result?: unknown; errorMessage?: string | null },
  ): void {
    const now = this.now();
    if (extra && "result" in extra) {
      this.db
        .query(
          "UPDATE runs SET status = ?, resultJson = ?, updatedAt = ? WHERE runId = ?",
        )
        .run(status, JSON.stringify(extra.result ?? null), now, runId);
    } else if (extra && "errorMessage" in extra) {
      this.db
        .query(
          "UPDATE runs SET status = ?, errorMessage = ?, updatedAt = ? WHERE runId = ?",
        )
        .run(status, extra.errorMessage ?? null, now, runId);
    } else {
      this.db
        .query("UPDATE runs SET status = ?, updatedAt = ? WHERE runId = ?")
        .run(status, now, runId);
    }
  }

  // ---- steps ----

  getStep(runId: string, stepKey: string): StepRecord | null {
    return (
      (this.db
        .query("SELECT * FROM steps WHERE runId = ? AND stepKey = ?")
        .get(runId, stepKey) as StepRecord | null) ?? null
    );
  }

  recordStep(params: {
    runId: string;
    stepKey: string;
    ordinal: number;
    status: StepStatus;
    result?: unknown;
    errorMessage?: string | null;
    attempts: number;
    startedAt: string;
  }): void {
    this.db
      .query(
        `INSERT INTO steps (runId, stepKey, ordinal, status, resultJson, errorMessage, attempts, startedAt, finishedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(runId, stepKey) DO UPDATE SET
           status = excluded.status,
           resultJson = excluded.resultJson,
           errorMessage = excluded.errorMessage,
           attempts = excluded.attempts,
           finishedAt = excluded.finishedAt`,
      )
      .run(
        params.runId,
        params.stepKey,
        params.ordinal,
        params.status,
        params.status === "completed"
          ? JSON.stringify(params.result ?? null)
          : null,
        params.errorMessage ?? null,
        params.attempts,
        params.startedAt,
        this.now(),
      );
  }

  listSteps(runId: string): StepRecord[] {
    return this.db
      .query("SELECT * FROM steps WHERE runId = ? ORDER BY ordinal ASC")
      .all(runId) as StepRecord[];
  }

  // ---- sleeps ----

  getSleep(runId: string, stepKey: string): SleepRecord | null {
    return (
      (this.db
        .query("SELECT * FROM sleeps WHERE runId = ? AND stepKey = ?")
        .get(runId, stepKey) as SleepRecord | null) ?? null
    );
  }

  createSleep(runId: string, stepKey: string, wakeAt: string): SleepRecord {
    this.db
      .query(
        `INSERT INTO sleeps (runId, stepKey, wakeAt, createdAt, firedAt)
         VALUES (?, ?, ?, ?, NULL)
         ON CONFLICT(runId, stepKey) DO NOTHING`,
      )
      .run(runId, stepKey, wakeAt, this.now());
    const sleep = this.getSleep(runId, stepKey);
    if (!sleep) {
      throw new Error(`failed to create sleep ${runId}/${stepKey}`);
    }
    return sleep;
  }

  fireSleep(runId: string, stepKey: string): void {
    this.db
      .query("UPDATE sleeps SET firedAt = ? WHERE runId = ? AND stepKey = ?")
      .run(this.now(), runId, stepKey);
  }

  // ---- event waiters ----

  getWaiter(runId: string, stepKey: string): EventWaiterRecord | null {
    return (
      (this.db
        .query("SELECT * FROM event_waiters WHERE runId = ? AND stepKey = ?")
        .get(runId, stepKey) as EventWaiterRecord | null) ?? null
    );
  }

  createWaiter(
    runId: string,
    stepKey: string,
    token: string,
  ): EventWaiterRecord {
    this.db
      .query(
        `INSERT INTO event_waiters (runId, stepKey, token, payloadJson, createdAt, deliveredAt)
         VALUES (?, ?, ?, NULL, ?, NULL)
         ON CONFLICT(runId, stepKey) DO NOTHING`,
      )
      .run(runId, stepKey, token, this.now());
    const waiter = this.getWaiter(runId, stepKey);
    if (!waiter) {
      throw new Error(`failed to create waiter ${runId}/${stepKey}`);
    }
    return waiter;
  }

  // Deliver an external event by token. Returns the runIds that were waiting.
  // Idempotent: only undelivered waiters are updated. This is the seam an HTTP
  // webhook / approval endpoint / cron trigger calls.
  deliverEvent(token: string, payload: unknown): string[] {
    const waiters = this.db
      .query(
        "SELECT * FROM event_waiters WHERE token = ? AND deliveredAt IS NULL",
      )
      .all(token) as EventWaiterRecord[];
    const now = this.now();
    const payloadJson = JSON.stringify(payload ?? null);
    for (const waiter of waiters) {
      this.db
        .query(
          "UPDATE event_waiters SET payloadJson = ?, deliveredAt = ? WHERE runId = ? AND stepKey = ?",
        )
        .run(payloadJson, now, waiter.runId, waiter.stepKey);
    }
    return waiters.map((w) => w.runId);
  }

  // Full inspectable snapshot for evidence capture.
  snapshot(runId: string): {
    run: RunRecord | null;
    steps: StepRecord[];
    sleeps: SleepRecord[];
    waiters: EventWaiterRecord[];
  } {
    return {
      run: this.getRun(runId),
      steps: this.listSteps(runId),
      sleeps: this.db
        .query("SELECT * FROM sleeps WHERE runId = ? ORDER BY createdAt")
        .all(runId) as SleepRecord[],
      waiters: this.db
        .query("SELECT * FROM event_waiters WHERE runId = ? ORDER BY createdAt")
        .all(runId) as EventWaiterRecord[],
    };
  }

  close(): void {
    this.db.close();
  }
}
