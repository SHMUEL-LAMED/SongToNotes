/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GPU_API_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module "virtual:basic-pitch-model" {
  export const modelJson: string;
  export const modelWeightsBase64: string;
}
