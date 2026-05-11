import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./tests/setup.js"],
    // Unit + integration tests only. E2E lives under tests/e2e/ and is run
    // separately via `npm run test:e2e` (Playwright + web-ext).
    include: ["tests/**/*.test.js"],
    exclude: ["tests/e2e/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: [
        "background/**/*.js",
        "content/**/*.js",
        "sidebar/sidebar.js",
        "options/options.js",
      ],
      exclude: ["tests/**", "**/*.test.js", "**/*.config.js", "node_modules/**"],
      thresholds: {
        lines: 100,
        functions: 100,
        branches: 100,
        statements: 100,
      },
      reportOnFailure: true,
    },
  },
});
