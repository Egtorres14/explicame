import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const src = (path: string) => fileURLToPath(new URL(`./packages/core/src/${path}`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@explicame\/core$/, replacement: src("index.ts") },
      { find: /^@explicame\/core\/runtime$/, replacement: src("domRuntimeImpl.js") },
      { find: /^@explicame\/core\/safety$/, replacement: src("safety.ts") },
    ],
  },
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
