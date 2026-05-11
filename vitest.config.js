import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./tests/setup.js"],
    include: ["tests/**/*.test.js"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: [
        "background/**/*.js",
        "content/**/*.js",
        "sidebar/sidebar.js",
        "options/options.js",
      ],
      exclude: [
        "tests/**",
        "**/*.test.js",
        "**/*.config.js",
        "node_modules/**",
      ],
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
