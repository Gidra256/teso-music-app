const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const root = path.resolve(process.argv[2] || "public");
const description = "Discover Teso music, artists and new releases on TesoHub Music. Listen, follow your favorite artists, build playlists and explore music from the Teso community.";
const title = "TesoHub Music — Discover Teso Music &amp; Artists";

function read(name) {
  return fs.readFileSync(path.join(root, name), "utf8");
}

test("homepage metadata is static, canonical and indexable", () => {
  const html = read("index.html");
  assert.match(html, new RegExp(`<title>${title}</title>`));
  assert.match(html, new RegExp(`name="description"\\s+content="${description.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  assert.match(html, /name="robots" content="index,follow"/);
  assert.match(html, /rel="canonical" href="https:\/\/tesohubmusic\.com\/"/);
  assert.doesNotMatch(html, /noindex/i);
  assert.doesNotMatch(html, /onrender\.com/i);
});

test("Open Graph and WebSite structured data use supported project facts", () => {
  const html = read("index.html");
  assert.match(html, /property="og:type" content="website"/);
  assert.match(html, /property="og:site_name" content="TesoHub Music"/);
  assert.match(html, new RegExp(`property="og:title" content="${title}"`));
  assert.match(html, new RegExp(`property="og:description"\\s+content="${description.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  assert.match(html, /property="og:url" content="https:\/\/tesohubmusic\.com\/"/);
  const jsonLd = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(jsonLd, "Expected static JSON-LD in the document head");
  assert.deepEqual(JSON.parse(jsonLd[1]), {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "TesoHub Music",
    url: "https://tesohubmusic.com/",
  });
});

test("robots allows public crawling and protects private paths", () => {
  const robots = read("robots.txt");
  assert.match(robots, /^User-agent: \*$/m);
  assert.match(robots, /^Allow: \/$/m);
  for (const privatePath of ["/admin", "/admin-api", "/api", "/profile", "/settings", "/library", "/artist-studio", "/support/tickets"]) {
    assert.match(robots, new RegExp(`^Disallow: ${privatePath.replace("/", "\\/")}$`, "m"));
  }
  assert.match(robots, /^Sitemap: https:\/\/tesohubmusic\.com\/sitemap\.xml$/m);
  assert.doesNotMatch(robots, /Disallow: \/(?:_expo|assets|icons)/);
  assert.doesNotMatch(robots, /onrender\.com/i);
});

test("sitemap is valid, minimal and contains only the canonical homepage", () => {
  const sitemap = read("sitemap.xml");
  assert.match(sitemap, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(sitemap, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
  assert.deepEqual([...sitemap.matchAll(/<loc>(.*?)<\/loc>/g)].map((match) => match[1]), ["https://tesohubmusic.com/"]);
  assert.doesNotMatch(sitemap, /\/(?:admin|admin-api|api|profile|settings|library|artist-studio|support\/tickets)/);
  assert.doesNotMatch(sitemap, /onrender\.com/i);
  assert.match(sitemap, /<\/urlset>\s*$/);
});

if (root.endsWith(`${path.sep}dist`)) {
  test("production export retains PWA files", () => {
    assert.equal(fs.existsSync(path.join(root, "service-worker.js")), true);
    assert.equal(fs.existsSync(path.join(root, "manifest.webmanifest")), true);
  });
}
