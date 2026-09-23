import { useEffect, useRef, useState } from "react";
import "./dj.css";

type Deck = { name: string; url: string } | null;
const clock = (time: number) => Number.isFinite(time) ? `${Math.floor(time / 60)}:${String(Math.floor(time % 60)).padStart(2, "0")}` : "0:00";

export function DjTool() {
  const audio = useRef<(HTMLAudioElement | null)[]>([null, null]);
  const urls = useRef<(string | null)[]>([null, null]);
  const [decks, setDecks] = useState<[Deck, Deck]>([null, null]);
  const [cross, setCross] = useState(50);
  const [levels, setLevels] = useState<[number, number]>([100, 100]);
  const [times, setTimes] = useState<[number, number]>([0, 0]);
  const [durations, setDurations] = useState<[number, number]>([0, 0]);
  const [playing, setPlaying] = useState<[boolean, boolean]>([false, false]);
  const [error, setError] = useState("");

  useEffect(() => {
    audio.current.forEach((player, index) => {
      if (player) player.volume = Math.min(1, Math.max(0, levels[index] / 100 * (index === 0 ? (100 - cross) / 50 : cross / 50)));
    });
  }, [cross, levels, decks]);
  useEffect(() => () => {
    audio.current.forEach((player) => player?.pause());
    urls.current.forEach((url) => { if (url) URL.revokeObjectURL(url); });
  }, []);

  const load = (index: number, file?: File) => {
    if (!file) return;
    if (!file.type.startsWith("audio/") && !/\.(mp3|wav|ogg|m4a|aac|flac|opus)$/i.test(file.name)) {
      setError("בחר קובץ שמע."); return;
    }
    setError("");
    const player = audio.current[index];
    player?.pause();
    if (player) { player.removeAttribute("src"); player.load(); }
    if (urls.current[index]) URL.revokeObjectURL(urls.current[index]);
    const url = URL.createObjectURL(file);
    urls.current[index] = url;
    setDecks((current) => current.map((deck, i) => i === index ? { name: file.name, url } : deck) as [Deck, Deck]);
    setTimes((current) => current.map((value, i) => i === index ? 0 : value) as [number, number]);
    setPlaying((current) => current.map((value, i) => i === index ? false : value) as [boolean, boolean]);
  };
  const toggle = async (index: number) => {
    const player = audio.current[index];
    if (!player || !decks[index]) return;
    if (!player.paused) { player.pause(); return; }
    try { await player.play(); setError(""); } catch { setError("לא ניתן לנגן את הקובץ הזה בדפדפן."); }
  };
  const update = <T,>(setter: React.Dispatch<React.SetStateAction<[T, T]>>, index: number, value: T) =>
    setter((current) => current.map((old, i) => i === index ? value : old) as [T, T]);

  return <section className="dj-tool" dir="rtl">
    <div className="tool-intro"><h1>עמדת די־ג׳יי</h1><p>טען שני שירים, נגן אותם והעבר ביניהם בזמן אמת.</p></div>
    <div className="dj-decks">{([0, 1] as const).map((index) => <div className="dj-deck" key={index}>
      <h2>נגן {index === 0 ? "א׳" : "ב׳"}</h2>
      <label className="dj-upload">{decks[index]?.name || "בחר קובץ שמע"}<input type="file" accept="audio/*,.mp3,.m4a,.wav,.flac,.ogg,.opus" onChange={(event) => { load(index, event.target.files?.[0]); event.target.value = ""; }} /></label>
      <audio ref={(node) => { audio.current[index] = node; }} src={decks[index]?.url} preload="metadata"
        onTimeUpdate={(event) => update(setTimes, index, event.currentTarget.currentTime)}
        onDurationChange={(event) => update(setDurations, index, event.currentTarget.duration)}
        onPlay={() => setPlaying((current) => current.map((value, i) => i === index ? true : value) as [boolean, boolean])} onPause={() => setPlaying((current) => current.map((value, i) => i === index ? false : value) as [boolean, boolean])}
        onEnded={() => setPlaying((current) => current.map((value, i) => i === index ? false : value) as [boolean, boolean])} onError={() => { if (decks[index]) setError(`לא ניתן לפענח את הקובץ בנגן ${index === 0 ? "א׳" : "ב׳"}.`); }} />
      <button type="button" className="dj-play" disabled={!decks[index]} onClick={() => void toggle(index)}>{playing[index] ? "השהה" : "נגן"}</button>
      <label>מיקום בשיר · {clock(times[index])} / {clock(durations[index])}
        <input type="range" min="0" max={Number.isFinite(durations[index]) ? durations[index] || 1 : 1} step="0.1" value={times[index]} disabled={!decks[index]} onChange={(event) => { const player = audio.current[index]; if (player) player.currentTime = Number(event.target.value); }} />
      </label>
      <label>עוצמה · {levels[index]}%<input type="range" min="0" max="100" value={levels[index]} onChange={(event) => update(setLevels, index, Number(event.target.value))} /></label>
    </div>)}</div>
    <div className="dj-cross"><label htmlFor="dj-crossfader">מעבר בין שירים · {cross === 50 ? "שניהם" : cross < 50 ? "יותר א׳" : "יותר ב׳"}</label>
      <div className="dj-cross-row"><span>א׳</span><input id="dj-crossfader" type="range" min="0" max="100" value={cross} onChange={(event) => setCross(Number(event.target.value))} /><span>ב׳</span></div>
      <button type="button" onClick={() => setCross(50)}>מרכז</button>
    </div>
    {error && <p role="alert" className="dj-error">{error}</p>}
    <p className="dj-note">הקבצים מתנגנים מהמכשיר שלך. ניתן לגרור את פס המעבר תוך כדי נגינה.</p>
  </section>;
}
