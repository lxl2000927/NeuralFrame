import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
);
export default defineConfig({
  root: "ui",
  base: "./",
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  build: { outDir: "../src/ui-dist", emptyOutDir: true },
});
