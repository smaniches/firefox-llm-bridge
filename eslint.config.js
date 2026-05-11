/**
 * ESLint v9 flat config for Firefox LLM Bridge.
 *
 * Three environments:
 * - Extension code (background, content, sidebar, options): browser + WebExtension globals
 * - Tests (tests/**): Vitest globals + node
 * - Build/config files: node
 */

import js from "@eslint/js";
import globals from "globals";

const webExtGlobals = {
  browser: "readonly",
  chrome: "readonly",
};

export default [
  {
    ignores: ["node_modules/**", "coverage/**", "dist/**", "web-ext-artifacts/**"],
  },

  // Extension source code
  {
    files: ["background/**/*.js", "content/**/*.js", "sidebar/**/*.js", "options/**/*.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...webExtGlobals,
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" }],
      "no-console": ["warn", { allow: ["warn", "error", "info"] }],
      "no-implicit-globals": "error",
      eqeqeq: ["error", "smart"],
      "prefer-const": "error",
      "no-var": "error",
    },
  },

  // Tests
  {
    files: ["tests/**/*.js", "tests/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        ...globals.browser,
        ...globals.node,
        ...webExtGlobals,
        describe: "readonly",
        it: "readonly",
        test: "readonly",
        expect: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
        vi: "readonly",
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },

  // Build/config files (node context)
  {
    files: ["*.config.js", "*.config.mjs", "eslint.config.js", "vitest.config.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      ...js.configs.recommended.rules,
    },
  },
];
