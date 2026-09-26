import { defineConfig } from "vitest/config";

/**
 * Stage 2B test configuration.
 *
 * Tests import the TypeScript sources directly (not `dist/`), so `npm test` works
 * without a prior build. The suite is fully offline: no test spawns a real
 * OpenCode process, opens a socket, or touches the AI Teacher application.
 */
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // The real-CLI smoke test is a separate manual command (`npm run opencode-ping`).
    // Nothing in the automated suite spawns a real process.
    testTimeout: 20_000,
    reporters: ["default"],
  },
});
