// Container entrypoint: ensure schema, seed once, then start the server.
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");
const ssl = process.env.PGSSL === "disable" ? false : { rejectUnauthorized: false };

async function waitForDb(url, tries = 30) {
  for (let i = 0; i < tries; i++) {
    const c = new pg.Client({ connectionString: url, ssl });
    try { await c.connect(); await c.end(); return; }
    catch { await new Promise((r) => setTimeout(r, 1000)); }
  }
  throw new Error("Database not reachable");
}

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }
await waitForDb(url);

const client = new pg.Client({ connectionString: url, ssl });
await client.connect();
await client.query(fs.readFileSync(path.join(root, "supabase", "schema.sql"), "utf8"));
const { rows } = await client.query("SELECT COUNT(*)::int AS n FROM users");
if (rows[0].n === 0) {
  console.log("Empty database — seeding demo data…");
  await client.query(fs.readFileSync(path.join(root, "supabase", "seed.sql"), "utf8"));
} else {
  console.log(`Database has ${rows[0].n} users — skipping seed.`);
}
await client.end();

await import("../src/index.js");
