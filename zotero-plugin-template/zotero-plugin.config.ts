import pkg from "./package.json";

// 注意：不 import "zotero-plugin-scaffold" 的 defineConfig（它只是恒等函数）。
// c12/jiti 在部分 Node 版本上解析 ESM-only 包（scaffold 的 exports 只有 import 条件）会报
// 'No "exports" main defined'，纯对象导出可绕过，行为完全一致。
export default {
  source: ["src", "addon"],
  dist: ".scaffold/build",
  name: pkg.config.addonName,
  id: pkg.config.addonID,
  namespace: pkg.config.addonRef,
  xpiName: "paperflow-connector-v1.0.0",
  updateURL: "https://raw.githubusercontent.com/AaronGIG/pdf2zh-desktop/main/updates.json",
  xpiDownloadLink:
    "https://github.com/AaronGIG/pdf2zh-desktop/releases/download/v{{version}}/{{xpiName}}.xpi",

  build: {
    assets: ["addon/**/*.*"],
    define: {
      ...pkg.config,
      author: pkg.author,
      description: pkg.description,
      homepage: pkg.homepage,
      buildVersion: pkg.version,
      buildTime: "{{buildTime}}",
    },
    prefs: {
      prefix: pkg.config.prefsPrefix,
    },
    esbuildOptions: [
      {
        entryPoints: ["src/index.ts"],
        define: {
          __env__: `"${process.env.NODE_ENV}"`,
        },
        bundle: true,
        target: "firefox115",
        outfile: `.scaffold/build/addon/content/scripts/${pkg.config.addonRef}.js`,
      },
    ],
  },

  test: {
    waitForPlugin: `() => Zotero.${pkg.config.addonInstance}.data.initialized`,
  },
};
