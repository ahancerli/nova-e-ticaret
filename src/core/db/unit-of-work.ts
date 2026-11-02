import { AppError, ConflictError } from "../errors";
import type { Database, Statement } from "./database";

const GUARD_FAILED = /batch_guard_failed:(\d+)/;
const defaultConflict = () => new ConflictError("concurrent_modification", "Kayıt bu sırada değişti. Sayfayı yenileyip tekrar deneyin.");

/**
 * Unit of Work over one D1 batch (D1 runs a batch as a single transaction).
 *
 *   const uow = new UnitOfWork(db);
 *   uow.add(db.statement("UPDATE orders SET status = ? WHERE id = ? AND status = ?", to, id, from))
 *      .expectChanges(1, () => new ConflictError("order_changed", "Sipariş bu sırada güncellendi."));
 *   uow.add(db.statement("INSERT INTO order_events …"));
 *   await uow.commit();
 *
 * `expectChanges` appends a guard statement (schema: batch_guards + triggers) right after the last added
 * statement. If that statement did not touch exactly `n` rows the database aborts the WHOLE batch, so
 * nothing after a lost race is written — unlike checking `changes` after the batch has committed.
 * The abort message carries the guard number, so the error of exactly the guard that fired is thrown.
 */
export class UnitOfWork {
  private readonly statements: Statement[] = [];
  private readonly guards: { index: number; error: () => AppError }[] = [];
  private committed = false;

  constructor(private readonly db: Database) {}

  get size(): number {
    return this.statements.length;
  }

  /** Adds statements in execution order. */
  add(...statements: Statement[]): this {
    this.assertOpen();
    this.statements.push(...statements);
    return this;
  }

  /** Requires the most recently added statement to change exactly `n` rows, else the batch is rolled back. */
  expectChanges(n: number, error: () => AppError = defaultConflict): this {
    this.assertOpen();
    if (!this.statements.length) throw new Error("expectChanges() needs a statement before it");
    const guard = this.guards.length;
    this.guards.push({ index: this.statements.length, error });
    this.statements.push(this.db.statement("INSERT INTO batch_guards (guard, actual, expected) VALUES (?, changes(), ?)", guard, n));
    return this;
  }

  /** Executes everything atomically. Returns the results of the caller's statements (guard rows removed). */
  async commit(): Promise<D1Result[]> {
    this.assertOpen();
    this.committed = true;
    if (!this.statements.length) return [];
    try {
      const results = await this.db.batch(this.statements);
      const guardIdx = new Set(this.guards.map((g) => g.index));
      return results.filter((_, i) => !guardIdx.has(i));
    } catch (err) {
      const hit = GUARD_FAILED.exec(err instanceof Error ? err.message : String(err));
      if (hit) throw (this.guards[Number(hit[1])]?.error ?? defaultConflict)();
      throw err;
    }
  }

  private assertOpen() {
    if (this.committed) throw new Error("UnitOfWork already committed");
  }
}
