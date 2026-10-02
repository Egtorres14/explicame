import { defineConfig } from "tsup";

export default defineConfig({
  entry: { bin: "src/bin.ts" },
  format: ["esm"],
  platform: "node",
  target: "node20",
  clean: true,
  noExternal: ["@explicame/core"],
  banner: { js: "#!/usr/bin/env node" },
});
