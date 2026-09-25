import { CircleSlash, Info, Keyboard, MessageSquareText, Palette, PowerOff, Share2, Sparkles, UserRound, Wrench, House, Zap } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { AccountDrawer } from "./components/AccountDrawer";
import { AiAssistant } from "./components/AiAssistant";
import { AppNotices } from "./components/AppNotices";
import { AppShell } from "./components/AppShell";
import { AppearanceDialog } from "./components/AppearanceDialog";
import { CommandPalette, type CommandItem } from "./components/CommandPalette";
import { CreditNotices } from "./components/CreditNotices";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { Home } from "./components/Home";
import { LogoGlyph } from "./components/Logo";
import { NextSteps } from "./components/NextSteps";
import { SharePage } from "./components/SharePage";
import { SharePrompt, ShareSiteDialog } from "./components/SiteShare";
import { ShortcutsDialog } from "./components/ShortcutsDialog";
import { SiteFooter } from "./components/SiteFooter";
import { ToolPromo } from "./components/ToolPromo";
import { FeedbackDialog } from "./components/FeedbackDialog";
import { useAssistantTool } from "./lib/useAssistantTool";
import { isAdmin } from "./lib/admin";
import { setSignedIn, startAnalytics, trackLeave, trackView } from "./lib/analytics";
import { useAuth } from "./lib/auth";
import { balanceOf, referralLink, untilReset } from "./lib/credits";
import { useCredits } from "./lib/creditsContext";
import { useRoute } from "./lib/router";
import { useSiteControl } from "./lib/siteControl";
import { langForModel } from "./lib/i18n";
import { recordToolVisit } from "./lib/prefs";
import { useCommandKey } from "./lib/useCommandKey";
import { useToolPromo } from "./lib/toolPromo";
import { ACCENT_CHOICES, useAccent, useTheme, type ThemePreference } from "./lib/theme";
import { createShare, shareTokenFromRoute } from "./lib/share";
import { useSharePrompt } from "./lib/siteShare";
import { TOOLS, findAnyTool, findTool } from "./lib/tools";
import type { DetectedNote } from "./lib/types";
import { KIND_LABELS, KIND_TOOL, deleteWork, describeWork, listWorks, renameWork, syncLocalWorks, type SavedWork } from "./lib/works";
import { normalizeSettings, type PendingTranscription, type Settings } from "./tools/settings";

// Every tool is its own chunk: the hub downloads only the shell, and a
// tool's code arrives the first time somebody opens it.
const AnalyzeTool = lazy(() => import("./tools/AnalyzeTool").then((module) => ({ default: module.AnalyzeTool })));
const BeatMakerTool = lazy(() => import("./tools/BeatMakerTool").then((module) => ({ default: module.BeatMakerTool })));
const ChordsTool = lazy(() => import("./tools/ChordsTool").then((module) => ({ default: module.ChordsTool })));
const ConvertTool = lazy(() => import("./tools/ConvertTool").then((module) => ({ default: module.ConvertTool })));
const IdentifyTool = lazy(() => import("./tools/IdentifyTool").then((module) => ({ default: module.IdentifyTool })));
const TtsTool = lazy(() => import("./tools/TtsTool").then((module) => ({ default: module.TtsTool })));
const LyricsTool = lazy(() => import("./tools/LyricsTool").then((module) => ({ default: module.LyricsTool })));
const MixerTool = lazy(() => import("./tools/MixerTool").then((module) => ({ default: module.MixerTool })));
const PadTool = lazy(() => import("./tools/PadTool").then((module) => ({ default: module.PadTool })));
const RhythmTool = lazy(() => import("./tools/RhythmTool").then((module) => ({ default: module.RhythmTool })));
const VideoTool = lazy(() => import("./tools/VideoTool").then((module) => ({ default: module.VideoTool })));
const SongbookTool = lazy(() => import("./tools/SongbookTool").then((module) => ({ default: module.SongbookTool })));
const EarTrainingTool = lazy(() => import("./tools/EarTrainingTool").then((module) => ({ default: module.EarTrainingTool })));
const MetronomeTool = lazy(() => import("./tools/MetronomeTool").then((module) => ({ default: module.MetronomeTool })));
const ProgressionTool = lazy(() => import("./tools/ProgressionTool").then((module) => ({ default: module.ProgressionTool })));
const ChangesTool = lazy(() => import("./tools/ChangesTool").then((module) => ({ default: module.ChangesTool })));
const PianoTool = lazy(() => import("./tools/PianoTool").then((module) => ({ default: module.PianoTool })));
const RingtoneTool = lazy(() => import("./tools/RingtoneTool").then((module) => ({ default: module.RingtoneTool })));
const SpeedTool = lazy(() => import("./tools/SpeedTool").then((module) => ({ default: module.SpeedTool })));
const TheoryTool = lazy(() => import("./tools/TheoryTool").then((module) => ({ default: module.TheoryTool })));
const TranscriptTool = lazy(() => import("./tools/TranscriptTool").then((module) => ({ default: module.TranscriptTool })));
const TunerTool = lazy(() => import("./tools/TunerTool").then((module) => ({ default: module.TunerTool })));
const VocalsTool = lazy(() => import("./tools/VocalsTool").then((module) => ({ default: module.VocalsTool })));

