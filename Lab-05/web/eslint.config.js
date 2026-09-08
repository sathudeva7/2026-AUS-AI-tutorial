/** What the machine checks, so it does not depend on somebody noticing.
 *
 * The rules below are the ones that have actually caught something in this
 * codebase or would have. Everything else is left off: a config full of rules
 * nobody agreed to produces a wall of warnings that gets ignored, and an
 * ignored linter is worse than none — it looks like the code is checked.
 */
import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "node_modules", "playwright-report", "test-results"] },

  {
    files: ["**/*.{ts,tsx}"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,

      // A dependency list that does not match what the effect reads is how an
      // effect quietly runs against last render's values. This is the rule
      // most worth having on, and it is an error rather than a warning
      // because the failure it prevents is invisible at the time.
      "react-hooks/exhaustive-deps": "error",

      // Unused imports and variables. tsc already refuses these, but the
      // editor surfaces them from eslint as you type rather than at build.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],

      // `any` turns off the type checking that is the reason to use
      // TypeScript. Warn rather than error: the test files legitimately reach
      // for it when calling into browser context.
      "@typescript-eslint/no-explicit-any": "warn",

      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
    },
  },

  // Type-aware rules need the program, so they live here rather than in the
  // block above: applied to every file, they crash on vite.config.ts and
  // eslint.config.js, which are in no tsconfig.
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parserOptions: {
        project: ["./tsconfig.app.json"],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // A promise nobody waits on is an error nobody hears about. `void` it
      // deliberately, or await it.
      "@typescript-eslint/no-floating-promises": "error",
    },
  },

  // Tests run in node and drive a browser; both sets of globals apply, and
  // `any` is the honest type for a value crossing into page.evaluate.
  {
    files: ["e2e/**/*.ts", "playwright.config.ts"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-floating-promises": "off",
    },
  },
);
