const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("official support email is centralized and exposed by public support screens", () => {
  const contact = read("src/config/contact.js");
  const support = read("src/screens/SupportHomeScreen.js");
  const about = read("src/screens/AboutScreen.js");
  assert.match(contact, /SUPPORT_EMAIL = "support@tesohubmusic\.com"/);
  assert.match(contact, /mailto:\$\{SUPPORT_EMAIL\}/);
  for (const source of [support, about]) {
    assert.match(source, /SUPPORT_EMAIL/);
    assert.match(source, /supportEmailUrl\(\)/);
  }
});

test("Help Center API publishes the same official support address", () => {
  const server = read("../backend-js/server.js");
  assert.match(server, /email: "support@tesohubmusic\.com"/);
  assert.match(server, /email support@tesohubmusic\.com/);
});
