/**
 * A D1 stand-in for tests, backed by SQLite itself. The point is not to imitate Cloudflare's
 * network behaviour but its guarantees: one statement at a time over a real engine, and a
 * `batch` that either lands whole or not at all. Concurrency tests are only worth writing
 * against the second property, because that is the one the idempotency key leans on.
 */
import { DatabaseSync } from 'node:sqlite';
import type { D1Database, D1PreparedStatement, D1Result } from '../env';

type Param = null | number | bigint | string | Uint8Array;

class SqliteStatement implements D1PreparedStatement {
  readonly db: DatabaseSync;
  readonly sql: string;
  readonly params: Param[];

  constructor(db: DatabaseSync, sql: string, params: Param[] = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }

  bind(...values: unknown[]): D1PreparedStatement {
    return new SqliteStatement(this.db, this.sql, values as Param[]);
  }

  /** The synchronous body of `run`, so `batch` can call it inside one transaction. */
  execute(): unknown {
    return this.db.prepare(this.sql).run(...this.params);
  }

  async first<T = unknown>(column?: string): Promise<T | null> {
    const row = this.db.prepare(this.sql).get(...this.params) as Record<string, unknown> | undefined;
    if (!row) return null;
    return (column ? row[column] : row) as T;
  }

  async all<T = unknown>(): Promise<D1Result<T>> {
    const results = this.db.prepare(this.sql).all(...this.params) as T[];
    return { results, success: true };
  }

  async run(): Promise<unknown> {
    return this.execute();
  }
}

export class SqliteD1 implements D1Database {
  private readonly db: DatabaseSync;
  /** When set, the next batch rolls back instead of committing, to model a crash mid-write. */
  failNextBatch: Error | null = null;

  constructor(location = ':memory:') {
    this.db = new DatabaseSync(location);
    this.db.exec('PRAGMA journal_mode = MEMORY');
  }

  prepare(sql: string): D1PreparedStatement {
    return new SqliteStatement(this.db, sql);
  }

  async batch(statements: D1PreparedStatement[]): Promise<unknown[]> {
    const failure = this.failNextBatch;
    this.failNextBatch = null;

    this.db.exec('BEGIN IMMEDIATE');
    try {
      const results: unknown[] = [];
      for (const statement of statements) {
        results.push((statement as SqliteStatement).execute());
        if (failure) throw failure;
      }
      this.db.exec('COMMIT');
      return results;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  async exec(sql: string): Promise<unknown> {
    this.db.exec(sql);
    return undefined;
  }

  close(): void {
    this.db.close();
  }
}

export function openTestDb(): { db: SqliteD1; env: { DB: D1Database } } {
  const db = new SqliteD1();
  return { db, env: { DB: db } };
}
