import { Music2 } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { AccountPanel } from "./components/AccountPanel";
import { AppNotices } from "./components/AppNotices";
import { Hub } from "./components/Hub";
import { ToolShell } from "./components/ToolShell";
import { useAuth } from "./lib/auth";
import type { SavedTranscription } from "./lib/history";
import { useRoute } from "./lib/router";
import { useTheme } from "./lib/theme";
import { findTool } from "./lib/tools";
import { AnalyzeTool } from "./tools/AnalyzeTool";
import { MetronomeTool } from "./tools/MetronomeTool";
import { PianoTool } from "./tools/PianoTool";
import { RingtoneTool } from "./tools/RingtoneTool";
import { SpeedTool } from "./tools/SpeedTool";
import { normalizeSettings, type PendingTranscription, type Settings } from "./tools/settings";
import { TunerTool } from "./tools/TunerTool";
import { VocalsTool } from "./tools/VocalsTool";

// The transcriber pulls in the engraver and, through it, the biggest slice of
// the bundle. Splitting it out keeps the hub and the lighter tools quick to
// open for someone who never asks for sheet music.
const TranscriberTool = lazy(() =>
  import("./tools/TranscriberTool").then((module) => ({ default: module.TranscriberTool })),
);

function WorkspaceApp() {
  const { route, navigate } = useRoute();
  const theme = useTheme();
  const [accountOpen, setAccountOpen] = useState(false);
  const [historyRefreshToken, setHistoryRefreshToken] = useState(0);
  // Bumped with every history entry opened, so the transcriber remounts and
  // starts from that entry instead of merging it into whatever is on screen.
  const [incoming, setIncoming] = useState<{ key: number; item: PendingTranscription } | null>(null);
  const [shellError, setShellError] = useState<string | null>(null);

  const tool = findTool(route);

  // An unknown hash — a stale bookmark, a typo — lands on the hub rather
  // than an empty page.
  useEffect(() => {
    if (route !== "home" && !tool) navigate("home");
  }, [navigate, route, tool]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [route]);

  const openSaved = useCallback(
    (item: SavedTranscription) => {
      setIncoming((current) => ({
        key: (current?.key ?? 0) + 1,
        item: {
          title: item.title,
          notes: Array.isArray(item.raw_notes) ? item.raw_notes : [],
          analysisOffset: Number(item.analysis_offset) || 0,
          settings: normalizeSettings(item.settings as Partial<Settings>),
        },
      }));
      setAccountOpen(false);
      navigate("notes");
    },
    [navigate],
  );

  return (
    <ToolShell
      tool={tool}
      themePreference={theme.preference}
      onCycleTheme={theme.cycle}
      onHome={() => navigate("home")}
      onOpenAccount={() => setAccountOpen(true)}
      onSignInError={setShellError}
    >
      <AccountPanel
        open={accountOpen}
        refreshToken={historyRefreshToken}
        onClose={() => setAccountOpen(false)}
        onOpenItem={openSaved}
      />

      <AppNotices />

      {shellError && (
        <div className="shell-error error-message" role="alert">
          {shellError}
          <button type="button" className="link-button" onClick={() => setShellError(null)}>
            סגור
          </button>
        </div>
      )}

      {!tool && <Hub onOpen={navigate} />}
      {tool?.id === "notes" && (
        <Suspense
          fallback={
            <div className="tool-loading" role="status">
              <span className="brand-mark">
                <Music2 size={20} />
              </span>
              טוען את מנוע התווים…
            </div>
          }
        >
          <TranscriberTool
            key={incoming?.key ?? 0}
            initial={incoming?.item ?? null}
            onSaved={() => setHistoryRefreshToken((value) => value + 1)}
          />
        </Suspense>
      )}
      {tool?.id === "ringtone" && (
        <RingtoneTool onSaved={() => setHistoryRefreshToken((value) => value + 1)} />
      )}
      {tool?.id === "vocals" && <VocalsTool />}
      {tool?.id === "speed" && <SpeedTool />}
      {tool?.id === "metronome" && <MetronomeTool />}
      {tool?.id === "tuner" && <TunerTool />}
      {tool?.id === "piano" && <PianoTool />}
      {tool?.id === "analyze" && <AnalyzeTool />}

      {tool && (
        <footer>
          <button className="brand brand-button" type="button" onClick={() => navigate("home")}>
            <span className="brand-mark">
              <Music2 size={20} />
            </span>
            <span>כלי מוזיקה</span>
          </button>
        </footer>
      )}
    </ToolShell>
  );
}

export default function App() {
  const { loading } = useAuth();
  const theme = useTheme();

  if (loading) {
    return (
      <main className="page auth-screen" data-theme={theme.resolved}>
        <div className="auth-loading" role="status">
          <span className="brand-mark">
            <Music2 size={22} />
          </span>
          <strong>טוען את כלי המוזיקה…</strong>
        </div>
      </main>
    );
  }

  return <WorkspaceApp />;
}
