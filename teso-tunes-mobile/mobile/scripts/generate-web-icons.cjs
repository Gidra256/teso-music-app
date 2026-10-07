// Derive correctly sized web install assets from the unchanged app logo.
const fs = require("node:fs/promises");
const path = require("node:path");
const { generateImageAsync } = require("@expo/image-utils");
(async () => {
  const projectRoot = path.resolve(__dirname, "..");
  for (const size of [192, 512]) {
    const { source } = await generateImageAsync({ projectRoot }, {
      src: path.join(projectRoot, "assets/images/tesohub-music.png"),
      width: size, height: size, resizeMode: "contain", backgroundColor: "#050506",
    });
    await fs.writeFile(path.join(projectRoot, `public/icons/tesohub-${size}.png`), source);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
