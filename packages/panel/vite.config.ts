import { defineConfig } from "vite";

// Relative asset URLs: the CLI serves the panel from the root of its own local server.
export default defineConfig({ base: "./", build: { outDir: "dist", emptyOutDir: true } });
