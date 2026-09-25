import { Disc3, ExternalLink, FileAudio, LogIn, Mic, Play, RefreshCw, Search, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { validateAudioFile } from "../components/AudioPicker";
import { CreditCost } from "../components/CreditCost";
import { AiError, findSongVideo, identifyAvailability, type Identification } from "../lib/aiApi";
import { decodeAudioFile } from "../lib/audio";
import { useAuth } from "../lib/auth";
import { useCredits } from "../lib/creditsContext";
import { handOffTo } from "../lib/handoff";
import { historyFromWorks, pushSong, sameSong, songOfWork, workForSong, HISTORY_SIZE, type FoundSong } from "../lib/identifyHistory";
import { MIC_SECONDS, fileClipStarts, identifyClip, newSession, renderClip, soundStart } from "../lib/identifyClips";
import { MicRecorder, isRecordingSupported } from "../lib/record";
import { findTool } from "../lib/tools";
import { useAssistantTool } from "../lib/useAssistantTool";
import { listLocalWorks, listWorks, saveWork, type SavedWork } from "../lib/works";
import { LISTENING, PLAYER_HOSTS, isVideoError, playerMessage, youtubeEmbedUrl, youtubeStillUrl, youtubeVideoId } from "../lib/youtube";

/** A message shown while a further clip of the same song is tried. */
const TRYING_ANOTHER = "מנסה קטע נוסף…";

/**
 * Failures a further clip cannot fix — no account, no allowance left, the
 * service refusing the site's key or out of its own allowance. Any other
 * failure of one clip just moves on to the next, without a word.
 */
const STOP_CODES = new Set(["signed_out", "quota", "credits", "not_configured", "provider_key", "provider_busy", "session_limit"]);

/** Where the last identification came from, so "try another part" can go on from it. */
type Source = { kind: "file"; file: File; buffer: AudioBuffer; round: number } | { kind: "mic" };

/** Where a file identified here can go next, whole, with one click. */
const NEXT_TOOLS = ["chords", "lyrics", "notes"];

/** ▶ YouTube: the song's own video, straight from the server; nothing when it found none. */
export function YouTubeLink({ href }: { href?: string | null }) {
  if (!href) return null;
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className="chip-toggle identify-youtube">
      {/* Left to right on the Hebrew page too, so the play mark comes before the name. */}
      <span dir="ltr">
        <span aria-hidden="true">▶</span> YouTube
      </span>
    </a>
  );
}

/**
 * Videos asked for again on this visit, by song page: one request each,
 * however often the identifier opens. A lookup that failed counts as none.
 */
const videoLookups = new Map<string, Promise<string | null>>();
function lookUpVideo(page: string) {
  let pending = videoLookups.get(page);
  if (!pending) {
    pending = findSongVideo(page).catch(() => null);
    videoLookups.set(page, pending);
  }
  return pending;
}

/** How long a player may take to answer before the next address is tried. */
const PLAYER_READY_MS = 8000;

type PlayerPhase = "still" | "trying" | "failed";

/**
 * The song's video, played inside the result. Until the visitor presses play
 * it is only the video's still, so the player loads when it is wanted.
 *
 * The player then has to answer: YouTube's player tells the page it is ready,
 * or that the video cannot play. One that stays silent — a filter's block
 * page in its place, a network that drops it — or that reports an error, gives
 * way to the next address; when none works, or the video allows no player
 * outside YouTube, the frame says so and offers the video on YouTube itself.
 */
