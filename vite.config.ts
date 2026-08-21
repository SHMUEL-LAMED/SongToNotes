import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { viteStaticCopy } from "vite-plugin-static-copy";

export default defineConfig({
  base: "/SongToNotes/",
  plugins: [
    react(),
    viteStaticCopy({
      targets: [
        {
          src: "node_modules/@spotify/basic-pitch/model/*",
          dest: "model",
        },
      ],
    }),
  ],
  build: {
    chunkSizeWarningLimit: 1800,
  },
});

