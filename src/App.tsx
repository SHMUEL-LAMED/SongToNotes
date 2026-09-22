import { CircleSlash, Info, Music2, PowerOff, Sparkles, UserRound, Wrench } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { AccountDrawer } from "./components/AccountDrawer";
import { AiAssistant } from "./components/AiAssistant";
import { AppNotices } from "./components/AppNotices";
import { CommandPalette, type CommandItem } from "./components/CommandPalette";
import { Hub } from "./components/Hub";
import { SharePage } from "./components/SharePage";
import { ToolShell } from "./components/ToolShell";
import { useAssistantTool } from "./lib/useAssistantTool";
import { isAdmin } from "./lib/admin";
import { setSignedIn, startAnalytics, trackLeave, trackView } from "./lib/analytics";
import { useAuth } from "./lib/auth";
import { useRoute } from "./lib/router";
import { useSiteControl } from "./lib/siteControl";
import { useCommandKey } from "./lib/useCommandKey";
import { useTheme, type ThemePreference } from "./lib/theme";
import { createShare, shareTokenFromRoute } from "./lib/share";
import { TOOLS, findTool } from "./lib/tools";
import type { DetectedNote } from "./lib/types";
import { KIND_LABELS, KIND_TOOL, deleteWork, describeWork, listWorks, renameWork, syncLocalWorks, type SavedWork } from "./lib/works";
import { AnalyzeTool } from "./tools/AnalyzeTool";
import { ChordsTool } from "./tools/ChordsTool";
import { ConvertTool } from "./tools/ConvertTool";
import { IdentifyTool } from "./tools/IdentifyTool";
import { TtsTool } from "./tools/TtsTool";
import { LyricsTool } from "./tools/LyricsTool";
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

// The admin area is a page one account ever opens; splitting it out keeps it
// out of everybody else's download.
const AdminPanel = lazy(() =>
  import("./components/AdminPanel").then((module) => ({ default: module.AdminPanel })),
);

