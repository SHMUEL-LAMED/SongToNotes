import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AuthProvider } from "./lib/auth";
import { captureReferral } from "./lib/credits";
import { CreditsProvider } from "./lib/creditsContext";
import { startI18n } from "./lib/i18n";
import { watchForNewBuild } from "./lib/staleBuild";
import { authCallbackPending, getSupabase } from "./lib/supabase";
// The typeface ships with the site: no request to a font host, and it works offline.
import "@fontsource-variable/rubik";
import "./styles/index.css";

// Before the first render: a Yiddish or English visitor never sees Hebrew flash by.
void startI18n();
// A friend's private link (?ref=…) is kept, and taken out of the address.
captureReferral();

// A tab left open across a deploy loads the new build, instead of failing on
// the old build's pieces that are gone from the server.
watchForNewBuild();

/**
 * Back from Google, the sign-in's tokens sit in the address, and the router
 * would send that address home before the client library — which loads on
 * first use — got to read them. So that one visit waits for the library to
 * take them in; every other visit paints at once.
 */
async function start() {
  if (authCallbackPending()) {
    await getSupabase()
      .then((client) => client.auth.getSession())
      .catch(() => undefined);
  }
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <ErrorBoundary whole>
        <AuthProvider>
          <CreditsProvider>
            <App />
          </CreditsProvider>
        </AuthProvider>
      </ErrorBoundary>
    </StrictMode>,
  );
}

void start();
