import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");

const remoteBaseUrl = (process.env.RENDER_BASE_URL || "https://teso-music-app.onrender.com").replace(
  /\/+$/,
  "",
);
const adminUsername = process.env.ADMIN_USERNAME || "admin";
const adminPassword = process.env.ADMIN_PASSWORD || "";
const includeSensitive = process.env.INCLUDE_SENSITIVE_HASHES === "true";

if (!adminPassword) {
  console.error("Set ADMIN_PASSWORD before exporting live persistence.");
  process.exit(1);
}

async function request(pathname, options = {}) {
  const response = await fetch(`${remoteBaseUrl}${pathname}`, options);
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(`${options.method || "GET"} ${pathname} failed: ${response.status} ${text}`);
  }
  return data;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function main() {
  const login = await request("/admin-api/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ username: adminUsername, password: adminPassword }),
  });
  const exportPath = includeSensitive
    ? "/admin-api/persistence-export?include_sensitive=true&confirm=EXPORT%20RAW%20HASHES"
    : "/admin-api/persistence-export";
  const exported = await request(exportPath, {
    headers: { authorization: `Bearer ${login.token}` },
  });
  const backupDir = path.join(repoRoot, "backups", `render-export-${timestamp()}`);
  await fs.mkdir(backupDir, { recursive: true });
  await fs.writeFile(
    path.join(backupDir, "persistence-export.json"),
    `${JSON.stringify(exported, null, 2)}\n`,
  );
  await fs.writeFile(
    path.join(backupDir, "db.json"),
    `${JSON.stringify(exported.db, null, 2)}\n`,
  );
  await fs.writeFile(
    path.join(backupDir, "README.txt"),
    [
      `Render persistence export from ${remoteBaseUrl}`,
      `Exported at: ${exported.exported_at}`,
      `Includes sensitive hashes: ${exported.includes_sensitive_hashes}`,
      "",
      "Use db.json as LEGACY_DB_PATH for scripts/migrate-json-to-supabase.js.",
      "Keep this folder private. It can include account/session hashes when INCLUDE_SENSITIVE_HASHES=true.",
      "",
    ].join("\n"),
  );
  console.log(
    JSON.stringify(
      {
        backupDir,
        exported_at: exported.exported_at,
        includes_sensitive_hashes: exported.includes_sensitive_hashes,
        remoteBaseUrl,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
