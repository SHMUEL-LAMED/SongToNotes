import { Music2 } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { AccountDrawer } from "./components/AccountDrawer";
import { AiAssistant } from "./components/AiAssistant";
import { AppNotices } from "./components/AppNotices";
import { Hub } from "./components/Hub";
import { ToolShell } from "./components/ToolShell";
import { useAuth } from "./lib/auth";
import { useRoute } from "./lib/router";
import { useTheme } from "./lib/theme";
import { findTool } from "./lib/tools";
import type { DetectedNote } from "./lib/types";
import { KIND_TOOL, syncLocalWorks, type SavedWork } from "./lib/works";
import { AnalyzeTool } from "./tools/AnalyzeTool";
import { ChordsTool } from "./tools/ChordsTool";
import { ConvertTool } from "./tools/ConvertTool";
import { MixerTool } from "./tools/MixerTool";
import { RhythmTool } from "./tools/RhythmTool";
import { VideoTool } from "./tools/VideoTool";
import { SongbookTool } from "./tools/SongbookTool";
import { EarTrainingTool } from "./tools/EarTrainingTool";
import { MetronomeTool } from "./tools/MetronomeTool";
import { PianoTool } from "./tools/PianoTool";
import { RingtoneTool } from "./tools/RingtoneTool";
import { SpeedTool } from "./tools/SpeedTool";
import { TranscriptTool } from "./tools/TranscriptTool";
import { normalizeSettings, type PendingTranscription, type Settings } from "./tools/settings";
import { TunerTool } from "./tools/TunerTool";
import { VocalsTool } from "./tools/VocalsTool";

// The transcriber pulls in the engraver and, through it, the biggest slice of
// the bundle. Splitting it out keeps the hub and the lighter tools quick to
// open for someone who never asks for sheet music.
const TranscriberTool = lazy(() =>
  import("./tools/TranscriberTool").then((module) => ({ default: module.TranscriberTool })),
);

/**
 * A saved transcription or piano recording, in the shape the transcriber
 * starts from. Anything that is not a list of notes opens as an empty page
 * rather than crashing the engraver.
 */
function toPendingTranscription(work: SavedWork): PendingTranscription {
  const notes = Array.isArray(work.payload.notes)
    ? (work.payload.notes as unknown[]).filter(
        (note): note is DetectedNote =>
          typeof note === "object" &&
          note !== null &&
          typeof (note as DetectedNote).midi === "number" &&
          typeof (note as DetectedNote).start === "number" &&
          typeof (note as DetectedNote).duration === "number",
      )
    : [];
  return {
    title: work.title,
    notes,
    analysisOffset: Number(work.payload.analysisOffset) || 0,
    settings: normalizeSettings(work.payload.settings as Partial<Settings> | undefined),
  };
}

function WorkspaceApp() {
  const { route, navigate } = useRoute();
  const { user } = useAuth();
  const theme = useTheme();
  // A saved work the personal area asked a tool to open. The key bumps with
  // every opening so the tool remounts and starts from that work instead of
  // merging it into whatever is on screen; the route it was opened for keeps
  // an old choice from reappearing when the tool is visited on its own.
  const [pending, setPending] = useState<{ key: number; work: SavedWork; route: string } | null>(
    null,
  );
  const [shellError, setShellError] = useState<string | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);

  const tool = findTool(route);

  // An unknown hash — a stale bookmark, a typo — lands on the hub rather
  // than an empty page.
  useEffect(() => {
    if (route !== "home" && !tool) navigate("home");
  }, [navigate, route, tool]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [route]);

  // Signing in uploads whatever this device saved while signed out, so the
  // personal area is complete on the first visit rather than after one.
  useEffect(() => {
    if (!user) return;
    void syncLocalWorks(user.id).catch(() => undefined);
  }, [user]);

  const go = useCallback(
    (next: string) => {
      setPending(null);
      navigate(next);
    },
    [navigate],
  );

  const openWork = useCallback(
    (work: SavedWork) => {
      const target = KIND_TOOL[work.kind];
      setPending((current) => ({ key: (current?.key ?? 0) + 1, work, route: target }));
      setAccountOpen(false);
      navigate(target);
    },
    [navigate],
  );

  const opened = pending && pending.route === route ? pending : null;
  const initialFor = (kind: SavedWork["kind"]) =>
    opened && opened.work.kind === kind ? opened.work : null;
  // Each tool remounts when a new work is opened for it, and otherwise keeps
  // its state across renders.
  const keyFor = (kind: SavedWork["kind"]) => (opened && initialFor(kind) ? opened.key : 0);

  return (
    <ToolShell
      tool={tool}
      account={accountOpen}
      themePreference={theme.preference}
      onCycleTheme={theme.cycle}
      onHome={() => go("home")}
      onOpenAccount={() => setAccountOpen(true)}
    >
      <AccountDrawer
        open={accountOpen}
        onClose={() => setAccountOpen(false)}
        onOpenWork={openWork}
        onSignInError={setShellError}
      />

      <AiAssistant
        open={assistantOpen}
        onOpen={() => setAssistantOpen(true)}
        onClose={() => setAssistantOpen(false)}
        toolId={tool?.id ?? null}
        toolTitle={tool?.title ?? null}
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

      {!tool && <Hub onOpen={go} />}
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
            key={opened && (opened.work.kind === "notes" || opened.work.kind === "piano") ? opened.key : 0}
            initial={
              opened && (opened.work.kind === "notes" || opened.work.kind === "piano")
                ? toPendingTranscription(opened.work)
                : null
            }
          />
        </Suspense>
      )}
      {tool?.id === "ringtone" && <RingtoneTool />}
      {tool?.id === "vocals" && (
        <VocalsTool key={keyFor("vocals")} initial={initialFor("vocals")} />
      )}
      {tool?.id === "speed" && <SpeedTool key={keyFor("speed")} initial={initialFor("speed")} />}
      {tool?.id === "metronome" && (
        <MetronomeTool key={keyFor("metronome")} initial={initialFor("metronome")} />
      )}
      {tool?.id === "tuner" && <TunerTool key={keyFor("tuner")} initial={initialFor("tuner")} />}
      {tool?.id === "piano" && <PianoTool />}
      {tool?.id === "ear" && <EarTrainingTool key={keyFor("ear")} initial={initialFor("ear")} />}
      {tool?.id === "analyze" && (
        <AnalyzeTool key={keyFor("analysis")} initial={initialFor("analysis")} />
      )}
      {tool?.id === "rhythm" && <RhythmTool key={keyFor("rhythm")} initial={initialFor("rhythm")} />}
      {tool?.id === "mixer" && <MixerTool key={keyFor("mix")} initial={initialFor("mix")} />}
      {tool?.id === "convert" && <ConvertTool key={keyFor("convert")} initial={initialFor("convert")} />}
      {tool?.id === "video" && <VideoTool />}
      {tool?.id === "chords" && <ChordsTool key={keyFor("chords")} initial={initialFor("chords")} />}
      {tool?.id === "songbook" && <SongbookTool key={keyFor("song")} initial={initialFor("song")} />}
      {tool?.id === "transcript" && (
        <TranscriptTool key={keyFor("transcript")} initial={initialFor("transcript")} />
      )}

      {tool && (
        <footer>
          <button className="brand brand-button" type="button" onClick={() => go("home")}>
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
