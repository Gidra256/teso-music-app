const assert = require("node:assert/strict");
const fs = require("node:fs");
const crypto = require("node:crypto");
const { execFileSync, spawn } = require("node:child_process");

const repo = "Gidra256/teso-music-app";
const tag = "tesohub-music-android-v1.0.6";
const name = "TesoHub-Music-Android-v1.0.6.apk";
const source = "C:/Users/HP/Downloads/application-7d0ae182-fb29-47a0-8297-c548f30f7276.apk";
const sha256 = "26c5a12153a6e761a62063832b1334df948a0a832e20ae327bf3eb7903a9b0b0";
const commit = "b91986e119467e2fd4bbde2fa49008d7e93fd320";
const notes = `TesoHub Music - Android Early Access

Listen to Teso music, discover artists, build playlists and share the music you love.

This is an Early Access release. Features and performance are still being improved.

Installation:
1. Download the APK below.
2. Android may ask permission to install apps from your browser or files app.
3. Install TesoHub Music.
4. Future JavaScript updates may be delivered automatically through the app.

This is a direct Android APK download, not a Google Play installation.

APK SHA-256: \`${sha256}\`
`;

(async () => {
  const assembled = process.argv.includes("--publish-assembled");
  assert.ok(process.argv.includes("--publish") || assembled, "Explicit publication argument required");
  const bytes = fs.readFileSync(source);
  assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), sha256);
  const credential = execFileSync("git", ["credential", "fill"], {
    input: "protocol=https\nhost=github.com\n\n", encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "Never" }, stdio: ["pipe", "pipe", "pipe"],
  });
  const token = credential.split(/\r?\n/).find(line => line.startsWith("password="))?.slice(9);
  assert.ok(token, "GitHub authentication unavailable");
  async function api(path, method = "GET", body, allowMissing = false) {
    for (let attempt = 0; ; attempt++) {
      try {
    const response = await fetch(`https://api.github.com/repos/${repo}${path}`, {
      method, headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json", Connection: "close" },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(60000),
    });
    if (allowMissing && response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub ${method} ${path}: HTTP ${response.status}`);
    return response.status === 204 ? null : response.json();
      } catch (error) {
        if (method === "POST" || attempt >= 4) throw error;
        console.log(`Retrying GitHub ${method} after a connection interruption`);
        await new Promise(resolve => setTimeout(resolve, 5000 * (attempt + 1)));
      }
    }
  }
  assert.equal((await api("")).private, false, "Repository must already be public");
  assert.equal((await api(`/commits/${commit}`)).sha, commit);
  let release = await api(`/releases/tags/${tag}`, "GET", undefined, true);
  if (!release) release = (await api("/releases?per_page=100")).find(item => item.tag_name === tag);
  if (!release) release = await api("/releases", "POST", {
    tag_name: tag, target_commitish: commit, name: "TesoHub Music Android - Early Access v1.0.6",
    body: notes, draft: true, prerelease: true, make_latest: "false",
  });
  const assets = await api(`/releases/${release.id}/assets?per_page=100`);
  let asset = assets.find(item => item.name === name);
  if (assembled) assert.ok(asset, "GitHub assembly must finish before publication");
  if (!asset) {
    const destination = new URL(release.upload_url.split("{")[0]);
    assert.equal(destination.origin, "https://uploads.github.com");
    destination.searchParams.set("name", name);
    console.log("Uploading verified existing APK to the approved GitHub release");
    asset = await new Promise((resolve, reject) => {
      // Keep credentials in stdin, never shell arguments, files or output.
      const child = spawn("curl.exe", ["--config", "-", "--show-error", "--http1.1", "--connect-timeout", "20", "--max-time", "3600", "--speed-limit", "1024", "--speed-time", "90", "--request", "POST", "--data-binary", `@${source}`, "--url", destination.href, "--write-out", "\n%{http_code} %{size_upload} %{speed_upload}"], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
      let output = "", errorOutput = "", lastProgress = 0;
      child.stdout.on("data", data => { output += data; });
      child.stderr.on("data", data => {
        errorOutput += data;
        const line = errorOutput.split(/[\r\n]/).filter(line => /^\s*\d/.test(line) && line.trim().split(/\s+/).length >= 12).at(-1);
        if (line && Date.now() - lastProgress > 30000) { console.log(`Upload transfer: ${line.trim()}`); lastProgress = Date.now(); }
      });
      child.on("error", reject);
      child.on("close", code => {
        const separator = output.lastIndexOf("\n");
        const transfer = output.slice(separator + 1).trim().split(" ");
        if (code) return reject(new Error(`APK upload curl ${code}; sent ${transfer[1]} bytes at ${transfer[2]} bytes/sec: ${errorOutput.split(/[\r\n]/).filter(line => line.startsWith("curl:")).join(" ").replaceAll(token, "[redacted]")}`));
        if (transfer[0] !== "201") return reject(new Error(`GitHub APK upload: HTTP ${transfer[0]}`));
        try { resolve(JSON.parse(output.slice(0, separator))); } catch { reject(new Error("Invalid upload response")); }
      });
      child.stdin.end(`header = "Authorization: Bearer ${token}"\nheader = "Content-Type: application/vnd.android.package-archive"\n`);
    });
  }
  assert.equal(asset.size, bytes.length);
  console.log("APK uploaded; verifying asset metadata and publishing the Early Access release");
  if (asset.digest) assert.equal(asset.digest, `sha256:${sha256}`);
  if (assembled) {
    assert.equal(asset.digest, `sha256:${sha256}`);
    for (const part of assets.filter(item => /^tesohub-v1\.0\.6-transfer-part-\d{3}\.bin$/.test(item.name))) {
      const index = Number(part.name.match(/(\d{3})\.bin$/)[1]);
      assert.ok(index < Math.ceil(bytes.length / 1048576));
      const original = bytes.subarray(index * 1048576, Math.min(bytes.length, (index + 1) * 1048576));
      assert.equal(part.size, original.length);
      assert.equal(part.digest, `sha256:${crypto.createHash("sha256").update(original).digest("hex")}`);
      await api(`/releases/assets/${part.id}`, "DELETE", undefined, true);
    }
    console.log("Verified transport parts removed; only the complete APK is being published");
  }
  if (release.draft) release = await api(`/releases/${release.id}`, "PATCH", { draft: false, name: "TesoHub Music Android \u2014 Early Access v1.0.6" });
  console.log("Verifying public download without GitHub authentication");
  // Intentionally no Authorization header or cookies for the public download gate.
  const download = await fetch(asset.browser_download_url, { signal: AbortSignal.timeout(3600000) });
  assert.equal(download.status, 200, "Anonymous APK download must succeed");
  assert.ok(!/text\/html/i.test(download.headers.get("content-type") || ""));
  const hash = crypto.createHash("sha256");
  let size = 0, signature = Buffer.alloc(0), lastDownloadProgress = 0;
  for await (const chunk of download.body) {
    if (signature.length < 4) signature = Buffer.concat([signature, Buffer.from(chunk)]).subarray(0, 4);
    size += chunk.length; hash.update(chunk);
    if (Date.now() - lastDownloadProgress > 30000) { console.log(`Anonymous APK checksum verification: ${Math.floor(size / bytes.length * 100)}% downloaded`); lastDownloadProgress = Date.now(); }
  }
  assert.equal(signature.toString("hex"), "504b0304");
  assert.equal(size, bytes.length);
  assert.equal(hash.digest("hex"), sha256);
  console.log(JSON.stringify({ tag, release: release.html_url, url: asset.browser_download_url, name, size, sha256, anonymousDownload: "PASS HTTP 200, APK bytes and SHA-256 match", originalBuildCommit: commit }, null, 2));
})().catch(error => { console.error(error.code === "ERR_ASSERTION" ? error.message : error.code || error.cause?.code ? `Release failed: ${error.code || error.cause?.code}` : error.message); process.exitCode = 1; });
