import { defineConfig } from "vite";
import { createHash } from "node:crypto";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { localApi } from "./server/api";
export default defineConfig({
  cacheDir: process.env.UNIDESK_DEV_DB
    ? `node_modules/.vite-unidesk/${createHash("sha256").update(process.env.UNIDESK_DEV_DB).digest("hex").slice(0,16)}`
    : "node_modules/.vite",
  plugins: [react(), tailwindcss(), ...(process.env.UNIDESK_ANDROID_DEV ? [] : [localApi()])],
  clearScreen: false,
  server: {
    strictPort: true,
    watch: {
      ignored: ["**/.local/**", "**/src-tauri/target/**", "**/.dist/**"],
    },
  },
  build: { target: "es2022" },
});
