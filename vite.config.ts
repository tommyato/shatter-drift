import { execSync } from "node:child_process";
import { resolve } from "path";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const BUILD_HASH = execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();

export default defineConfig({
  plugins: [viteSingleFile()],
  define: {
    __BUILD_HASH__: JSON.stringify(BUILD_HASH),
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  build: {
    target: "esnext",
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
  },
});
