import { Download, Smartphone, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { AudioPicker, useAudioFile, type LoadedAudio } from "../components/AudioPicker";
import { useAuth } from "../lib/auth";
import { Transport } from "../components/Transport";
import { Waveform } from "../components/Waveform";
import { buildPeaks, formatTime, type TrimRange } from "../lib/audio";
import { normalise, channelsToBuffer } from "../lib/dsp";
import { downloadFile, safeFilename } from "../lib/export";
import { saveRingtone } from "../lib/ringtoneHistory";
import { useRenderedAudio } from "../lib/useRenderedAudio";
import { encodeWav } from "../lib/wav";

const DEFAULT_LENGTH = 30;
const MAX_LENGTH = 40;

function sharedContext() {
  const Context =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  return Context ? new Context() : null;
}

/**
 * Cuts a ringtone out of a song. Everything — the trim, the fades and the
 * gain — is rendered into a fresh buffer so the preview and the download
 * are byte-for-byte the same thing.
 */
export function RingtoneTool({ onSaved }: { onSaved: () => void }) {
  const { user } = useAuth();
  const { audio, error, setError, isLoading, load, clear } = useAudioFile();
  const [context] = useState(sharedContext);

  useEffect(() => () => void context?.close(), [context]);

  return (
    <section className="tool-body ringtone-tool">
      <div className="tool-intro">
        <span className="tool-intro-icon">
          <Smartphone size={26} />
        </span>
        <div>
          <h1>יצירת צלצול</h1>
          <p>
            מעלים שיר, מסמנים את הקטע הכי טוב בגל הקול, מוסיפים כניסה ויציאה
            רכות ומורידים. הכול נשאר במכשיר שלך.
          </p>
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
          onClear={clear}
          hint="MP3, WAV, M4A, OGG · הצלצול ייחתך מהקובץ הזה"
        />
        {error && (
          <div className="error-message" role="alert">
            {error}
          </div>
        )}
        {audio && context && (
          // Remounting on a new file is what resets the trim and the fades,
          // so none of that state has to be cleared by hand.
          <RingtoneEditor
            key={audio.url}
            audio={audio}
            context={context}
            userId={user?.id ?? null}
            onSaved={onSaved}
          />
        )}
      </div>
    </section>
  );
}

type EditorProps = {
  audio: LoadedAudio;
  context: AudioContext;
  userId: string | null;
  onSaved: () => void;
};

function RingtoneEditor({ audio, context, userId, onSaved }: EditorProps) {
  const [trim, setTrim] = useState<TrimRange>(() => ({
    // A fresh file starts with the first thirty seconds selected, which is
    // both a sensible ringtone and the iPhone limit.
    start: 0,
    end: Math.min(DEFAULT_LENGTH, audio.buffer.duration),
  }));
  const [fadeIn, setFadeIn] = useState(1);
  const [fadeOut, setFadeOut] = useState(2);
  const [gain, setGain] = useState(100);
  const [normalize, setNormalize] = useState(true);

  const peaks = useMemo(() => buildPeaks(audio.buffer), [audio]);

  const range = useMemo(() => {
    const duration = audio.buffer.duration;
    const start = trim ? Math.max(0, Math.min(trim.start, duration)) : 0;
    const end = trim ? Math.max(start + 0.5, Math.min(trim.end, duration)) : duration;
    return { start, end: Math.min(end, duration) };
  }, [audio, trim]);

  const { buffer: rendered } = useRenderedAudio(
    `${range.start.toFixed(3)}-${range.end.toFixed(3)}-${fadeIn}-${fadeOut}-${gain}-${normalize}`,
    () => {
      const { buffer } = audio;
      const sampleRate = buffer.sampleRate;
      const from = Math.floor(range.start * sampleRate);
      const to = Math.min(buffer.length, Math.ceil(range.end * sampleRate));
      const length = Math.max(1, to - from);
      const inSamples = Math.max(1, Math.min(length / 2, Math.round(fadeIn * sampleRate)));
      const outSamples = Math.max(1, Math.min(length / 2, Math.round(fadeOut * sampleRate)));
      const level = gain / 100;

      const channels = Array.from({ length: buffer.numberOfChannels }, (_, channelIndex) => {
        const source = buffer.getChannelData(channelIndex);
        const output = new Float32Array(length);
        for (let index = 0; index < length; index += 1) {
          let envelope = level;
          if (fadeIn > 0 && index < inSamples) envelope *= index / inSamples;
          if (fadeOut > 0 && index > length - outSamples) {
            envelope *= (length - index) / outSamples;
          }
          output[index] = source[from + index] * envelope;
        }
        return output;
      });
      if (normalize) normalise(channels);
      return channelsToBuffer(context, channels, sampleRate);
    },
  );

  const exportWav = () => {
    if (!rendered) return;
    const channels = Array.from({ length: rendered.numberOfChannels }, (_, index) =>
      rendered.getChannelData(index),
    );
    const blob = encodeWav({ channels, sampleRate: rendered.sampleRate });
    const title = audio.file.name.replace(/\.[^/.]+$/, "");
    downloadFile(blob, `${safeFilename(title)}-ringtone.wav`, "audio/wav");
    // The profile history is a record of what was made, not a copy of the
    // audio: the file itself never leaves the device.
    void saveRingtone(
      {
        title,
        sourceName: audio.file.name,
        startSeconds: range.start,
        durationSeconds: range.end - range.start,
      },
      userId,
    ).then(onSaved);
  };

  const length = range.end - range.start;
  const tooLongForIphone = length > MAX_LENGTH;

  return (
    <>
            <Waveform
              peaks={peaks}
              duration={audio.buffer.duration}
              trim={trim}
              onTrimChange={(next) => setTrim(next)}
              cursor={null}
            />

            <div className="trim-fields">
              <label>
                <span>התחלה</span>
                <input
                  type="number"
                  min={0}
                  max={audio.buffer.duration}
                  step={0.1}
                  value={range ? Number(range.start.toFixed(1)) : 0}
                  onChange={(event) => {
                    const start = Number(event.target.value);
                    setTrim((current) => ({
                      start,
                      end: Math.max(start + 0.5, current?.end ?? start + DEFAULT_LENGTH),
                    }));
                  }}
                />
              </label>
              <label>
                <span>סיום</span>
                <input
                  type="number"
                  min={0}
                  max={audio.buffer.duration}
                  step={0.1}
                  value={range ? Number(range.end.toFixed(1)) : 0}
                  onChange={(event) => {
                    const end = Number(event.target.value);
                    setTrim((current) => ({
                      start: Math.min(current?.start ?? 0, Math.max(0, end - 0.5)),
                      end,
                    }));
                  }}
                />
              </label>
              <div className="trim-length">
                <strong>{formatTime(length)}</strong>
                <span>{tooLongForIphone ? "ארוך מ־40 שנ׳ — לאייפון כדאי לקצר" : "אורך הצלצול"}</span>
              </div>
              <button
                className="secondary-button"
                type="button"
                onClick={() =>
                  setTrim((current) => {
                    const start = current?.start ?? 0;
                    return { start, end: Math.min(audio.buffer.duration, start + DEFAULT_LENGTH) };
                  })
                }
              >
                <Sparkles size={15} /> 30 שניות
              </button>
            </div>

            <div className="settings-panel">
              <div className="settings-grid">
                <label className="setting-field range-field">
                  <span>
                    כניסה רכה (Fade in) <b>{fadeIn.toFixed(1)} שנ׳</b>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={5}
                    step={0.1}
                    value={fadeIn}
                    onChange={(event) => setFadeIn(Number(event.target.value))}
                  />
                </label>
                <label className="setting-field range-field">
                  <span>
                    יציאה רכה (Fade out) <b>{fadeOut.toFixed(1)} שנ׳</b>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={5}
                    step={0.1}
                    value={fadeOut}
                    onChange={(event) => setFadeOut(Number(event.target.value))}
                  />
                </label>
                <label className="setting-field range-field">
                  <span>
                    עוצמה <b>{gain}%</b>
                  </span>
                  <input
                    type="range"
                    min={20}
                    max={200}
                    value={gain}
                    onChange={(event) => setGain(Number(event.target.value))}
                  />
                </label>
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={normalize}
                    onChange={(event) => setNormalize(event.target.checked)}
                  />
                  <span>נרמל עוצמה — הצלצול יישמע חזק וברור</span>
                </label>
              </div>
            </div>

            <Transport buffer={rendered} label="השמע את הצלצול" />

            <div className="downloads-card">
              <div>
                <span className="download-icon">
                  <Download size={22} />
                </span>
                <div>
                  <h3>הורדת הצלצול</h3>
                  <p>
                    קובץ WAV באיכות מלאה. באנדרואיד מעבירים לתיקיית Ringtones;
                    באייפון מייבאים דרך GarageBand או iTunes.
                  </p>
                </div>
              </div>
              <div className="download-buttons">
                <button onClick={exportWav} type="button" disabled={!rendered}>
                  <Smartphone size={17} />
                  <span>
                    WAV<small>{formatTime(length)} · מוכן לטלפון</small>
                  </span>
                </button>
              </div>
            </div>
    </>
  );
}