export function YouTubePlayer({ href, title }: { href?: string | null; title: string }) {
  const [phase, setPhase] = useState<PlayerPhase>("still");
  const [attempt, setAttempt] = useState(0);
  // A still that does not load (blocked, offline) leaves the black frame and its play button.
  const [stillFailed, setStillFailed] = useState(false);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const id = youtubeVideoId(href);

  useEffect(() => {
    if (phase !== "trying") return;
    const frame = frameRef.current;
    const host = PLAYER_HOSTS[attempt];
    let answered = false;
    const giveWay = () => {
      if (attempt + 1 < PLAYER_HOSTS.length) setAttempt(attempt + 1);
      else setPhase("failed");
    };
    const onMessage = (event: MessageEvent) => {
      if (!frame || event.source !== frame.contentWindow) return;
      const message = playerMessage(event.data);
      if (!message) return;
      if (message.event === "onError") {
        if (isVideoError(message.info)) setPhase("failed");
        else giveWay();
        return;
      }
      // Any report at all: the player is there.
      if (!answered) {
        answered = true;
        window.clearInterval(knock);
        window.clearTimeout(deadline);
      }
    };
    window.addEventListener("message", onMessage);
    // The player starts reporting once told that someone listens; only to its own address.
    const knock = window.setInterval(() => frame?.contentWindow?.postMessage(LISTENING, `https://${host}`), 250);
    const deadline = window.setTimeout(() => {
      if (!answered) giveWay();
    }, PLAYER_READY_MS);
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearInterval(knock);
      window.clearTimeout(deadline);
    };
  }, [attempt, phase]);

  if (!id) return null;
  const play = () => {
    setAttempt(0);
    setPhase("trying");
  };
  return (
    <div className="identify-video">
      {phase === "trying" ? (
        <iframe
          key={attempt}
          ref={frameRef}
          src={youtubeEmbedUrl(id, { host: PLAYER_HOSTS[attempt], origin: window.location.origin })}
          title={title}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
        />
      ) : phase === "failed" ? (
        <div className="identify-video-failed" role="status">
          <strong>הסרטון לא נפתח כאן</strong>
          <p>ברשת מסוננת (כמו נטפרי) ייתכן שהסרטון עוד לא אושר, ובדף שלו ב־YouTube אפשר לבקש לאשר אותו.</p>
          <div className="identify-video-actions">
            <a href={href ?? undefined} target="_blank" rel="noreferrer noopener" className="primary-button compact">
              <ExternalLink size={16} /> לצפייה ב־YouTube
            </a>
            <button type="button" className="secondary-button compact" onClick={play}>
              <RefreshCw size={15} /> לנסות שוב
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="identify-video-still" onClick={play} aria-label={`נגן כאן: ${title}`}>
          {!stillFailed && <img src={youtubeStillUrl(id)} alt="" onError={() => setStillFailed(true)} />}
          <span aria-hidden="true">
            <Play size={30} />
          </span>
        </button>
      )}
    </div>
  );
}

/**
 * What song is this? Twenty seconds from the microphone, or up to three
 * clips of a file — its start, about 35% and about 65% — go one by one to a
 * recognition service on the server until one is recognised; back come the
 * title, the artist and where to listen. The service's key stays on the
 * server, and one identification is charged once, however many clips it took.
 */
