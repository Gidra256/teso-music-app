const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
module.exports = async function serve(directory) {
  const root = path.resolve(directory);
  const types = { ".html": "text/html", ".js": "application/javascript", ".png": "image/png", ".ttf": "font/ttf", ".webmanifest": "application/manifest+json" };
  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    let file = path.resolve(root, `.${decodeURIComponent(pathname)}`);
    if (!file.startsWith(root + path.sep)) file = path.join(root, "index.html");
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, "index.html");
    res.setHeader("Content-Type", types[path.extname(file)] || "application/octet-stream");
    res.setHeader("Cache-Control", "no-store");
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  return { server, url: `http://127.0.0.1:${server.address().port}` };
};
if (require.main === module) module.exports(process.argv[2]).then(({ url }) => console.log(url));
