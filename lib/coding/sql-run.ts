// Runs SQL exercises on sql.js (SQLite compiled to WebAssembly). The sql.js module is handed in,
// so the same code runs in the browser worker and in the unit tests under Node.
import type { Database, SqlJsStatic } from "sql.js";

import { formatResultSets } from "./tests";
import type { QueryResult, RunError, SqlCell, SqlResultSet } from "./types";

const toCell = (value: unknown): SqlCell => {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "string") return value;
  if (value instanceof Uint8Array)
    return `x'${[...value].map((byte) => byte.toString(16).padStart(2, "0")).join("")}'`;
  return String(value);
};

const lineAt = (text: string, offset: number) => {
  let at = offset;
  // Skip spaces and comments before the statement, so the line is the statement's own.
  for (;;) {
    const rest = text.slice(at);
    const skip = /^(\s+|--[^\n]*\n?|\/\*[\s\S]*?\*\/)/.exec(rest);
    if (!skip || !skip[0]) break;
    at += skip[0].length;
  }
  return text.slice(0, at).split("\n").length;
};

const cleanMessage = (error: unknown) =>
  (error instanceof Error ? error.message : String(error)).replace(/^Error:\s*/, "");

/** Runs every statement of `sql`, keeping the result sets of those that return columns. */
export const execStatements = (
  db: Database,
  sql: string,
  onSet?: (set: SqlResultSet) => void
): { sets: SqlResultSet[]; error?: RunError } => {
  const sets: SqlResultSet[] = [];
  const iterator = db.iterateStatements(sql);
  for (;;) {
    const offset = sql.length - iterator.getRemainingSQL().length;
    let statement;
    try {
      const next = iterator.next();
      if (next.done) break;
      statement = next.value;
    } catch (error) {
      return { sets, error: { message: cleanMessage(error), line: lineAt(sql, offset) } };
    }
    try {
      const columns = statement.getColumnNames();
      const rows: SqlCell[][] = [];
      while (statement.step()) rows.push(statement.get().map(toCell));
      if (columns.length) {
        const set = { columns, rows };
        sets.push(set);
        onSet?.(set);
      }
    } catch (error) {
      return { sets, error: { message: cleanMessage(error), line: lineAt(sql, offset) } };
    } finally {
      statement.free();
    }
  }
  return { sets };
};

export type SqlRun = {
  output: string;
  sets: SqlResultSet[];
  error?: RunError;
  setupError?: string;
  queries: QueryResult[];
};

/**
 * A fresh in-memory database: the setup statements, then the learner's code, then each check
 * query. Errors in the setup or a check query are the author's, so they are reported apart.
 */
export const runSqlProgram = (
  SQL: SqlJsStatic,
  {
    setup,
    code,
    queries = [],
    onSet,
  }: {
    setup?: string;
    code: string;
    queries?: string[];
    onSet?: (set: SqlResultSet) => void;
  }
): SqlRun => {
  const db = new SQL.Database();
  try {
    if (setup) {
      const prepared = execStatements(db, setup);
      if (prepared.error)
        return {
          output: "",
          sets: [],
          setupError: `The exercise's setup failed on line ${prepared.error.line}: ${prepared.error.message}`,
          queries: [],
        };
    }
    const learner = execStatements(db, code, onSet);
    const results: QueryResult[] = learner.error
      ? []
      : queries.map((query) => {
          const ran = execStatements(db, query);
          return {
            sets: ran.sets,
            output: formatResultSets(ran.sets),
            error: ran.error ? ran.error.message : undefined,
          };
        });
    return {
      output: formatResultSets(learner.sets),
      sets: learner.sets,
      error: learner.error,
      queries: results,
    };
  } finally {
    db.close();
  }
};
