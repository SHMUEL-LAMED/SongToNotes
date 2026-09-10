import { ArrowRight, Download, Music2, Pause, Play, UploadCloud } from "lucide-react";
import { useRef, useState } from "react";
type Props = { onBack: () => void };
export function RingtoneStudio({ onBack }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [start, setStart] = useState(0);
  const [length, setLength] = useState(30);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  function select(candidate?: File) {
    if (!candidate || !candidate.type.startsWith("audio/")) return;
    if (url) URL.revokeObjectURL(url);
    setFile(candidate); setUrl(URL.createObjectURL(candidate)); setStart(0);
  }
  function preview() {
    if (!audio.current) return;
    if (playing) { audio.current.pause(); return; }
    audio.current.currentTime = start; void audio.current.play();
    window.setTimeout(() => audio.current && audio.current.currentTime >= start + length - .2 && audio.current.pause(), length * 1000);
  }
  return <main className="ringtone-page">
    <nav className="topbar"><button className="brand brand-button" onClick={onBack} type="button"><span className="brand-mark"><Music2 size={22}/></span><span>כלי מוזיקה</span></button><button className="back-button" onClick={onBack} type="button"><ArrowRight size={18}/> כל האפשרויות</button></nav>
    <section className="ringtone-hero"><span>יצירת צלצולים</span><h1>השיר שלך.<br/><b>הצלצול שלך.</b></h1><p>בחר שיר, סמן קטע והורד צלצול מוכן לפלאפון.</p></section>
    <section className="ringtone-card">{!file ? <button className="ringtone-upload" onClick={() => input.current?.click()} type="button"><UploadCloud size={36}/><strong>גרור לכאן שיר או לחץ לבחירה</strong><span>MP3, WAV, M4A, OGG ועוד</span></button> : <><strong>{file.name}</strong><audio ref={audio} src={url} onLoadedMetadata={() => { const value=audio.current?.duration || 0; setDuration(value); setLength(Math.min(30,value)); }} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}/><div className="ringtone-editor"><label>תחילת הקטע<input type="range" min="0" max={Math.max(0,duration-length)} step=".1" value={start} onChange={e => setStart(Number(e.target.value))}/></label><label>אורך הצלצול: {Math.round(length)} שניות<input type="range" min={Math.min(10,duration)} max={Math.min(60,duration)} value={length} onChange={e => setLength(Number(e.target.value))}/></label><div className="ringtone-actions"><button onClick={preview} type="button">{playing ? <Pause size={18}/> : <Play size={18}/>}{playing ? "השהה" : "השמע קטע"}</button><a className="ringtone-download" href={url} download={"צלצול-"+file.name}><Download size={18}/> הורדת השיר</a></div></div></>}</section>
    <input ref={input} hidden type="file" accept="audio/*" onChange={e => select(e.target.files?.[0])}/>
  </main>;
}