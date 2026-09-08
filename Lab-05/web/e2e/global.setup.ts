/** Obtains a Clerk Testing Token for the whole run.
 *
 * Clerk protects live instances with bot detection. A browser driven by
 * Playwright looks exactly like the thing it is designed to stop, so without
 * this every test fails at the sign-in screen for reasons that have nothing
 * to do with the application.
 */
import { clerkSetup } from "@clerk/testing/playwright";
import { test as setup } from "@playwright/test";

setup("obtain a Clerk testing token", async () => {
  await clerkSetup();
});
