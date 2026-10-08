import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { test } from "node:test";

const html = fs.readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const source = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function adminHarness(respond) {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) elements.set(id, {
      textContent: "", innerHTML: "", classList: { add() {}, remove() {}, toggle() {} },
      addEventListener() {},
    });
    return elements.get(id);
  }
  let token = "test-admin-session";
  const ctx = vm.createContext({
    document: {
      getElementById: element, querySelector: element, querySelectorAll: () => [],
      addEventListener() {},
    },
    localStorage: { getItem: () => token, removeItem: () => { token = ""; } },
    requestAnimationFrame: fn => fn(), setInterval() {}, FormData, AbortSignal,
    fetch: async (path, options) => {
      const result = await respond(path, options);
      return {
        ok: (result.status || 200) < 400, status: result.status || 200,
        text: async () => result.raw ?? JSON.stringify(result.body),
      };
    },
  });
  // Start explicitly so tests can observe the initial loading state.
  vm.runInContext(source.slice(0, source.lastIndexOf("      if (state.token) {")), ctx);
  return {
    run: code => vm.runInContext(code, ctx),
    view: () => element("view").innerHTML,
    savedToken: () => token,
  };
}

const identity = { admin: { username: "admin", role: "super_admin", permissions: ["*"] } };
const pending = { id: 1, listener: 6, artist_name: "Test Applicant", status: "pending" };
function bodyFor(path) {
  if (path === "/admin-api/me") return identity;
  if (path === "/admin-api/dashboard") return { pending_artist_applications: 1 };
  if (path === "/admin-api/artist-applications") return [pending];
  if (path === "/admin-api/platform-health") return { backend_status: "ok", database: {} };
  if (["/admin-api/platform-settings", "/admin-api/feature-flags"].includes(path)) return {};
  return [];
}

test("startup loads only dashboard dependencies; rapid navigation keeps one read in flight", async () => {
  const calls = [];
  let active = 0;
  let peak = 0;
  const admin = adminHarness(async path => {
    calls.push(path); peak = Math.max(peak, ++active);
    await new Promise(resolve => setImmediate(resolve));
    active--;
    return { body: bodyFor(path) };
  });
  const startup = admin.run("loadData()");
  assert.match(admin.view(), /Loading Dashboard/);
  await startup;
  assert.deepEqual(calls, ["/admin-api/me", "/admin-api/dashboard", "/admin-api/platform-health"]);
  await admin.run(`Promise.all([loadView("catalog"), loadView("applications"), loadView("catalog")])`);
  assert.equal(peak, 1);
  assert.equal(calls.filter(path => path === "/admin-api/songs").length, 1);
  assert.equal(calls.filter(path => path === "/admin-api/artist-applications").length, 1);
});

test("application HTTP 500 displays an error instead of empty results; retry recovers", async () => {
  let fail = true;
  const admin = adminHarness(async path => path === "/admin-api/artist-applications" && fail
    ? { status: 500, body: { detail: "Something went wrong." } }
    : { body: bodyFor(path) });
  await admin.run("loadData()");
  await admin.run('state.activeView = "applications"; loadView("applications")');
  assert.match(admin.view(), /Could not load Artist Applications/);
  assert.doesNotMatch(admin.view(), /No artist applications match/);
  assert.doesNotMatch(admin.view(), /<button[^>]+disabled/);
  assert.ok(admin.savedToken());
  fail = false;
  await admin.run('handleAction("retry-data", { dataset: {} })');
  assert.match(admin.view(), /Test Applicant/);
  assert.match(admin.view(), /pending/);
});

test("only a successful empty array displays the empty applications message", async () => {
  const admin = adminHarness(async path => ({ body: path === "/admin-api/artist-applications" ? [] : bodyFor(path) }));
  await admin.run("loadData()");
  await admin.run('state.activeView = "applications"; loadView("applications")');
  assert.match(admin.view(), /No artist applications match this filter/);
  assert.doesNotMatch(admin.view(), /Could not load/);
});

test("invalid data and HTML error responses cannot become empty application results", async () => {
  for (const response of [{ body: { results: [pending] } }, { status: 502, raw: "<html>Bad Gateway</html>" }]) {
    const admin = adminHarness(async path => path === "/admin-api/artist-applications" ? response : { body: bodyFor(path) });
    await admin.run("loadData()");
    await admin.run('state.activeView = "applications"; loadView("applications")');
    assert.match(admin.view(), /Could not load Artist Applications/);
    assert.doesNotMatch(admin.view(), /No artist applications match/);
  }
});

test("failed settings never render a form with fallback values", async () => {
  const admin = adminHarness(async path => path === "/admin-api/platform-settings"
    ? { status: 500, body: { detail: "Unavailable" } } : { body: bodyFor(path) });
  await admin.run("loadData()");
  await admin.run('state.activeView = "settings"; loadView("settings")');
  assert.match(admin.view(), /Could not load Platform Settings/);
  assert.doesNotMatch(admin.view(), /settingsForm|Save Settings/);
});

test("identity 500 preserves the session and retry; confirmed 403 requires sign-in", async () => {
  for (const status of [500, 403]) {
    const admin = adminHarness(async () => ({ status, body: { detail: "Unavailable" } }));
    await admin.run("loadData()");
    if (status === 500) {
      assert.ok(admin.savedToken());
      assert.match(admin.view(), /Retry/);
      assert.doesNotMatch(admin.view(), /<button[^>]+disabled/);
    } else {
      assert.equal(admin.savedToken(), "");
      assert.equal(admin.run("state.token"), "");
    }
  }
});

test("permission failure in a section retains the authenticated session", async () => {
  const admin = adminHarness(async path => path === "/admin-api/artist-applications"
    ? { status: 403, body: { detail: "Forbidden" } } : { body: bodyFor(path) });
  await admin.run("loadData()");
  await admin.run('state.activeView = "applications"; loadView("applications")');
  assert.ok(admin.savedToken());
  assert.match(admin.view(), /does not have access/);
});

test("Support's own refresh uses the same error state and retry flow", async () => {
  let fail = false;
  const admin = adminHarness(async path => fail && path === "/admin-api/support/tickets"
    ? { status: 500, body: { detail: "Unavailable" } } : { body: bodyFor(path) });
  await admin.run("loadData()");
  await admin.run('state.activeView = "support"; loadView("support")');
  fail = true;
  await admin.run("refreshSupportTickets()");
  assert.match(admin.view(), /Could not load Support/);
  assert.doesNotMatch(admin.view(), /No support tickets/);
  fail = false;
  await admin.run('handleAction("retry-data", { dataset: {} })');
  assert.equal(admin.run("state.loads.supportTickets.status"), "ready");
  assert.doesNotMatch(admin.view(), /Could not load/);
});

test("refresh invalidates other views; old-session responses are ignored", async () => {
  let release;
  let hold = false;
  const admin = adminHarness(async path => {
    if (hold && path === "/admin-api/artist-applications") await new Promise(resolve => { release = resolve; });
    return { body: bodyFor(path) };
  });
  await admin.run("loadData()");
  await admin.run('loadView("applications")');
  await admin.run("loadData()");
  assert.equal(admin.run("state.loads.applications.status"), "idle");
  hold = true;
  const loading = admin.run('loadView("applications", { force: true })');
  await new Promise(resolve => setImmediate(resolve));
  admin.run('state.token = "different-session"; state.applications = []');
  release();
  await loading;
  assert.equal(admin.run("state.applications.length"), 0);
  assert.equal(admin.run("pendingLoads.size"), 0);
});
