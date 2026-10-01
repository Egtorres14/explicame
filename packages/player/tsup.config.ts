import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { "explicame-player": "src/global.ts" },
    format: ["iife"],
    platform: "browser",
    target: "es2020",
    minify: true,
    clean: true,
    noExternal: [/^@explicame\/core/],
    outExtension: () => ({ js: ".js" }),
  },
  {
    entry: { index: "src/index.ts" },
    format: ["esm"],
    platform: "browser",
    target: "es2020",
    noExternal: [/^@explicame\/core/],
  },
]);
