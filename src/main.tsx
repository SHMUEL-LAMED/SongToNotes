import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AuthProvider } from "./lib/auth";
import { captureReferral } from "./lib/credits";
import { CreditsProvider } from "./lib/creditsContext";
import { startI18n } from "./lib/i18n";
// The typeface ships with the site: no request to a font host, and it works offline.
import "@fontsource-variable/rubik";
import "./styles/index.css";

// Before the first render: a Yiddish or English visitor never sees Hebrew flash by.
void startI18n();
// A friend's private link (?ref=…) is kept, and taken out of the address.
captureReferral();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <CreditsProvider>
        <App />
      </CreditsProvider>
    </AuthProvider>
  </StrictMode>,
);
