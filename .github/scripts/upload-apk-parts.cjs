const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = 'https://api.github.com/repos/Gidra256/teso-music-app';
const releaseId = 405581379;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

(async () => {
  assert.ok(process.argv.includes('--upload'), 'Explicit --upload required');
  const apk = fs.readFileSync('C:/Users/HP/Downloads/application-7d0ae182-fb29-47a0-8297-c548f30f7276.apk');
  assert.equal(hash(apk), '26c5a12153a6e761a62063832b1334df948a0a832e20ae327bf3eb7903a9b0b0');
  const credential = execFileSync('git', ['credential', 'fill'], { input: 'protocol=https\nhost=github.com\n\n', encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
  const token = credential.split(/\r?\n/).find(line => line.startsWith('password='))?.slice(9);
  assert.ok(token);
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' };
  async function api(path) {
    const r = await fetch(root + path, { headers, signal: AbortSignal.timeout(60000) });
    assert.ok(r.ok, `GitHub read HTTP ${r.status}`); return r.json();
  }
  const release = await api(`/releases/${releaseId}`);
  assert.equal(release.draft, true);
  assert.equal(release.tag_name, 'tesohub-music-android-v1.0.6');
  let assets = await api(`/releases/${releaseId}/assets?per_page=100`);
  const partSize = 1048576, total = Math.ceil(apk.length / partSize);
  let next = 0, complete = 0;
  async function worker() {
    while (next < total) {
      const index = next++;
      const name = `tesohub-v1.0.6-transfer-part-${String(index).padStart(3, '0')}.bin`;
      const bytes = apk.subarray(index * partSize, Math.min(apk.length, (index + 1) * partSize));
      const digest = `sha256:${hash(bytes)}`;
      let done = false;
      for (let attempt = 0; attempt < 3 && !done; attempt++) {
        try {
          if (attempt) assets = await api(`/releases/${releaseId}/assets?per_page=100`);
          const existing = assets.find(item => item.name === name);
          if (existing) {
            assert.equal(existing.size, bytes.length, `${name} size mismatch; do not overwrite`);
            assert.equal(existing.digest, digest, `${name} digest mismatch; do not overwrite`);
          } else {
            const url = new URL(release.upload_url.split('{')[0]);
            assert.equal(url.origin, 'https://uploads.github.com'); url.searchParams.set('name', name);
            const r = await fetch(url, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream' }, body: bytes, signal: AbortSignal.timeout(240000) });
            assert.equal(r.status, 201, `${name}: upload HTTP ${r.status}`);
            const item = await r.json(); assert.equal(item.size, bytes.length); assert.equal(item.digest, digest);
          }
          done = true; complete++;
          console.log(`Verified transport parts: ${complete}/${total} (part ${index})`);
        } catch (error) {
          if (attempt === 2) throw new Error(`${name} failed after retries (${error.code || error.cause?.code || error.message})`);
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }
    }
  }
  const results = await Promise.allSettled([worker(), worker(), worker()]);
  const failed = results.find(item => item.status === 'rejected');
  if (failed) throw failed.reason;
  assert.equal(complete, total);
  console.log('All original-byte parts verified in the existing draft release; ready for GitHub-side assembly.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
