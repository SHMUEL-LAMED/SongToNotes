import { Download, Repeat, Snail, Wand2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { AudioPicker, useAudioFile } from "../components/AudioPicker";
import { SaveButton } from "../components/SaveButton";
import { ShareButton } from "../components/ShareButton";
import { Transport } from "../components/Transport";
import { Waveform } from "../components/Waveform";
import { buildPeaks, formatTime, type TrimRange } from "../lib/audio";
import { changeSpeedAndPitch, channelsToBuffer } from "../lib/dsp";
import { downloadFile, safeFilename } from "../lib/export";
import { useOfferResult } from "../lib/currentFile";
import { useAssistantTool } from "../lib/useAssistantTool";
import type { StretchRequest, StretchResponse } from "../workers/separate.worker";
import { useSaveWork } from "../lib/useSaveWork";
import { encodeWav } from "../lib/wav";
import type { SavedWork } from "../lib/works";

function sharedContext() {
  const Context =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  return Context ? new Context() : null;
}

const SPEED_PRESETS = [50, 65, 75, 85, 100, 115, 125];

/**
 * The song at a new tempo and pitch, made on a worker. On the page, a
 * three-minute song froze everything — the slider, the cursor, the buttons —
 * for a couple of seconds after every move. The result is keyed to the
 * settings that produced it, like {@link ../lib/useRenderedAudio}, and a
 * worker still busy with settings that have since moved is terminated rather
 * than left to finish first.
 */
function useStretchedAudio(
  key: string,
  source: AudioBuffer | null,
  speed: number,
  semitones: number,
  context: AudioContext | null,
) {
  const [result, setResult] = useState<{ key: string; buffer: AudioBuffer | null }>({
    key: "",
    buffer: null,
  });
  const workerRef = useRef<{ worker: Worker; busy: boolean } | null>(null);
  useEffect(() => () => workerRef.current?.worker.terminate(), []);

  useEffect(() => {
    if (!key || !source || !context) return;
    let cancelled = false;
    const finish = (buffer: AudioBuffer | null) => {
      if (!cancelled) setResult({ key, buffer });
    };
    // The gap debounces a dragged slider, as before.
    const timer = window.setTimeout(() => {
      if (typeof Worker === "undefined") {
        finish(
          channelsToBuffer(context, changeSpeedAndPitch(source, speed, semitones), source.sampleRate),
        );
        return;
      }
      let slot = workerRef.current;
      if (slot?.busy) {
        slot.worker.terminate();
        slot = null;
      }
      if (!slot) {
        slot = {
          worker: new Worker(new URL("../workers/separate.worker.ts", import.meta.url), {
            type: "module",
          }),
          busy: false,
        };
        workerRef.current = slot;
      }
      const current = slot;
      current.busy = true;
      current.worker.onmessage = (event: MessageEvent<StretchResponse>) => {
        current.busy = false;
        const message = event.data;
        finish(
          message.type === "stretched"
            ? channelsToBuffer(context, message.channels, source.sampleRate)
            : null,
        );
      };
      current.worker.onerror = () => {
        // Nothing to play is better than a spinner that never stops.
        current.busy = false;
        current.worker.terminate();
        if (workerRef.current === current) workerRef.current = null;
        finish(null);
      };
      // Copies: the originals belong to the decoded file.
      const channels = Array.from({ length: source.numberOfChannels }, (_, index) =>
        source.getChannelData(index).slice(),
      );
      const request: StretchRequest = {
        type: "stretch",
        jobId: 0,
        channels,
        sampleRate: source.sampleRate,
        speed,
        semitones,
      };
      current.worker.postMessage(
        request,
        channels.map((channel) => channel.buffer),
      );
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // `key` names the song and both dials; the rest follow from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const matches = result.key === key;
  return { buffer: matches ? result.buffer : null, busy: Boolean(key) && !matches };
}

type Props = {
  /** A saved practice version to restore the dials from; the song is asked for again. */
  initial?: SavedWork | null;
};

function readInitial(work: SavedWork | null | undefined) {
  const payload = work?.payload ?? {};
  const loop = payload.loop as { start?: unknown; end?: unknown } | null | undefined;
  return {
    speed:
      typeof payload.speed === "number" ? Math.max(40, Math.min(160, Math.round(payload.speed))) : 75,
    semitones:
      typeof payload.semitones === "number"
        ? Math.max(-12, Math.min(12, Math.round(payload.semitones)))
        : 0,
    loop:
      loop && typeof loop.start === "number" && typeof loop.end === "number" && loop.end > loop.start
        ? { start: loop.start, end: loop.end }
        : null,
  };
}

/**
 * The practice slow-downer: tempo and key as two independent dials, plus a
 * loop drawn straight on the waveform for the passage being learned.
 */
export function SpeedTool({ initial = null }: Props) {
  const { audio, error, setError, isLoading, load, clear } = useAudioFile();
  const [restored] = useState(() => readInitial(initial));
  const [speed, setSpeed] = useState(restored.speed);
  const [semitones, setSemitones] = useState(restored.semitones);
  const [loop, setLoop] = useState<TrimRange>(restored.loop);
  const [cursor, setCursor] = useState(0);
  const [context] = useState(sharedContext);
  const saving = useSaveWork();
  const resetSave = saving.reset;

  // A closed context throws when closed again, which React's development
  // double mount does on the way out — an unhandled rejection every visit.
  useEffect(() => () => {
    if (context && context.state !== "closed") void context.close();
  }, [context]);

  const peaks = useMemo(() => (audio ? buildPeaks(audio.buffer) : null), [audio]);

  const renderKey = audio && context ? `${audio.url}-${speed}-${semitones}` : "";
  useEffect(() => resetSave(), [renderKey, resetSave]);

  const { buffer: rendered, busy } = useStretchedAudio(
    renderKey,
    audio?.buffer ?? null,
    speed / 100,
    semitones,
    context,
  );

  // The loop is drawn in source time; the rendered file is stretched, so the
  // player needs the same region scaled by the speed factor.
  const playerLoop = useMemo(() => {
    if (!loop) return null;
    const factor = 100 / speed;
    return { start: loop.start * factor, end: loop.end * factor };
  }, [loop, speed]);

  const buildFile = () => {
    if (!rendered || !audio) return null;
    const channels = Array.from({ length: rendered.numberOfChannels }, (_, index) =>
      rendered.getChannelData(index),
    );
    const blob = encodeWav({ channels, sampleRate: rendered.sampleRate });
    const base = safeFilename(audio.file.name.replace(/\.[^/.]+$/, ""));
    const suffix = `${speed}pct${semitones ? `${semitones > 0 ? "+" : ""}${semitones}st` : ""}`;
    return new File([blob], `${base}-${suffix}.wav`, { type: "audio/wav" });
  };

  // The slowed (or shifted) song goes on to the next tool; at 100% and no
  // shift it is the same song, so the original is offered instead.
  useOfferResult(
    speed !== 100 || semitones !== 0 ? rendered : null,
    `${safeFilename(audio?.file.name.replace(/\.[^/.]+$/, "") ?? "song")}-${speed}pct${semitones ? `${semitones > 0 ? "+" : ""}${semitones}st` : ""}.wav`,
    () => buildFile()!,
  );

  const exportWav = () => {
    const file = buildFile();
    if (!file) return;
    downloadFile(file, file.name, "audio/wav");
  };

  const saveToProfile = () => {
    const file = buildFile();
    if (!file || !audio || !rendered) return Promise.resolve(null);
    const base = audio.file.name.replace(/\.[^/.]+$/, "");
    return saving.save(
      {
        kind: "speed",
        title: `${base} — ${speed}%${semitones ? ` · ${semitones > 0 ? "+" : ""}${semitones}` : ""}`,
        sourceName: audio.file.name,
        summary: { speed, semitones, duration: rendered.duration, loop },
        payload: { speed, semitones, loop },
      },
      file,
    );
  };

  useAssistantTool("speed", {
    state: () =>
      audio
        ? `מאט ומאיץ: הקובץ „${audio.file.name}” (${formatTime(audio.buffer.duration)}), מהירות ${speed}%, טון ${semitones > 0 ? "+" : ""}${semitones}, ${loop ? `לולאה ${formatTime(loop.start)}–${formatTime(loop.end)}` : "בלי לולאה"}${busy ? "; מעבד את הגרסה" : ""}.`
        : "מאט ומאיץ: לא נבחר קובץ (רק הגולש יכול לבחור קובץ מהמכשיר או להקליט).",
    handlers: {
      "speed.set": ({ speed: nextSpeed, semitones: nextSemitones }) => {
        const done: string[] = [];
        if (typeof nextSpeed === "number") {
          const clamped = Math.max(40, Math.min(160, Math.round(nextSpeed)));
          setSpeed(clamped);
          done.push(`מהירות ${clamped}%`);
        }
        if (typeof nextSemitones === "number") {
          const clamped = Math.max(-12, Math.min(12, Math.round(nextSemitones)));
          setSemitones(clamped);
          done.push(`טון ${clamped > 0 ? "+" : ""}${clamped}`);
        }
        return done.length ? { ok: true, message: done.join(", ") } : { ok: false, message: "לא צוין מה לשנות" };
      },
      "speed.loop": ({ start, end }) => {
        if (!audio) return { ok: false, message: "אין קובץ" };
        if (typeof start !== "number" && typeof end !== "number") {
          setLoop(null);
          return { ok: true, message: "הלולאה בוטלה" };
        }
        const from = Math.max(0, Math.min(audio.buffer.duration, typeof start === "number" ? start : 0));
        const to = Math.max(from + 0.2, Math.min(audio.buffer.duration, typeof end === "number" ? end : audio.buffer.duration));
        setLoop({ start: from, end: to });
        return { ok: true, message: `לולאה ${formatTime(from)}–${formatTime(to)}` };
      },
      "speed.download": () => {
        if (!rendered || busy) return { ok: false, message: audio ? "הגרסה עדיין מתעבדת; נסה שוב בעוד רגע" : "אין קובץ" };
        exportWav();
        return { ok: true, message: "קובץ ה־WAV ירד" };
      },
      "speed.save": async () => {
        if (!rendered || busy) return { ok: false, message: audio ? "הגרסה עדיין מתעבדת" : "אין קובץ" };
        const saved = await saveToProfile();
        return saved ? { ok: true, message: "הגרסה נשמרה באזור האישי" } : { ok: false, message: "השמירה נכשלה" };
      },
      "speed.read": () => ({
        ok: true,
        message: audio ? `${speed}%, ${semitones} חצאי טונים` : "אין קובץ",
        data: { file: audio?.file.name ?? null, duration: audio ? Number(audio.buffer.duration.toFixed(1)) : null, speed, semitones, loop, ready: Boolean(rendered) && !busy },
      }),
    },
  });

  return (
    <section className="tool-body speed-tool">
      <div className="tool-intro">
        <span className="tool-intro-icon">
          <Snail size={26} />
        </span>
        <div>
          <h1>מאט ומאיץ</h1>
          <p>שנה את המהירות והטון של השיר.</p>
        </div>
      </div>

      <div className="workspace-card">
        <AudioPicker
          audio={audio}
          isLoading={isLoading}
          onPick={(file) => {
            setError(null);
            void load(file);
          }}
          onClear={() => {
            setLoop(null);
            clear();
          }}
          allowRecording
        />
        {error && (
          <div className="error-message" role="alert">
            {error}
          </div>
        )}
        {initial && !audio && (
          <div className="notice-message" role="status">
            פתחת „{initial.title}”. המהירות והטון שוחזרו; בחר את השיר שוב כדי
            להפיק את הגרסה מחדש.
          </div>
        )}

        {audio && peaks && (
          <>
            <Waveform
              peaks={peaks}
              duration={audio.buffer.duration}
              trim={loop}
              onTrimChange={setLoop}
              cursor={cursor * (speed / 100)}
              selectLabel="לולאה"
              clearLabel="נגן את כל השיר"
              emptyLabel="סמן קטע בגל הקול כדי לנגן אותו בלולאה"
            />

            <div className="settings-panel">
              <div className="settings-grid">
                <label className="setting-field range-field" data-tour="speed-tempo">
                  <span>
                    מהירות <b>{speed}%</b>
                  </span>
                  <input
                    type="range"
                    min={40}
                    max={160}
                    value={speed}
                    onChange={(event) => setSpeed(Number(event.target.value))}
                  />
                  <div className="preset-row compact" aria-label="מהירויות נפוצות">
                    {SPEED_PRESETS.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        className={speed === preset ? "active" : ""}
                        onClick={() => setSpeed(preset)}
                      >
                        {preset}%
                      </button>
                    ))}
                  </div>
                </label>
                <label className="setting-field range-field" data-tour="speed-pitch">
                  <span>
                    {/* A signed number is its own left-to-right run: on this
                        right-to-left page "-3" otherwise shows as "3-". */}
                    טון <b><bdi dir="ltr">{semitones > 0 ? "+" : ""}{semitones}</bdi> חצאי טונים</b>
                  </span>
                  <input
                    type="range"
                    min={-12}
                    max={12}
                    value={semitones}
                    onChange={(event) => setSemitones(Number(event.target.value))}
                  />
                  <small>הקצב נשאר; רק הגובה משתנה.</small>
                </label>
              </div>
            </div>

            {/* The player stays mounted while a new version renders, so a
                dragged slider does not tear down its audio context and the
                playback carries on in the new version from the same bar. */}
            {busy && (
              <div className="processing-box">
                <div className="processing-top">
                  <span>
                    <Wand2 size={18} /> מעבד את השיר…
                  </span>
                </div>
                <div className="progress-track indeterminate">
                  <div />
                </div>
              </div>
            )}
            <Transport
              buffer={rendered}
              loop={playerLoop}
              label={loop ? "נגן את הלולאה" : "נגן"}
              onTime={setCursor}
              keepRelativePosition
            />
            {loop && (
              <p className="table-footnote">
                <Repeat size={14} /> הלולאה{" "}
                <bdi dir="ltr">
                  {formatTime(loop.start)}–{formatTime(loop.end)}
                </bdi>{" "}
                תנוגן שוב ושוב ב־{speed}% מהמהירות המקורית.
              </p>
            )}

            <div className="downloads-card">
              <div>
                <span className="download-icon">
                  <Download size={22} />
                </span>
                <div>
                  <h3>הורדת הגרסה המעובדת</h3>
                  <p>השיר במהירות ובטון שבחרת.</p>
                </div>
              </div>
              <div className="download-buttons">
                <button onClick={exportWav} type="button" disabled={!rendered || busy}>
                  <Snail size={17} />
                  <span>
                    WAV<small>{speed}% · <bdi dir="ltr">{semitones > 0 ? "+" : ""}{semitones}</bdi> חצאי טונים</small>
                  </span>
                </button>
                <ShareButton build={buildFile} title="גרסה לתרגול" />
              </div>
              <SaveButton
                state={saving.state}
                onSave={() => void saveToProfile()}
                disabled={!rendered || busy}
                message={saving.message}
              />
            </div>
          </>
        )}
      </div>
    </section>
  );
}
