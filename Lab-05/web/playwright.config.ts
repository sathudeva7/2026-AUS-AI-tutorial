/** End-to-end tests for the console.
 *
 * Two things have to be satisfied before any screen renders: Clerk must say
 * the viewer is signed in with an active organization, and the API must
 * answer. This config solves the first once, for every test, and leaves the
 * second to each test — most of them intercept the call and supply their own
 * roster, which is how states like "the backend is down" or "an agency with
 * 200 people" get tested at all.
 */
import { defineConfig, devices } from "@playwright/test";
import dotenv from "dotenv";

// Clerk keys live in the lab's .env; the test account lives in .env.test.
// Both are gitignored.
dotenv.config({ path: "../.env" });
dotenv.config({ path: ".env.test", override: true });

export default defineConfig({
  testDir: "./e2e",
  // A test that only passes when run alone is a test that will lie later.
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",

  use: {
    baseURL: "http://localhost:5173",
    // Kept only for failures: a trace per passing test is gigabytes nobody
    // opens.
    trace: "on-first-retry",
  },

  projects: [
    // Fetches a Clerk Testing Token. Without it Clerk's bot detection refuses
    // the run and every test fails with "Bot traffic detected" rather than
    // anything to do with the code.
    { name: "setup clerk", testMatch: /global\.setup\.ts/ },
    // Signs in once and writes the session to disk.
    {
      name: "sign in",
      testMatch: /auth\.setup\.ts/,
      dependencies: ["setup clerk"],
    },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], storageState: "e2e/.auth/user.json" },
      dependencies: ["sign in"],
    },
  ],

  // Playwright starts Vite itself, and reuses one already running so a local
  // run does not fight the dev server you have open.
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