export function IdentifyTool({ initial = null }: { initial?: SavedWork | null } = {}) {
  const { user, signInWithGoogle } = useAuth();
  const { rules: creditRules } = useCredits();
  const userId = user?.id ?? null;
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [recorder] = useState(() => new MicRecorder());
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A song opened from the personal area shows as the result.
  const [result, setResult] = useState<Identification | null>(() => (initial ? songOfWork(initial) : null));
  // Every clip was tried and none was recognised: offer another part.
  const [exhausted, setExhausted] = useState(false);
  const [source, setSource] = useState<Source | null>(null);
  // "Recently identified": the saved songs (this device's at once, the
  // account's once they arrive), under the ones identified on this visit.
  const [saved, setSaved] = useState<FoundSong[]>(() => historyFromWorks(listLocalWorks()));
  const [identified, setIdentified] = useState<FoundSong[]>([]);
  const history = identified.reduceRight((list, song) => pushSong(list, song), saved).slice(0, HISTORY_SIZE);
  const inputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<number | null>(null);
  // Song pages whose video was already asked for again on this visit, found or not.
  const [videoChecked, setVideoChecked] = useState<ReadonlySet<string>>(() => new Set());

  useEffect(() => {
    if (!userId) return;
    let active = true;
    void listWorks(userId)
      .then((works) => {
        if (active) setSaved(historyFromWorks(works));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [userId]);

  // A song shown without its video — its page on AudD did not answer in time
  // during the identification — gets it asked for again, in the background:
  // the one on screen first, then the recent ones. The player appears when it
  // arrives; a page with no video leaves things as they are.
  const shown = result?.found ? result : null;
  const nextPage = userId
    ? ([...(shown ? [shown] : []), ...history]
        .map((song) => (!song.links.youtube && song.links.song?.startsWith("https://lis.tn/") ? song.links.song : null))
        .find((page): page is string => page !== null && !videoChecked.has(page)) ?? null)
    : null;
  useEffect(() => {
    if (!nextPage) return;
    let active = true;
    const withVideo = (youtube: string) => (item: FoundSong): FoundSong =>
      item.links.song === nextPage && !item.links.youtube ? { ...item, links: { ...item.links, youtube } } : item;
    void lookUpVideo(nextPage).then((youtube) => {
      if (!active) return;
      if (youtube) {
        setResult((current) => (current?.found ? withVideo(youtube)(current) : current));
        setIdentified((list) => list.map(withVideo(youtube)));
        setSaved((list) => list.map(withVideo(youtube)));
      }
      setVideoChecked((current) => new Set(current).add(nextPage));
    });
    return () => {
      active = false;
    };
  }, [nextPage]);

  useEffect(() => {
    const controller = new AbortController();
    void identifyAvailability(controller.signal)
      .then(({ configured: ok }) => setConfigured(ok))
      .catch(() => setConfigured(null));
    return () => controller.abort();
  }, []);
  useEffect(() => () => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    recorder.cancel();
  }, [recorder]);

  /**
   * Sends the clips one after another, until one is recognised. A clip that
   * fails or finds nothing moves on to the next quietly; only a failure no
   * clip can fix is shown. All the clips share one session, charged once.
   */
  const lookup = async (clips: (() => Promise<Blob>)[], sourceName: string | null) => {
    setError(null);
    setResult(null);
    setExhausted(false);
    const session = newSession();
    let last: Identification | null = null;
    let answered = false;
    for (let index = 0; index < clips.length; index += 1) {
      setBusy(index === 0 ? "מזהה…" : TRYING_ANOTHER);
      try {
        const found = await identifyClip(await clips[index](), session);
        answered = true;
        last = found;
        if (found.found) {
          setResult(found);
          setIdentified((current) => pushSong(current, found));
          // Into the personal area, unless it is already among the recent ones.
          if (!historyFromWorks(listLocalWorks()).some((item) => sameSong(item, found))) {
            void saveWork(workForSong(found, sourceName), userId).catch(() => undefined);
          }
          setBusy(null);
          return;
        }
      } catch (caught) {
        if (caught instanceof AiError && STOP_CODES.has(caught.code)) {
          setError(caught.message);
          setBusy(null);
          return;
        }
        // Any other failure of one clip: on to the next.
      }
    }
    setResult(last);
    setExhausted(true);
    if (!answered) setError("לא הצלחנו לזהות את השיר כרגע. אפשר לנסות שוב בקטע אחר.");
    setBusy(null);
  };

  const fileRound = async (file: File, buffer: AudioBuffer, round: number) => {
    setSource({ kind: "file", file, buffer, round });
    const starts = fileClipStarts(buffer, round);
    await lookup(starts.map((start) => () => renderClip(buffer, start)), file.name);
  };

  const startListening = async () => {
    setError(null);
    setResult(null);
    setExhausted(false);
    try {
      await recorder.start();
      setRecording(true);
      setSeconds(0);
      timerRef.current = window.setInterval(() => {
        setSeconds(recorder.elapsed);
        setLevel(recorder.level);
        if (recorder.elapsed >= MIC_SECONDS) void stopListening();
      }, 100);
    } catch (caught) {
      setError(caught instanceof Error && caught.name === "NotAllowedError" ? "לא ניתנה גישה למיקרופון. אפשר לאשר אותה בהגדרות הדפדפן." : "לא הצלחנו להתחיל להאזין.");
    }
  };

  const stopListening = async () => {
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    setRecording(false);
    try {
      const blob = await recorder.stop();
      setBusy("מכין את הקטע…");
      const buffer = await decodeAudioFile(await blob.arrayBuffer());
      setSource({ kind: "mic" });
      // The whole recording, from where the sound starts: up to 20 seconds.
      const start = soundStart(buffer.getChannelData(0), buffer.sampleRate);
      await lookup([() => renderClip(buffer, start, MIC_SECONDS)], null);
    } catch {
      setError("ההאזנה נכשלה. נסה שוב.");
      setBusy(null);
    }
  };

  /** "Try another part": the next places in the same file, or a fresh listen. */
  const tryAnother = async () => {
    if (!source) return;
    if (source.kind === "file") {
      await fileRound(source.file, source.buffer, source.round + 1);
    } else {
      await startListening();
    }
  };

  const fromFile = async (file?: File | null) => {
    if (!file) return;
    const problem = validateAudioFile(file);
    if (problem) {
      setError(problem);
      return;
    }
    setResult(null);
    setExhausted(false);
    setBusy("מכין את הקטע…");
    setError(null);
    try {
      await fileRound(file, await decodeAudioFile(await file.arrayBuffer()), 0);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "לא הצלחנו לקרוא את הקובץ.");
      setBusy(null);
    }
  };

  const recent = history.filter((item) => !(result?.found && sameSong(item, result)));

  useAssistantTool("identify", {
    state: () =>
      `מזהה שיר: ${!user ? "הגולש לא מחובר (הזיהוי דורש חשבון)" : configured === false ? "השירות לא הופעל באתר" : recording ? `מאזין (${Math.ceil(MIC_SECONDS - seconds)} שניות נותרו)` : (busy ?? "מוכן להאזין")}${
        result ? (result.found ? `; זוהה לאחרונה: „${result.title}” של ${result.artist}${result.album ? ` (${result.album})` : ""}` : "; הניסיון האחרון לא זיהה שיר") : ""
      }.`,
    handlers: {
      "identify.listen": async ({ on }) => {
        if (!user) return { ok: false, message: "הזיהוי דורש חשבון מחובר" };
        if (on) {
          if (recording) return { ok: false, message: "כבר מאזין" };
          if (busy) return { ok: false, message: busy };
          if (!isRecordingSupported()) return { ok: false, message: "הדפדפן הזה לא תומך בהקלטה" };
          await startListening();
          return { ok: true, message: `מאזין ${MIC_SECONDS} שניות למה שמתנגן; התוצאה תופיע על המסך` };
        }
        if (!recording) return { ok: false, message: "לא מאזין כרגע" };
        await stopListening();
        return { ok: true, message: "ההאזנה נעצרה והקטע נשלח לזיהוי" };
      },
      "identify.read": () => {
        if (!result) return { ok: false, message: "עדיין לא היה זיהוי" };
        if (!result.found) return { ok: true, message: "לא זוהה שיר בניסיון האחרון", data: { found: false } };
        return {
          ok: true,
          message: `${result.title} — ${result.artist}`,
          data: { found: true, title: result.title, artist: result.artist, album: result.album, releaseDate: result.releaseDate, links: result.links },
        };
      },
    },
  });

  return (
    <section className="tool-body identify-tool">
      <div className="tool-intro">
        <span className="tool-intro-icon">
          <Disc3 size={26} />
        </span>
        <div>
          <h1>מזהה שיר</h1>
          <p>מה השיר הזה? מקליטים כמה שניות, או מעלים קובץ, ומקבלים את השם והאמן. מקובץ נבדקים עד שלושה קטעים שונים.</p>
        </div>
      </div>

      <div className="workspace-card">
        {configured === false && (
          <div className="notice-message" role="status">
            היכולת הזאת עדיין לא הופעלה באתר. מנהל האתר צריך להזין מפתח לשירות.{" "}
            <code dir="ltr">IDENTIFY_API_KEY</code>
          </div>
        )}
        {!user ? (
          <div className="transcript-signin" role="status">
            <p>
              <LogIn size={16} /> הזיהוי נעשה בשרת — צריך להתחבר לחשבון, בחינם.
            </p>
            <button className="primary-button" type="button" onClick={() => signInWithGoogle().catch(() => setError("לא הצלחנו לפתוח את ההתחברות."))}>
              <LogIn size={20} /> התחברות עם Google
            </button>
          </div>
        ) : (
          <div className="identify-actions">
            <button type="button" className={`identify-listen ${recording ? "is-live" : ""}`} onClick={() => (recording ? void stopListening() : void startListening())} disabled={!isRecordingSupported() || busy !== null} aria-pressed={recording}>
              {recording ? <Square size={30} /> : <Mic size={30} />}
              <strong>{recording ? `מאזין… ${Math.ceil(MIC_SECONDS - seconds)}` : busy ?? "האזן למה שמתנגן"}</strong>
              {recording && (
                <div className="level-meter" aria-hidden="true">
                  <div style={{ width: `${Math.round(level * 100)}%` }} />
                </div>
              )}
              {!recording && !busy && <small>כ־{MIC_SECONDS} שניות מהמיקרופון</small>}
            </button>
            <label className="identify-file">
              <input ref={inputRef} type="file" accept="audio/*,video/*" className="native-file-input" onChange={(event) => {
                const file = event.target.files?.[0];
                // Cleared so the same file can be chosen again after a retry.
                event.target.value = "";
                void fromFile(file);
              }} aria-label="בחר קובץ לזיהוי" disabled={busy !== null || recording} />
              <FileAudio size={18} /> או בחר קובץ
            </label>
            <CreditCost cost={creditRules.prices.identify} unit="לכל זיהוי" />
          </div>
        )}
        {busy === TRYING_ANOTHER && (
          <div className="notice-message" role="status" aria-live="polite">
            {TRYING_ANOTHER}
          </div>
        )}
        {error && (
          <div className="error-message" role="alert">
            {error}
          </div>
        )}

        {result && !result.found && (
          <div className="notice-message" role="status">
            {source?.kind === "file" ? "לא זוהה שיר באף אחד מהקטעים שנבדקו." : "לא זוהה שיר בהקלטה. נסה להתקרב לרמקול, או קטע עם שירה ברורה."} נותרו היום {Math.max(0, result.limit - result.used)} זיהויים.
          </div>
        )}
        {exhausted && source && !busy && !recording && (
          <button type="button" className="secondary-button identify-retry" onClick={() => void tryAnother()}>
            <RefreshCw size={16} /> נסה שוב בקטע אחר
          </button>
        )}
        {result && result.found && (
          <div className="identify-result" aria-live="polite">
            {result.artwork && <img src={result.artwork} alt="" className="identify-art" />}
            <div className="identify-text">
              <span className="eyebrow-small">
                <Search size={14} /> זוהה
              </span>
              <h2 dir="auto">{result.title}</h2>
              <p dir="auto">
                {result.artist}
                {result.album ? ` · ${result.album}` : ""}
                {result.releaseDate ? ` · ${result.releaseDate.slice(0, 4)}` : ""}
              </p>
              <div className="identify-links">
                {result.links.spotify && (
                  <a href={result.links.spotify} target="_blank" rel="noreferrer noopener" className="chip-toggle">
                    Spotify <ExternalLink size={12} />
                  </a>
                )}
                {result.links.appleMusic && (
                  <a href={result.links.appleMusic} target="_blank" rel="noreferrer noopener" className="chip-toggle">
                    Apple Music <ExternalLink size={12} />
                  </a>
                )}
                {result.links.deezer && (
                  <a href={result.links.deezer} target="_blank" rel="noreferrer noopener" className="chip-toggle">
                    Deezer <ExternalLink size={12} />
                  </a>
                )}
                <YouTubeLink href={result.links.youtube} />
                {result.links.song && (
                  <a href={result.links.song} target="_blank" rel="noreferrer noopener" className="chip-toggle">
                    עוד <ExternalLink size={12} />
                  </a>
                )}
              </div>
              {/* A song opened from the personal area has no allowance to show (limit 0). */}
              {(result.timecode || result.limit > 0) && (
                <small className="ai-status">
                  {result.timecode ? `הקטע נמצא בדקה ${result.timecode} של השיר${result.limit > 0 ? " · " : ""}` : ""}
                  {result.limit > 0 && <>נותרו היום {Math.max(0, result.limit - result.used)} זיהויים</>}
                </small>
              )}
              {source?.kind === "file" && (
                <div className="identify-next">
                  <span className="eyebrow-small">ממשיכים עם הקובץ</span>
                  <div className="identify-links">
                    {NEXT_TOOLS.map((id) => findTool(id))
                      .filter((tool) => tool !== null)
                      .map((tool) => (
                        <button key={tool.id} type="button" className="chip-toggle" onClick={() => void handOffTo(tool.id, source.file, "הקובץ ממזהה השירים")}>
                          <tool.icon size={14} /> {tool.title}
                        </button>
                      ))}
                  </div>
                </div>
              )}
            </div>
            <YouTubePlayer key={result.links.youtube ?? ""} href={result.links.youtube} title={[result.title, result.artist].filter(Boolean).join(" — ")} />
          </div>
        )}

        {recent.length > 0 && (
          <div className="identify-history">
            <span className="eyebrow-small">זוהו לאחרונה</span>
            <ul>
              {recent.map((item, index) => (
                <li key={index}>
                  <span dir="auto">
                    {item.title} — {item.artist}
                  </span>
                  <YouTubeLink href={item.links.youtube} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
