import { Download, MicVocal, Sparkles, Wand2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AudioPicker, useAudioFile } from "../components/AudioPicker";
import { Transport } from "../components/Transport";
import { channelsToBuffer, normalise } from "../lib/dsp";
import { downloadFile, safeFilename } from "../lib/export";
import { separateStems, type SeparatedStems, type SeparationProgress } from "../lib/stemSeparation";
import { encodeWav } from "../lib/wav";

type Mode = "instrumental" | "vocals";

function sharedContext() {
  const Context = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  return Context ? new Context() : null;
}

export function VocalsTool() {
  const { audio, error, setError, isLoading, load, clear } = useAudioFile();
  const [mode, setMode] = useState<Mode>("instrumental");
  const [stems, setStems] = useState<SeparatedStems | null>(null);
  const [progress, setProgress] = useState<SeparationProgress | null>(null);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [context] = useState(sharedContext);

  useEffect(() => () => void context?.close(), [context]);

  const rendered = useMemo(() => {
    if (!context || !stems) return null;
    const source = stems[mode].map((channel) => channel.slice()) as [Float32Array, Float32Array];
    normalise(source, 0.95);
    return channelsToBuffer(context, source, stems.sampleRate);
  }, [context, mode, stems]);

  const processAudio = async () => {
    if (!audio || progress) return;
    setProcessingError(null);
    try {
      const result = await separateStems(audio.buffer, setProgress);
      setStems(result);
      setProgress(null);
    } catch (cause) {
      console.error(cause);
      setProgress(null);
      setProcessingError("הפרדת ה־AI נכשלה. נסה שוב ב־Chrome מעודכן והשאר את הכרטיסייה פתוחה בזמן העיבוד.");
    }
  };

  const exportWav = () => {
    if (!rendered || !audio) return;
    const channels = Array.from({ length: rendered.numberOfChannels }, (_, index) => rendered.getChannelData(index));
    const blob = encodeWav({ channels, sampleRate: rendered.sampleRate });
    const base = safeFilename(audio.file.name.replace(/\.[^/.]+$/, ""));
    downloadFile(blob, `${base}-${mode === "instrumental" ? "instrumental" : "vocals"}.wav`, "audio/wav");
  };

  return (
    <section className="tool-body vocals-tool">
      <div className="tool-intro">
        <span className="tool-intro-icon"><MicVocal size={26} /></span>
        <div>
          <h1>הפרדת שירה ומוזיקה ב־AI</h1>
          <p>מודל Demucs מפריד את השיר לערוצים אמיתיים. אפשר לקבל מוזיקה בלבד בלי הזמר, או שירה בלבד בלי כלי הנגינה.</p>
        </div>
      </div>

      <div className="workspace-card">
        <AudioPicker
          audio={audio}
          isLoading={isLoading}
          onPick={(file) => {
            setError(null);
            setStems(null);
            setProgress(null);
            setProcessingError(null);
            void load(file);
          }}
          onClear={() => {
            setStems(null);
            setProgress(null);
            setProcessingError(null);
            clear();
          }}
          hint="העיבוד מתבצע במכשיר שלך; השיר אינו עולה לשרת"
        />
        {(error || processingError) && <div className="error-message" role="alert">{error || processingError}</div>}

        {audio && !stems && !progress && (
          <div className="downloads-card">
            <div>
              <span className="download-icon"><Sparkles size={22} /></span>
              <div>
                <h3>הפרדה אמיתית בעזרת AI</h3>
                <p>בהפעלה הראשונה יורד מודל בגודל כ־172MB. לאחר מכן מתחיל עיבוד כל השיר.</p>
              </div>
            </div>
            <div className="download-buttons">
              <button onClick={() => void processAudio()} type="button"><Wand2 size={17} /> התחל הפרדה</button>
            </div>
          </div>
        )}

        {progress && (
          <div className="processing-box" role="status">
            <div className="processing-top">
              <span><Wand2 size={18} /> {progress.message}</span>
              <b>{Math.round(progress.progress * 100)}%</b>
            </div>
            <div className="progress-track"><div style={{ width: `${Math.max(2, progress.progress * 100)}%` }} /></div>
          </div>
        )}

        {stems && (
          <>
            <div className="settings-panel">
              <div className="setting-field">
                <span>מה להשאיר?</span>
                <div className="segmented-control">
                  <button className={mode === "instrumental" ? "active" : ""} onClick={() => setMode("instrumental")} type="button">מוזיקה בלבד — בלי שירה</button>
                  <button className={mode === "vocals" ? "active" : ""} onClick={() => setMode("vocals")} type="button">שירה בלבד — בלי מוזיקה</button>
                </div>
              </div>
            </div>
            <Transport buffer={rendered} label={mode === "instrumental" ? "השמע מוזיקה בלבד" : "השמע שירה בלבד"} />
            <div className="downloads-card">
              <div>
                <span className="download-icon"><Download size={22} /></span>
                <div><h3>הורדת התוצאה</h3><p>קובץ WAV באיכות מלאה של הערוץ שבחרת.</p></div>
              </div>
              <div className="download-buttons">
                <button onClick={exportWav} type="button" disabled={!rendered}><Download size={17} /> הורד WAV</button>
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