// The transcriber pulls in the engraver and, through it, the biggest slice of
// the bundle. Splitting it out keeps the hub and the lighter tools quick to
// open for someone who never asks for sheet music.
const ASSISTANT_OPEN_KEY = "musictools.assistant.open.v1";

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

// The credits page explains the rules and holds the private link; it is
// opened now and then, so it loads on demand too.
const CreditsPage = lazy(() =>
  import("./components/CreditsPage").then((module) => ({ default: module.CreditsPage })),
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
  const credit = useCredits();
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
  // The assistant stays docked across visits once it was left open, on a
  // screen wide enough to hold it beside the page.
  const [assistantOpen, setAssistantOpenState] = useState(() => {
    try {
      return localStorage.getItem(ASSISTANT_OPEN_KEY) === "1" && window.matchMedia("(min-width: 1100px)").matches;
    } catch {
      return false;
    }
  });
  const setAssistantOpen = useCallback((value: boolean | ((open: boolean) => boolean)) => {
    setAssistantOpenState((current) => {
      const next = typeof value === "function" ? value(current) : value;
      try {
        localStorage.setItem(ASSISTANT_OPEN_KEY, next ? "1" : "0");
      } catch {
        // Fine.
      }
      return next;
    });
  }, []);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const { accent, setAccent } = useAccent();
  const [paletteWorks, setPaletteWorks] = useState<SavedWork[]>([]);
  const control = useSiteControl();
  const owner = isAdmin(user);

  // A hidden tool is an unknown address to visitors; the owner can still open it.
  const tool = findTool(route) ?? (owner ? findAnyTool(route) : null);
  const shareToken = shareTokenFromRoute(route);
  // The admin area is not a tool: it never appears in the hub, and the page
  // behind the route refuses anybody but the owner — as does the server.
  const admin = route === "admin";
  // `#/me` and `#/me/links`: the personal area, opened on one of its tabs.
  const me = route === "me" || route.startsWith("me/");
  const meTab = me ? route.slice(3) || null : null;
  // `#/credits`: the credits, the private link and how it all works.
  const credits = route === "credits";
  // A tool the admin switched off is shown as such, not opened; the owner
  // still gets in, to see that it is really off.
  const toolOff = Boolean(tool && control.disabledTools.includes(tool.id) && !owner);
  // Maintenance closes everything but the door the owner uses to reopen it.
  const closed = control.maintenance && !owner && !admin;
  // Every ten minutes on screen, a request to pass the site on — never over
  // another dialog, a closed site or the admin area.
  const sharePrompt = useSharePrompt({
    paused: paletteOpen || shortcutsOpen || appearanceOpen || accountOpen || closed || admin,
    sharing: shareOpen,
  });
  // Once a visit, after a little while on screen, an invitation to one of the
  // tools that are not only for musicians, taking turns — never to the tool on
  // screen or one that is off, over a dialog, or beside the request to share
  // or a word about credits.
  const creditNotice = Boolean(credit.invite || credit.welcome || credit.empty);
  const toolPromo = useToolPromo({
    paused:
      paletteOpen || shortcutsOpen || appearanceOpen || accountOpen || shareOpen || feedbackOpen || closed || admin || sharePrompt.open || creditNotice,
    current: tool?.id ?? null,
    disabledTools: control.disabledTools,
  });

  // An unknown hash — a stale bookmark, a typo — lands on the hub rather
  // than an empty page.
  useEffect(() => {
    if (route !== "home" && !tool && !shareToken && !admin && !me && !credits) navigate("home");
  }, [admin, credits, me, navigate, route, shareToken, tool]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [route]);

  // The tools opened last come back on the home page and in the palette.
  useEffect(() => {
    if (tool) recordToolVisit(tool.id);
  }, [tool]);

  // "?" anywhere outside a text field opens the shortcuts sheet; Ctrl+J,
  // from anywhere, shows or hides the assistant.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && (event.key === "j" || event.key === "J" || event.code === "KeyJ")) {
        event.preventDefault();
        setAssistantOpen((open) => !open);
        return;
      }
      if (event.key !== "?" || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)) return;
      event.preventDefault();
      setShortcutsOpen((open) => !open);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setAssistantOpen]);

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
  const closeShortcuts = useCallback(() => setShortcutsOpen(false), []);
  const closeAppearance = useCallback(() => setAppearanceOpen(false), []);
  const closeShare = useCallback(() => setShareOpen(false), []);
  const closeFeedback = useCallback(() => setFeedbackOpen(false), []);
  const openFeedback = useCallback(() => setFeedbackOpen(true), []);

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
      `האתר: הגולש ${user ? "מחובר לחשבון" : "לא מחובר (בלי חשבון אין שמירה לענן ואין שירותי שרת)"}; העמוד הפתוח: ${tool ? `${tool.title} (${tool.id})` : credits ? "דף הקרדיטים והזמנת חברים" : "דף הבית עם כל הכלים"}; ערכת נושא: ${theme.preference}; שפת הממשק: ${langForModel()} (ענה בשפה הזאת); צבע: ${accent.hue === null ? "ברירת מחדל" : ACCENT_CHOICES.find((item) => item.hue === accent.hue)?.label ?? accent.hue}${accent.everywhere ? " בכל הכלים" : ""}; האזור האישי ${accountOpen ? "פתוח" : "סגור"}${credit.status ? `; קרדיטים זמינים: ${balanceOf(credit.status)} (${credit.status.dailyLeft} מהקצבה היומית ו־${credit.status.bonus} בונוס)` : ""}.`,
    handlers: {
      "credits.open": () => {
        go("credits");
        return { ok: true, message: "דף הקרדיטים נפתח" };
      },
      "credits.read": () => {
        const { rules, status } = credit;
        const prices = Object.entries(rules.prices).map(([key, price]) => `${key}=${price}`).join(", ");
        if (!status) {
          return {
            ok: true,
            message: user ? "הקרדיטים עוד נטענים" : "הגולש לא מחובר: קרדיטים וקישור אישי ניתנים אחרי התחברות",
            data: { signedIn: Boolean(user), rules: { daily: rules.daily, signupBonus: rules.signupBonus, friendDaily: rules.friendDaily, friendDailyMax: rules.friendDailyMax, welcomeBonus: rules.welcomeBonus, visitBonus: rules.visitBonus, visitDailyMax: rules.visitDailyMax, prices } },
          };
        }
        return {
          ok: true,
          message: `${balanceOf(status)} קרדיטים זמינים`,
          data: {
            available: balanceOf(status),
            dailyLeft: status.dailyLeft,
            dailyAllowance: status.allowance,
            bonus: status.bonus,
            renewsIn: untilReset(status.resetsAt),
            friendsJoined: status.friends,
            linkVisits: status.visits,
            earned: status.earned,
            privateLink: referralLink(status.code),
            prices,
          },
        };
      },
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
      "theme.color": ({ color, everywhere }) => {
        if (color === "default") {
          setAccent({ hue: null, everywhere: false });
          return { ok: true, message: "הצבע חזר לברירת המחדל" };
        }
        const found = ACCENT_CHOICES.find((item) => item.label === color || String(item.hue) === String(color));
        if (!found) return { ok: false, message: `הצבעים: ${ACCENT_CHOICES.map((item) => item.label).join(", ")} או default` };
        setAccent({ hue: found.hue, everywhere: Boolean(everywhere) });
        return { ok: true, message: `צבע האתר: ${found.label}${everywhere ? ", בכל הכלים" : ""}` };
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
      { id: "page:home", label: "דף הבית", group: "דפים", icon: <House size={15} />, run: () => go("home") },
      { id: "page:me", label: "האזור האישי", hint: "הגלריה, התובנות, הקבצים והקישורים", group: "דפים", icon: <UserRound size={15} />, run: () => go("me") },
      { id: "page:shortcuts", label: "קיצורי מקלדת", hint: "או ? מכל מקום", group: "דפים", icon: <Keyboard size={15} />, run: () => setShortcutsOpen(true) },
      { id: "page:appearance", label: "מראה וצבעים", hint: "בהיר או כהה, וצבע האתר", group: "דפים", icon: <Palette size={15} />, run: () => setAppearanceOpen(true) },
      { id: "page:share", label: "שיתוף האתר", hint: "קישור לחברים, בוואטסאפ או בכל מקום", group: "דפים", icon: <Share2 size={15} />, run: () => setShareOpen(true) },
      { id: "page:credits", label: "קרדיטים והזמנת חברים", hint: "היתרה, הקישור האישי ואיך מקבלים עוד", group: "דפים", icon: <Zap size={15} />, keywords: "קרדיטים קישור הזמנה חברים בונוס credits invite referral", run: () => go("credits") },
      { id: "page:feedback", label: "משוב והצעות", hint: "בעיה, רעיון או כל דבר אחר", group: "דפים", icon: <MessageSquareText size={15} />, run: () => setFeedbackOpen(true) },
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

  // A tool renders only when the site is open and the tool is switched on.
  const shown = tool && !closed && !toolOff ? tool.id : null;
  const loading = (label: string) => (
    <div className="tool-loading" role="status">
      <span className="brand-mark">
        <LogoGlyph />
      </span>
      {label}
    </div>
  );

  return (
    <AppShell
      route={route}
      tool={tool}
      pageTitle={admin ? "אזור ניהול" : me ? "האזור האישי" : credits ? "קרדיטים והזמנת חברים" : shareToken ? "עבודה משותפת" : null}
      account={accountOpen}
      owner={owner}
      disabledTools={control.disabledTools}
      themePreference={theme.preference}
      onOpenAppearance={() => setAppearanceOpen(true)}
      onNavigate={go}
      onOpenAccount={() => setAccountOpen(true)}
      onOpenPalette={openPalette}
      onOpenShortcuts={() => setShortcutsOpen(true)}
      onOpenShare={() => setShareOpen(true)}
      onOpenCredits={() => go("credits")}
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
        onOpenCredits={() => {
          setAccountOpen(false);
          go("credits");
        }}
        onSignInError={setShellError}
      />

      <CommandPalette open={paletteOpen} items={commands} onClose={() => setPaletteOpen(false)} />
      <ShortcutsDialog open={shortcutsOpen} onClose={closeShortcuts} />
      <AppearanceDialog
        open={appearanceOpen}
        onClose={closeAppearance}
        preference={theme.preference}
        onPreference={theme.setPreference}
        accent={accent}
        onAccent={setAccent}
      />
      <ShareSiteDialog open={shareOpen} onClose={closeShare} onOpenCredits={() => go("credits")} />
      <FeedbackDialog open={feedbackOpen} page={route.slice(0, 40)} onClose={closeFeedback} />

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

      <AppNotices>
        <CreditNotices onOpenCredits={() => go("credits")} onSignInError={setShellError} />
        {sharePrompt.open && (
          <SharePrompt
            onMore={() => {
              sharePrompt.close();
              setShareOpen(true);
            }}
            onClose={sharePrompt.close}
          />
        )}
        {toolPromo.promo && (
          <ToolPromo
            promo={toolPromo.promo}
            onOpen={() => {
              const target = toolPromo.accept();
              if (target) go(target);
            }}
            onClose={toolPromo.dismiss}
          />
        )}
      </AppNotices>

      {shellError && (
        <div className="shell-error error-message" role="alert">
          {shellError}
          <button type="button" className="link-button" onClick={() => setShellError(null)}>
            סגור
          </button>
        </div>
      )}

      {/* A page that fails to render — or whose code did not arrive — says so
          here, and the sidebar and the rest of the site keep working. */}
      <ErrorBoundary resetKey={route} onHome={route === "home" ? undefined : () => go("home")}>
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
          <Suspense fallback={loading("טוען את האזור האישי…")}>
            <MePage
              onOpenWork={openWork}
              onOpenAdmin={owner ? () => go("admin") : null}
              onOpenCredits={() => go("credits")}
              onHome={() => go("home")}
              onSignInError={setShellError}
              initialTab={meTab}
            />
          </Suspense>
        )}
        {!closed && credits && (
          <Suspense fallback={loading("טוען את הקרדיטים…")}>
            <CreditsPage onOpen={go} onSignInError={setShellError} />
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
          <Suspense fallback={loading("טוען את אזור הניהול…")}>
            <AdminPanel onHome={() => go("home")} />
          </Suspense>
        )}
        {!closed && !tool && !shareToken && !admin && !me && !credits && (
          <Home onOpen={go} onOpenWork={openWork} disabledTools={control.disabledTools} onFeedback={openFeedback} />
        )}
        {shown === "notes" && (
          <Suspense fallback={loading("טוען את מנוע התווים…")}>
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
        <Suspense fallback={shown && shown !== "notes" ? loading("טוען את הכלי…") : null}>
          {shown === "ringtone" && <RingtoneTool />}
          {shown === "vocals" && <VocalsTool key={keyFor("vocals")} initial={initialFor("vocals")} />}
          {shown === "speed" && <SpeedTool key={keyFor("speed")} initial={initialFor("speed")} />}
          {shown === "metronome" && <MetronomeTool key={keyFor("metronome")} initial={initialFor("metronome")} />}
          {shown === "tuner" && <TunerTool key={keyFor("tuner")} initial={initialFor("tuner")} />}
          {shown === "piano" && <PianoTool />}
          {shown === "ear" && <EarTrainingTool key={keyFor("ear")} initial={initialFor("ear")} />}
          {shown === "analyze" && <AnalyzeTool key={keyFor("analysis")} initial={initialFor("analysis")} />}
          {shown === "tts" && <TtsTool key={keyFor("tts")} initial={initialFor("tts")} />}
          {shown === "identify" && <IdentifyTool key={keyFor("identify")} initial={initialFor("identify")} />}
          {shown === "lyrics" && <LyricsTool key={keyFor("lyrics")} initial={initialFor("lyrics")} />}
          {shown === "rhythm" && <RhythmTool key={keyFor("rhythm")} initial={initialFor("rhythm")} />}
          {shown === "mixer" && <MixerTool key={keyFor("mix")} initial={initialFor("mix")} />}
          {shown === "pads" && <PadTool />}
          {shown === "convert" && <ConvertTool key={keyFor("convert")} initial={initialFor("convert")} />}
          {shown === "video" && <VideoTool />}
          {shown === "chords" && <ChordsTool key={keyFor("chords")} initial={initialFor("chords")} />}
          {shown === "songbook" && <SongbookTool key={keyFor("song")} initial={initialFor("song")} />}
          {shown === "transcript" && <TranscriptTool key={keyFor("transcript")} initial={initialFor("transcript")} />}
          {shown === "beats" && <BeatMakerTool />}
          {shown === "theory" && <TheoryTool />}
          {shown === "progressions" && <ProgressionTool />}
          {shown === "changes" && <ChangesTool />}
        </Suspense>

        {tool && (
          <>
            {shown && <NextSteps tool={tool} onOpen={go} />}
            <SiteFooter onOpen={go} onFeedback={openFeedback} />
          </>
        )}
      </ErrorBoundary>
    </AppShell>
  );
}

export default function App() {
  const { loading } = useAuth();
  const theme = useTheme();

  if (loading) {
    return (
      <main className="auth-screen" data-theme={theme.resolved}>
        <div className="auth-loading" role="status">
          <span className="brand-mark">
            <LogoGlyph />
          </span>
          <strong>טוען את הסטודיו…</strong>
        </div>
      </main>
    );
  }

  return <WorkspaceApp />;
}
