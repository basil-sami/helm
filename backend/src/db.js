import pg from "pg";

// Cached pool. On Vercel/serverless, reuse across invocations via globalThis
// so we don't exhaust Supabase connections. Tests can inject a client.
let _pool = globalThis.__PULSE_POOL__ || null;

function pool() {
  if (_pool) return _pool;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  // Supabase requires SSL. Set PGSSL=disable only for a local trusted Postgres.
  const ssl = process.env.PGSSL === "disable" ? false : { rejectUnauthorized: false };
  _pool = new pg.Pool({ connectionString, ssl, max: 3 });
  globalThis.__PULSE_POOL__ = _pool;
  return _pool;
}

// In tests we set globalThis.__PULSE_DB_CLIENT__ to an embedded Postgres (PGlite).
function client() {
  return globalThis.__PULSE_DB_CLIENT__ || pool();
}

export async function query(text, params = []) {
  return client().query(text, params.map((v) => (v === undefined ? null : v)));
}
export async function all(text, params = []) {
  return (await query(text, params)).rows;
}
export async function get(text, params = []) {
  return (await query(text, params)).rows[0] || null;
}
export async function run(text, params = []) {
  return query(text, params);
}

export async function transaction(fn) {
  const base = client();
  const connection = typeof base.connect === "function" ? await base.connect() : base;
  const txQuery = (text, params = []) => connection.query(text, params.map((v) => (v === undefined ? null : v)));
  const tx = {
    query: txQuery,
    all: async (text, params = []) => (await txQuery(text, params)).rows,
    get: async (text, params = []) => (await txQuery(text, params)).rows[0] || null,
    run: txQuery,
  };
  try {
    await txQuery("BEGIN");
    const result = await fn(tx);
    await txQuery("COMMIT");
    return result;
  } catch (e) {
    await txQuery("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    connection.release?.();
  }
}

export const now = () => new Date().toISOString();
