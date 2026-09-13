import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: true,
    // Playwright E2E specs live outside Vitest's domain.
    exclude: ["**/node_modules/**", "**/dist/**", "**/e2e/**"],
  },
});
