import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const { version } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
);
export default defineConfig({
  root: "ui",
  base: "./",
  plugins: [react()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  build: {
    outDir: "../src/ui-dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL("./ui/index.html", import.meta.url)),
        overlaySurface: fileURLToPath(new URL("./src/renderer/overlay-surface.js", import.meta.url)),
        overlayPreview: fileURLToPath(
          new URL("./ui/overlay-preview.html", import.meta.url),
        ),
      },
      output: { entryFileNames: chunk => chunk.name === "overlaySurface" ? "overlay-surface.js" : "assets/[name]-[hash].js" },
    },
  },
});
