import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AuthProvider } from "./lib/auth";
import { startI18n } from "./lib/i18n";
// The typeface ships with the site: no request to a font host, and it works offline.
import "@fontsource-variable/rubik";
import "./styles/index.css";

// Before the first render: a Yiddish or English visitor never sees Hebrew flash by.
void startI18n();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
);
