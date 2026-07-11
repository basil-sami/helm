// Applies supabase/schema.sql (and optionally seed.sql) to DATABASE_URL.
// Usage:
//   node scripts/apply-db.js          # schema only
//   node scripts/apply-db.js --seed   # schema + seed
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../..");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL is not set."); process.exit(1); }
  const ssl = process.env.PGSSL === "disable" ? false : { rejectUnauthorized: false };
  const client = new pg.Client({ connectionString: url, ssl });
  await client.connect();

  const schema = fs.readFileSync(path.join(root, "supabase", "schema.sql"), "utf8");
  console.log("Applying schema…");
  await client.query(schema);

  if (process.argv.includes("--seed")) {
    const seed = fs.readFileSync(path.join(root, "supabase", "seed.sql"), "utf8");
    console.log("Seeding demo data…");
    await client.query(seed);
  }

  await client.end();
  console.log("✅ Done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
