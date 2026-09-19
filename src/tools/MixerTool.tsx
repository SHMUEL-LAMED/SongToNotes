import { Download, Headphones, Layers, Pause, Play, Plus, Repeat, Square, Trash2, Volume2, VolumeX } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { formatBytes, validateAudioFile } from "../components/AudioPicker";
import { SaveButton } from "../components/SaveButton";
import { ShareButton } from "../components/ShareButton";
import { Waveform } from "../components/Waveform";
import { buildPeaks, decodeAudioFile, formatTime, type TrimRange } from "../lib/audio";
import { downloadFile, safeFilename } from "../lib/export";
import { handOffTo, hasHandoff, takeHandoffFiles } from "../lib/handoff";
import { MixPlayer, audibleTracks, mixDuration, renderMix, type MixTrack } from "../lib/mixer";
import { useSaveWork } from "../lib/useSaveWork";
import { encodeWav } from "../lib/wav";
import type { SavedWork } from "../lib/works";

const MAX_TRACKS = 8;
const HUES = [20, 200, 300, 120, 45, 260, 340, 170];

type Props = { initial?: SavedWork | null };

/**
 * A mixer and looper: a few files side by side (the voice and the backing
 * track a separation produced, a click, a recording of your own part),
 * each with its own level, pan, mute and solo, played together and looped
 * over a region. The result renders to one WAV, to download or to keep.
 */
