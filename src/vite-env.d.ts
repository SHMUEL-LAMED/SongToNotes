/// <reference types="vite/client" />

/** Byte size of the separation model in this build; see vite.config.ts. */
declare const __SEPARATION_MODEL_BYTES__: number;

declare module "virtual:basic-pitch-model" {
  export const modelJson: string;
  export const modelWeightsBase64: string;
}
