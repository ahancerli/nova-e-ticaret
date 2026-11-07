import { UnitOfWork, type Clock, type Database, type IdGenerator } from "@/core";
import type { AuditLog } from "@/modules/audit/audit-log";
import type { ProductActor } from "@/modules/catalog";
import { BULK_OPS, type BulkOp, type MatchKey, type RawRow, type RowResult } from "../domain/bulk";
import { BulkErrors } from "../domain/errors";
import type { BulkJob, BulkJobRepository, JobCounts } from "./ports";
import type { RowEngine } from "./row-engine";

export interface BulkDeps {
  db: Database;
  jobs: BulkJobRepository;
  engine: RowEngine;
  audit: AuditLog;
  clock: Clock;
  ids: IdGenerator;
}

export interface BulkRowsInput {
  op: BulkOp;
  matchKey: MatchKey;
  imageMode: "replace" | "append";
  rows: RawRow[];
}

/** Counts + error samples of a chunk's results (job history). */
export function countsOf(results: RowResult[]): JobCounts {
  return {
    created: results.filter((r) => r.status === "created").length,
    updated: results.filter((r) => r.status === "updated").length,
    skipped: results.filter((r) => r.status === "unchanged").length,
    errors: results.filter((r) => r.status === "error").length,
    errorSamples: results.filter((r) => r.status === "error").map((r) => ({ line: r.line, key: r.key, message: r.messages.join(" ") })),
  };
}

/** Query: check rows without writing (step 1 of an import; the browser sends the file in chunks). */
export class CheckBulkRows {
  constructor(private readonly engine: RowEngine) {}

  execute(input: BulkRowsInput, actor: ProductActor): Promise<RowResult[]> {
    return this.engine.run(input.rows, { op: input.op, matchKey: BULK_OPS[input.op].needsKey ? input.matchKey : null, actor, apply: false, imageMode: input.imageMode });
  }
}

/**
 * Command: write one chunk of an import (step 2). The first chunk opens a job (history + one audit entry for the
 * whole import); each product change is also audited by the product save use case. `final` closes the job.
 */
export class ApplyBulkRows {
  constructor(private readonly deps: BulkDeps) {}

  async execute(input: BulkRowsInput & { jobId: string | null; source: string; totalRows: number; final: boolean; rejected?: BulkJob["errors"]; rejectedCount?: number }, actor: ProductActor): Promise<{ jobId: string; results: RowResult[] }> {
    const { jobs, clock } = this.deps;
    const kind = BULK_OPS[input.op].job as BulkJob["kind"];
    let jobId = input.jobId;
    if (jobId) {
      const job = await jobs.get(jobId);
      if (!job || job.kind !== kind || job.status !== "running" || job.createdBy !== actor.userId) throw BulkErrors.jobNotFound();
    } else {
      jobId = this.deps.ids.newId();
      await new UnitOfWork(this.deps.db)
        .add(jobs.insertStatement({ id: jobId, kind, source: input.source, feedId: null, matchKey: BULK_OPS[input.op].needsKey ? input.matchKey : null, totalRows: input.totalRows, createdBy: actor.userId, now: clock.nowIso() }))
        .add(this.deps.audit.recordStatement({ actor, action: `bulk.${input.op}`, entityType: "bulk_job", entityId: jobId, diff: { source: input.source, rows: input.totalRows, matchKey: input.matchKey } }))
        .commit();
    }
    const results = !input.rows.length ? [] : await this.deps.engine.run(input.rows, {
      op: input.op, matchKey: BULK_OPS[input.op].needsKey ? input.matchKey : null, actor, apply: true, imageMode: input.imageMode,
    });
    const counts = countsOf(results);
    if (!input.jobId && input.rejectedCount) {
      counts.errors += input.rejectedCount;
      counts.errorSamples = [...(input.rejected ?? []), ...counts.errorSamples];
    }
    await jobs.addCounts(jobId, counts, clock.nowIso());
    if (input.final) await jobs.finish(jobId, "completed", clock.nowIso());
    return { jobId, results };
  }
}

/** Query: recent imports and feed runs. */
export class ListBulkJobs {
  constructor(private readonly jobs: BulkJobRepository) {}
  execute(): Promise<BulkJob[]> {
    return this.jobs.list(100);
  }
}