export function MixerTool({ initial = null }: Props) {
  const [tracks, setTracks] = useState<MixTrack[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice] = useState<string | null>(initial ? `פתחת „${initial.title}”. הוסף את הערוצים שוב כדי לערבב מחדש.` : null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [loop, setLoop] = useState<TrimRange>(null);
  const [rendering, setRendering] = useState(false);
  const [result, setResult] = useState<{ file: File; url: string } | null>(null);
  const playerRef = useRef<MixPlayer | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const saving = useSaveWork();
  const resetSave = saving.reset;

  useEffect(() => {
    const player = new MixPlayer();
    player.onEnd = () => {
      setPlaying(false);
      setPosition(0);
    };
    playerRef.current = player;
    return () => player.dispose();
  }, []);
  useEffect(() => {
    playerRef.current?.setTracks(tracks);
  }, [tracks]);
  // Stems from the vocal separator, or a file from any tool, arrive as tracks.
  const [handed, setHanded] = useState<File[] | null>(null);
  useEffect(() => {
    if (!hasHandoff()) return;
    // Taking the files empties the hand-off, so the result is kept even when
    // the effect is torn down and re-run (StrictMode does that in development):
    // the second run finds nothing waiting and must not lose the first's files.
    void takeHandoffFiles().then((files) => {
      if (files.length) setHanded(files);
    });
  }, []);
  useEffect(() => {
    playerRef.current?.setLoop(loop);
  }, [loop]);
  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    const tick = () => {
      setPosition(playerRef.current?.currentTime ?? 0);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing]);
  useEffect(() => () => {
    if (result) URL.revokeObjectURL(result.url);
  }, [result]);
  useEffect(() => resetSave(), [resetSave, result]);

  const duration = mixDuration(tracks);
  const longest = useMemo(() => tracks.reduce<MixTrack | null>((best, track) => (!best || track.buffer.duration > best.buffer.duration ? track : best), null), [tracks]);
  const peaks = useMemo(() => (longest ? buildPeaks(longest.buffer) : null), [longest]);

  const addFiles = async (files: FileList | File[] | null) => {
    if (!files) return;
    const list = Array.from(files).slice(0, MAX_TRACKS - tracks.length);
    if (!list.length) {
      setError(`אפשר עד ${MAX_TRACKS} ערוצים.`);
      return;
    }
    setLoading(true);
    setError(null);
    for (const file of list) {
      const problem = validateAudioFile(file);
      if (problem) {
        setError(problem);
        continue;
      }
      try {
        const buffer = await decodeAudioFile(await file.arrayBuffer());
        setTracks((current) => [
          ...current,
          {
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            name: file.name.replace(/\.[^/.]+$/, ""),
            buffer,
            gain: 1,
            pan: 0,
            muted: false,
            solo: false,
            offset: 0,
            color: HUES[current.length % HUES.length],
          },
        ]);
      } catch {
        setError(`לא הצלחנו לפתוח את „${file.name}”.`);
      }
    }
    setLoading(false);
    setResult(null);
  };

  useEffect(() => {
    if (!handed) return;
    const files = handed;
    const timer = window.setTimeout(() => {
      setHanded(null);
      void addFiles(files);
    }, 0);
    return () => window.clearTimeout(timer);
    // The files were taken once; adding them is the whole point of the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handed]);

  const update = (id: string, patch: Partial<MixTrack>) => {
    setTracks((current) => current.map((track) => (track.id === id ? { ...track, ...patch } : track)));
    setResult(null);
  };

  const toggle = () => {
    const player = playerRef.current;
    if (!player) return;
    if (player.isPlaying) {
      player.pause();
      setPlaying(false);
    } else {
      void player.play().then((started) => setPlaying(started));
    }
  };

  const render = async () => {
    if (!tracks.length || rendering) return;
    setRendering(true);
    setError(null);
    try {
      const rendered = await renderMix(tracks, 44_100, loop);
      const channels = [rendered.getChannelData(0), rendered.getChannelData(1)];
      const blob = encodeWav({ channels, sampleRate: rendered.sampleRate });
      const file = new File([blob], `${safeFilename(tracks.map((track) => track.name).join("+").slice(0, 60) || "mix")}-mix.wav`, { type: "audio/wav" });
      setResult((previous) => {
        if (previous) URL.revokeObjectURL(previous.url);
        return { file, url: URL.createObjectURL(file) };
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "הרינדור נכשל.");
    } finally {
      setRendering(false);
    }
  };

  const save = () => {
    if (!result) return;
    void saving.save(
      {
        kind: "mix",
        title: result.file.name.replace(/\.wav$/, ""),
        summary: { tracks: tracks.length, duration: loop ? loop.end - loop.start : duration, bytes: result.file.size },
        payload: { tracks: tracks.map((track) => ({ name: track.name, gain: track.gain, pan: track.pan, muted: track.muted, solo: track.solo, offset: track.offset })), loop },
      },
      result.file,
    );
  };

  const anySolo = tracks.some((track) => track.solo);

  return (
    <section className="tool-body mixer-tool">
      <div className="tool-intro">
        <span className="tool-intro-icon">
          <Layers size={26} />
        </span>
        <div>
          <h1>מיקסר ולופר</h1>
          <p>כמה קבצים יחד — עוצמה ופאן לכל אחד, לולאה על קטע, ומיקס אחד להורדה.</p>
        </div>
      </div>

      <div className="workspace-card">
        <div className="mixer-add">
          <input ref={inputRef} type="file" accept="audio/*,.mp3,.wav,.m4a,.ogg,.flac,.webm" multiple className="native-file-input" onChange={(event) => void addFiles(event.target.files)} aria-label="הוסף ערוצים" disabled={loading || tracks.length >= MAX_TRACKS} />
          <span className="tool-intro-icon">
            <Plus size={22} />
          </span>
          <div>
            <strong>{loading ? "פותח…" : tracks.length ? "הוסף עוד ערוץ" : "הוסף ערוצים"}</strong>
            <small>
              {tracks.length}/{MAX_TRACKS} · למשל השירה והליווי מהסרת שירה, קליק, או הקלטה שלך
            </small>
          </div>
        </div>
        {error && (
          <div className="error-message" role="alert">
            {error}
          </div>
        )}
        {notice && !error && !tracks.length && (
          <div className="notice-message" role="status">
            {notice}
          </div>
        )}

        {tracks.length > 0 && (
          <>
            <div className="mixer-tracks" role="list" aria-label="ערוצים">
              {tracks.map((track) => {
                const audible = audibleTracks(tracks).includes(track);
                return (
                  <div key={track.id} role="listitem" className={`mixer-track ${audible ? "" : "is-silent"}`} style={{ "--track-hue": track.color } as React.CSSProperties}>
                    <div className="mixer-track-head">
                      <input className="mixer-track-name" value={track.name} onChange={(event) => update(track.id, { name: event.target.value })} aria-label="שם הערוץ" dir="auto" />
                      <span className="mixer-track-meta">{formatTime(track.buffer.duration)}</span>
                      <button type="button" className={`mixer-toggle ${track.muted ? "active" : ""}`} onClick={() => update(track.id, { muted: !track.muted })} aria-pressed={track.muted} aria-label={`השתק ${track.name}`} title="השתק">
                        {track.muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
                      </button>
                      <button type="button" className={`mixer-toggle ${track.solo ? "active" : ""}`} onClick={() => update(track.id, { solo: !track.solo })} aria-pressed={track.solo} aria-label={`סולו ${track.name}`} title="סולו">
                        <Headphones size={15} />
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => {
                          setTracks((current) => current.filter((item) => item.id !== track.id));
                          setResult(null);
                        }}
                        aria-label={`הסר את ${track.name}`}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                    <div className="mixer-track-controls">
                      <label>
                        <span>עוצמה {Math.round(track.gain * 100)}%</span>
                        <input type="range" min={0} max={150} value={Math.round(track.gain * 100)} onChange={(event) => update(track.id, { gain: Number(event.target.value) / 100 })} aria-label={`עוצמה של ${track.name}`} />
                      </label>
                      <label>
                        <span>פאן {track.pan === 0 ? "מרכז" : track.pan < 0 ? `שמאל ${Math.round(-track.pan * 100)}` : `ימין ${Math.round(track.pan * 100)}`}</span>
                        <input type="range" min={-100} max={100} value={Math.round(track.pan * 100)} onChange={(event) => update(track.id, { pan: Number(event.target.value) / 100 })} aria-label={`פאן של ${track.name}`} />
                      </label>
                      <label>
                        <span>התחלה {track.offset.toFixed(2)} ש׳</span>
                        <input type="range" min={0} max={Math.max(1, Math.ceil(duration))} step={0.05} value={track.offset} onChange={(event) => update(track.id, { offset: Number(event.target.value) })} aria-label={`התחלה של ${track.name}`} />
                      </label>
                    </div>
                  </div>
                );
              })}
            </div>
            {anySolo && <p className="table-footnote">סולו פעיל: נשמעים רק הערוצים המסומנים באוזניות.</p>}

            {peaks && longest && (
              <Waveform peaks={peaks} duration={duration} trim={loop} onTrimChange={setLoop} cursor={playing ? position : null} selectLabel="לולאה" clearLabel="בטל את הלולאה" emptyLabel="סמן קטע בגל הקול כדי לנגן אותו בלולאה" />
            )}

            <div className="transport">
              <button className="transport-button primary" type="button" onClick={toggle} aria-label={playing ? "השהה" : "נגן"}>
                {playing ? <Pause size={19} /> : <Play size={19} />}
                {playing ? "השהה" : loop ? "נגן בלולאה" : "נגן את המיקס"}
              </button>
              <button
                className="transport-button"
                type="button"
                onClick={() => {
                  playerRef.current?.stop();
                  setPlaying(false);
                  setPosition(0);
                }}
                aria-label="עצור"
              >
                <Square size={16} />
              </button>
              <input className="transport-seek" type="range" min={0} max={Math.max(0.1, duration)} step={0.01} value={Math.min(position, duration)} onChange={(event) => { const time = Number(event.target.value); playerRef.current?.seek(time); setPosition(time); }} aria-label="מיקום הנגינה" />
              <span className="transport-time">
                {formatTime(position)} / {formatTime(duration)}
              </span>
              {loop && (
                <span className="mixer-loop-badge">
                  <Repeat size={13} /> {formatTime(loop.start)}–{formatTime(loop.end)}
                </span>
              )}
            </div>

            <div className="downloads-card">
              <div>
                <span className="download-icon">
                  <Download size={22} />
                </span>
                <div>
                  <h3>המיקס</h3>
                  <p>{loop ? "הקטע המסומן בלבד" : "כל הערוצים יחד"}, כקובץ WAV סטריאו.</p>
                </div>
              </div>
              <div className="download-buttons">
                {!result ? (
                  <button type="button" onClick={() => void render()} disabled={rendering}>
                    <Layers size={17} />
                    <span>
                      {rendering ? "מרנדר…" : "צור מיקס"}
                      <small>WAV</small>
                    </span>
                  </button>
                ) : (
                  <>
                    <button type="button" onClick={() => downloadFile(result.file, result.file.name, result.file.type)}>
                      <Download size={17} />
                      <span>
                        הורד<small>{formatBytes(result.file.size)}</small>
                      </span>
                    </button>
                    <ShareButton build={() => result.file} title={result.file.name} />
                    <button type="button" onClick={() => void handOffTo("convert", result.file, "המיקס")}>
                      <Layers size={17} />
                      <span>
                        ל־MP3<small>דרך ההמרה</small>
                      </span>
                    </button>
                  </>
                )}
              </div>
              {result && <audio controls src={result.url} className="convert-preview" aria-label="האזנה למיקס" />}
              <SaveButton state={saving.state} onSave={save} disabled={!result} label="שמור את המיקס" message={saving.message} />
            </div>
          </>
        )}
      </div>
    </section>
  );
}
