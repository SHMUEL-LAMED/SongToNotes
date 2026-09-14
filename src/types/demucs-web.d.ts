declare module "demucs-web" {
  export type DemucsStem = { left: Float32Array; right: Float32Array };
  export type DemucsResult = {
    drums: DemucsStem;
    bass: DemucsStem;
    other: DemucsStem;
    vocals: DemucsStem;
  };
  export const CONSTANTS: { DEFAULT_MODEL_URL: string; SAMPLE_RATE: number };
  export class DemucsProcessor {
    onProgress: (info: { progress: number; currentSegment: number; totalSegments: number }) => void;
    constructor(options: {
      ort: typeof import("onnxruntime-web");
      sessionOptions?: Record<string, unknown>;
      onProgress?: (info: { progress: number; currentSegment: number; totalSegments: number }) => void;
      onDownloadProgress?: (loaded: number, total: number) => void;
      onLog?: (phase: string, message: string) => void;
    });
    loadModel(pathOrBuffer?: string | ArrayBuffer): Promise<void>;
    separate(left: Float32Array, right: Float32Array): Promise<DemucsResult>;
  }
}
