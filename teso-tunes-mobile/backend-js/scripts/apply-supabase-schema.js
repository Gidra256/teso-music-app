import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import pg from "pg";

const { Client } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, "..");

const databaseUrl = process.env.DATABASE_URL || "";
const migrationPath =
  process.env.SUPABASE_SCHEMA_PATH ||
  path.join(backendRoot, "migrations", "001_supabase_initial.sql");

if (!databaseUrl) {
  console.error("Set DATABASE_URL before applying the Supabase schema.");
  process.exit(1);
}

async function main() {
  const sql = await fs.readFile(migrationPath, "utf8");
  const client = new Client({
    connectionString: databaseUrl,
    ssl: !/localhost|127\.0\.0\.1/.test(databaseUrl) ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();
  try {
    await client.query(sql);
    console.log(
      JSON.stringify(
        {
          applied: true,
          migrationPath,
          finishedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
