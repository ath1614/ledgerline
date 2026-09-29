/**
 * The slice of the Cloudflare Workers runtime this service touches. Declaring it here keeps
 * the browser build free of workers-types globals, which clash with DOM types under Vite.
 */

export interface D1Result<T> {
  results: T[];
  success: boolean;
  meta?: unknown;
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(column?: string): Promise<T | null>;
  all<T = unknown>(): Promise<D1Result<T>>;
  run(): Promise<unknown>;
}

export interface D1Database {
  prepare(sql: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown[]>;
  exec(sql: string): Promise<unknown>;
}

export interface Env {
  DB: D1Database;
  ASSETS: { fetch(input: Request | string): Promise<Response> };
  APP_ORIGIN?: string;
}

export interface EventRow {
  id: string;
  type: string;
  merchant_id: string;
  currency: string;
  amount: number;
  fee: number;
  occurred_at: number;
  card: string | null;
}

export interface EntryRow {
  id: string;
  event_id: string;
  merchant_id: string;
  currency: string;
  occurred_at: number;
  memo: string;
}

export interface PostingRow {
  entry_id: string;
  account: string;
  side: string;
  amount: number;
  position: number;
}
