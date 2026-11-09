export type Sql = {
  query<T = Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<{ rows: T[] }>;
};

export type SqlDatabase = {
  transaction<T>(fn: (sql: Sql) => Promise<T>): Promise<T>;
};

type Queryable = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
};

/** Adapts PGlite, or any client with the same transaction shape, without importing a driver. */
export function pgliteDatabase(db: {
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
}): SqlDatabase {
  return {
    transaction(fn) {
      return db.transaction(async (tx) =>
        fn({
          query: async <T = Record<string, unknown>>(text: string, params: readonly unknown[] = []) => {
            const result = await tx.query(text, [...params]);
            return { rows: result.rows as T[] };
          },
        }),
      );
    },
  };
}

type PostgresJs = {
  begin<T>(fn: (tx: PostgresJs) => Promise<T>): Promise<T>;
  unsafe(query: string, parameters: unknown[]): Promise<Record<string, unknown>[]>;
};

/** Adapts the `postgres` driver used by the Edge Function. The package does not import that driver. */
export function fromPostgresJs(sql: PostgresJs): SqlDatabase {
  return {
    transaction(fn) {
      return sql.begin((tx) =>
        fn({
          query: async <T = Record<string, unknown>>(text: string, params: readonly unknown[] = []) => {
            const rows = await tx.unsafe(text, [...params]);
            return { rows: rows as T[] };
          },
        }),
      );
    },
  };
}
