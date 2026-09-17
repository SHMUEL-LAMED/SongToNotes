import { Share2 } from "lucide-react";
import { useState } from "react";
import { canShareFiles, shareFile } from "../lib/export";

type Props = {
  /** Built lazily: rendering the file for every keystroke would be wasteful. */
  build: () => File | null;
  title: string;
  label?: string;
  hint?: string;
};

/**
 * Hands the finished file to another app — WhatsApp, AirDrop, the files
 * app — instead of dropping it in the download folder. Phones are where these
 * tools are used most and where a plain download is hardest to find again, so
 * this sits beside the download button wherever the site produces a file.
 *
 * The button renders only where the browser can actually share a file, which
 * it can only answer for a real File, so support is probed with a tiny stand-in
 * of the same type rather than by rendering the whole export up front.
 */
export function ShareButton({ build, title, label = "שתף", hint }: Props) {
  const [supported] = useState(() =>
    canShareFiles(new File([new Uint8Array(1)], "probe.wav", { type: "audio/wav" })),
  );
  const [state, setState] = useState<"idle" | "sharing" | "failed">("idle");

  if (!supported) return null;

  return (
    <button
      type="button"
      className="share-button"
      disabled={state === "sharing"}
      onClick={() => {
        const file = build();
        if (!file) return;
        setState("sharing");
        void shareFile(file, title).then((outcome) => {
          setState(outcome === "failed" ? "failed" : "idle");
        });
      }}
    >
      <Share2 size={17} />
      <span>
        {state === "failed" ? "השיתוף נכשל — נסה שוב" : label}
        {hint && <small>{hint}</small>}
      </span>
    </button>
  );
}
