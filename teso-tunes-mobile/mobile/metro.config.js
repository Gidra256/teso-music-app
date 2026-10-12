const { transformSync } = require("@babel/core");
const { getDefaultConfig } = require("expo/metro-config");

const LEGACY_WEB_TARGET = { chrome: "55" };

function transformModule(module) {
  for (const output of module.output || []) {
    if (!output.type.startsWith("js/") || typeof output.data?.code !== "string") continue;

    const result = transformSync(output.data.code, {
      babelrc: false,
      comments: false,
      compact: true,
      configFile: false,
      filename: module.path,
      presets: [["@babel/preset-env", {
        bugfixes: true,
        modules: false,
        targets: LEGACY_WEB_TARGET,
        useBuiltIns: false,
      }]],
      sourceMaps: false,
      sourceType: "script",
    });

    if (result?.code) {
      output.data.code = result.code;
      output.data.lineCount = result.code.split(/\r\n|\r|\n/).length;
      output.data.map = [];
    }
  }
}

function transformLegacyWebSyntax({ graph, premodules }) {
  if (graph.transformOptions.platform !== "web") return premodules;

  premodules.forEach(transformModule);
  graph.dependencies.forEach(transformModule);

  return premodules;
}

module.exports = getDefaultConfig(__dirname, {
  unstable_beforeAssetSerializationPlugins: [transformLegacyWebSyntax],
});
