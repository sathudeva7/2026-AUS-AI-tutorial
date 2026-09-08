import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ClerkProvider } from "@clerk/react";
import App from "./App";
import { clerkAppearance } from "./lib/clerkAppearance";
import { MissingClerkKey } from "./components/auth/MissingClerkKey";

// Import order IS the cascade. Tailwind's preflight first, then the Organic
// design system so its base rules survive the reset, then the app chrome,
// then Tailwind's utilities last so a utility class always wins. Reordering
// these silently changes which styles apply. See styles/tailwind-base.css.
import "./styles/tailwind-base.css";
import "./styles/organic.css";
import "./styles/app.css";
// Scoped to `.console`; loaded after app.css so its tokens win inside that
// subtree, and before utilities.css so a Tailwind class still overrides it.
import "./styles/console.css";
import "./styles/utilities.css";

// Publishable keys are public by design — they ship in the client bundle and
// identify the instance rather than authorising anything. The SECRET key is
// the one that matters, and it lives in Lab-05/.env for the backend to use;
// Vite only exposes VITE_* to the browser, so it cannot leak through here.
const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

const root = createRoot(document.getElementById("root")!);

if (!publishableKey) {
  // Fail loudly and legibly. ClerkProvider throws without a key, which
  // surfaces as a blank page and a stack trace in the console — no use to
  // whoever just cloned this.
  root.render(
    <StrictMode>
      <MissingClerkKey />
    </StrictMode>,
  );
} else {
  root.render(
    <StrictMode>
      <ClerkProvider publishableKey={publishableKey} appearance={clerkAppearance}>
        <App />
      </ClerkProvider>
    </StrictMode>,
  );
}