// The personal area's full page carries the gallery, the charts and the ZIP
// writer; the drawer is enough for a quick look, so the page loads on demand.
const MePage = lazy(() =>
  import("./components/MePage").then((module) => ({ default: module.MePage })),
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
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteWorks, setPaletteWorks] = useState<SavedWork[]>([]);
  const control = useSiteControl();
  const owner = isAdmin(user);

  const tool = findTool(route);
  const shareToken = shareTokenFromRoute(route);
  // The admin area is not a tool: it never appears in the hub, and the page
  // behind the route refuses anybody but the owner — as does the server.
  const admin = route === "admin";
  // `#/me` and `#/me/links`: the personal area, opened on one of its tabs.
  const me = route === "me" || route.startsWith("me/");
  const meTab = me ? route.slice(3) || null : null;
  // A tool the admin switched off is shown as such, not opened; the owner
  // still gets in, to see that it is really off.
  const toolOff = Boolean(tool && control.disabledTools.includes(tool.id) && !owner);
  // Maintenance closes everything but the door the owner uses to reopen it.
  const closed = control.maintenance && !owner && !admin;

  // An unknown hash — a stale bookmark, a typo — lands on the hub rather
  // than an empty page.
  useEffect(() => {
    if (route !== "home" && !tool && !shareToken && !admin && !me) navigate("home");
  }, [admin, me, navigate, route, shareToken, tool]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [route]);

  // What the site counts about itself: which page was opened and for how
  // long. The route is all it is told — never what was done there.
  useEffect(() => startAnalytics(), []);
  useEffect(() => {
    setSignedIn(Boolean(user));
  }, [user]);
  useEffect(() => {
    const page = shareToken ? "share" : route;
    trackView(page);
    const opened = Date.now();
    return () => trackLeave(page, (Date.now() - opened) / 1000);
  }, [route, shareToken]);

  const openPalette = useCallback(() => {
    setPaletteOpen(true);
    void listWorks(user?.id ?? null)
      .then((list) => setPaletteWorks(list.slice(0, 60)))
      .catch(() => setPaletteWorks([]));
  }, [user]);
  useCommandKey(openPalette);

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

  // What the assistant may do on the site itself, from any page.
  useAssistantTool("site", {
    state: () =>
      `האתר: הגולש ${user ? "מחובר לחשבון" : "לא מחובר (בלי חשבון אין שמירה לענן ואין שירותי שרת)"}; העמוד הפתוח: ${tool ? `${tool.title} (${tool.id})` : "דף הבית עם כל הכלים"}; ערכת נושא: ${theme.preference}; האזור האישי ${accountOpen ? "פתוח" : "סגור"}.`,
    handlers: {
      navigate: ({ tool: target }) => {
        const id = String(target);
        if (id === "home") {
          go("home");
          return { ok: true, message: "דף הבית נפתח" };
        }
        const found = findTool(id);
        if (!found) return { ok: false, message: `אין כלי בשם ${id}` };
        go(found.id);
        return { ok: true, message: `${found.title} נפתח` };
      },
      "account.open": () => {
        setAccountOpen(true);
        return { ok: true, message: "האזור האישי נפתח" };
      },
      "account.close": () => {
        setAccountOpen(false);
        return { ok: true, message: "האזור האישי נסגר" };
      },
      "theme.set": ({ theme: choice }) => {
        theme.setPreference(choice as ThemePreference);
        return { ok: true, message: choice === "dark" ? "ערכת נושא כהה" : choice === "light" ? "ערכת נושא בהירה" : "ערכת נושא לפי המערכת" };
      },
      "works.list": async ({ kind, query, limit }) => {
        const all = await listWorks(user?.id ?? null);
        const needle = typeof query === "string" ? query.trim().toLowerCase() : "";
        const items = all
          .filter((work) => (!kind || work.kind === kind) && (!needle || `${work.title} ${work.sourceName ?? ""} ${KIND_LABELS[work.kind]}`.toLowerCase().includes(needle)))
          .slice(0, Math.max(1, Math.min(60, Number(limit) || 25)));
        return {
          ok: true,
          message: all.length ? `${items.length} מתוך ${all.length} עבודות שמורות` : "עדיין אין עבודות שמורות",
          data: {
            total: all.length,
            items: items.map((work) => ({
              id: work.id,
              kind: work.kind,
              kindLabel: KIND_LABELS[work.kind],
              title: work.title,
              description: describeWork(work),
              createdAt: work.createdAt.slice(0, 16),
              hasFile: Boolean(work.fileName),
            })),
          },
        };
      },
      "works.open": async ({ id }) => {
        const work = (await listWorks(user?.id ?? null)).find((item) => item.id === id);
        if (!work) return { ok: false, message: "לא נמצאה עבודה עם המזהה הזה; works.list נותן את המזהים" };
        openWork(work);
        return { ok: true, message: `„${work.title}” נפתח ב${findTool(KIND_TOOL[work.kind])?.title ?? "כלי"}` };
      },
      "works.rename": async ({ id, title }) => {
        const work = (await listWorks(user?.id ?? null)).find((item) => item.id === id);
        if (!work) return { ok: false, message: "לא נמצאה עבודה עם המזהה הזה" };
        await renameWork(work, String(title), user?.id ?? null);
        return { ok: true, message: `השם שונה ל„${String(title).trim().slice(0, 120)}”` };
      },
      "works.delete": async ({ id }) => {
        const work = (await listWorks(user?.id ?? null)).find((item) => item.id === id);
        if (!work) return { ok: false, message: "לא נמצאה עבודה עם המזהה הזה" };
        await deleteWork(work, user?.id ?? null);
        return { ok: true, message: `„${work.title}” נמחק` };
      },
      "works.link": async ({ id }) => {
        const work = (await listWorks(user?.id ?? null)).find((item) => item.id === id);
        if (!work) return { ok: false, message: "לא נמצאה עבודה עם המזהה הזה" };
        if (!user || work.localOnly) return { ok: false, message: "קישור ציבורי אפשרי רק לעבודה שעלתה לפרופיל של חשבון מחובר" };
        const url = await createShare(work);
        return { ok: true, message: "נוצר קישור ציבורי", data: { url } };
      },
    },
  });

  const commands = useMemo<CommandItem[]>(() => {
    const items: CommandItem[] = [
      { id: "page:home", label: "דף הבית", group: "דפים", icon: <Music2 size={15} />, run: () => go("home") },
      { id: "page:me", label: "האזור האישי", hint: "הגלריה, התובנות, הקבצים והקישורים", group: "דפים", icon: <UserRound size={15} />, run: () => go("me") },
    ];
    if (owner) {
      items.push({ id: "page:admin", label: "אזור ניהול", group: "דפים", icon: <Wrench size={15} />, run: () => go("admin") });
    }
    for (const item of TOOLS) {
      const Icon = item.icon;
      items.push({
        id: `tool:${item.id}`,
        label: item.title,
        hint: item.tagline,
        group: "כלים",
        icon: <Icon size={15} />,
        keywords: item.tags.join(" "),
        run: () => go(item.id),
      });
    }
    for (const work of paletteWorks) {
      items.push({
        id: `work:${work.id}`,
        label: work.title,
        hint: `${KIND_LABELS[work.kind]} · ${describeWork(work)}`,
        group: "מה ששמרת",
        icon: <Sparkles size={15} />,
        run: () => openWork(work),
      });
    }
    return items;
  }, [go, openWork, owner, paletteWorks]);

  const opened = pending && pending.route === route ? pending : null;
  const initialFor = (kind: SavedWork["kind"]) =>
    opened && opened.work.kind === kind ? opened.work : null;
  // Each tool remounts when a new work is opened for it, and otherwise keeps
  // its state across renders.
  const keyFor = (kind: SavedWork["kind"]) => (opened && initialFor(kind) ? opened.key : 0);

  return (
    <ToolShell
      tool={tool}
      pageTitle={admin ? "אזור ניהול" : me ? "האזור האישי" : null}
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
        onOpenPage={() => {
          setAccountOpen(false);
          go("me");
        }}
        onOpenAdmin={owner ? () => {
          setAccountOpen(false);
          go("admin");
        } : null}
        onSignInError={setShellError}
      />

      <CommandPalette open={paletteOpen} items={commands} onClose={() => setPaletteOpen(false)} />

      {control.banner && !closed && (
        <p className={`site-banner is-${control.bannerKind}`} role="status">
          <Info size={16} aria-hidden="true" /> {control.banner}
        </p>
      )}

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

      {closed ? (
        <div className="site-closed" role="status">
          <span className="brand-mark">
            <PowerOff size={22} />
          </span>
          <h1>האתר בתחזוקה</h1>
          <p>{control.maintenanceMessage ?? "חוזרים בעוד כמה דקות. תודה על הסבלנות."}</p>
        </div>
      ) : null}
      {!closed && shareToken && <SharePage token={shareToken} onHome={() => go("home")} />}
      {!closed && me && (
        <Suspense
          fallback={
            <div className="tool-loading" role="status">
              <span className="brand-mark">
                <Music2 size={20} />
              </span>
              טוען את האזור האישי…
            </div>
          }
        >
          <MePage
            onOpenWork={openWork}
            onOpenAdmin={owner ? () => go("admin") : null}
            onHome={() => go("home")}
            onSignInError={setShellError}
            initialTab={meTab}
          />
        </Suspense>
      )}
      {toolOff && tool && (
        <div className="site-closed is-tool" role="status">
          <span className="brand-mark">
            <CircleSlash size={22} />
          </span>
          <h1>{tool.title} מכובה זמנית</h1>
          <p>הכלי הזה כבוי כרגע — בדרך כלל כי שירות שהוא נשען עליו לא זמין. שאר הכלים פתוחים.</p>
          <button type="button" className="secondary-button" onClick={() => go("home")}>
            לכל הכלים
          </button>
        </div>
      )}
      {admin && (
        <Suspense
          fallback={
            <div className="tool-loading" role="status">
              <span className="brand-mark">
                <Music2 size={20} />
              </span>
              טוען את אזור הניהול…
            </div>
          }
        >
          <AdminPanel onHome={() => go("home")} />
        </Suspense>
      )}
      {!closed && !tool && !shareToken && !admin && !me && (
        <Hub onOpen={go} disabledTools={control.disabledTools} />
      )}
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
      {tool?.id === "tts" && <TtsTool key={keyFor("tts")} initial={initialFor("tts")} />}
      {tool?.id === "identify" && <IdentifyTool />}
      {tool?.id === "lyrics" && <LyricsTool key={keyFor("lyrics")} initial={initialFor("lyrics")} />}
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
