import {
  BasicPitch,
  addPitchBendsToNoteEvents,
  noteFramesToTime,
  outputToNotesPoly,
  type NoteEventTime,
} from "@spotify/basic-pitch";

export type TranscriptionOptions = {
  sensitivity: number;
};

let engine: BasicPitch | null = null;

function getEngine() {
  if (!engine) {
    const modelUrl = new URL(
      `${import.meta.env.BASE_URL}model/model.json`,
      window.location.href,
    ).href;
    engine = new BasicPitch(modelUrl);
  }
  return engine;
}

export async function transcribeAudio(
  file: File,
  options: TranscriptionOptions,
  onProgress: (progress: number) => void,
): Promise<NoteEventTime[]> {
  const AudioContextClass =
    window.AudioContext ||
    (window as typeof window & { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;

  if (!AudioContextClass) {
    throw new Error("הדפדפן הזה אינו תומך בעיבוד אודיו.");
  }

  onProgress(2);
  const audioContext = new AudioContextClass();

  try {
    const audioBuffer = await audioContext.decodeAudioData(
      await file.arrayBuffer(),
    );
    const frames: number[][] = [];
    const onsets: number[][] = [];
    const contours: number[][] = [];

    onProgress(8);
    await getEngine().evaluateModel(
      audioBuffer,
      (frameBatch, onsetBatch, contourBatch) => {
        frames.push(...frameBatch);
        onsets.push(...onsetBatch);
        contours.push(...contourBatch);
      },
      (progress) => onProgress(8 + Math.round(progress * 82)),
    );

    const normalizedSensitivity = Math.min(
      1,
      Math.max(0, options.sensitivity / 100),
    );
    const onsetThreshold = 0.48 - normalizedSensitivity * 0.25;
    const frameThreshold = 0.38 - normalizedSensitivity * 0.2;

    const noteEvents = outputToNotesPoly(
      frames,
      onsets,
      onsetThreshold,
      frameThreshold,
      5,
      true,
      null,
      null,
      true,
      11,
    );

    const notes = noteFramesToTime(
      addPitchBendsToNoteEvents(contours, noteEvents),
    )
      .filter((note) => note.durationSeconds >= 0.045)
      .sort((a, b) => a.startTimeSeconds - b.startTimeSeconds);

    onProgress(100);
    return notes;
  } catch (error) {
    const message = error instanceof Error ? error.message : "שגיאה לא ידועה";
    throw new Error(`לא הצלחנו לנתח את הקובץ. ${message}`);
  } finally {
    await audioContext.close();
  }
}

