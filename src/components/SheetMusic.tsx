import { useEffect, useRef } from "react";
import ABCJS from "abcjs";

type SheetMusicProps = {
  abc: string;
};

export function SheetMusic({ abc }: SheetMusicProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.replaceChildren();
    ABCJS.renderAbc(containerRef.current, abc, {
      responsive: "resize",
      add_classes: true,
      staffwidth: 980,
      paddingtop: 20,
      paddingbottom: 20,
      wrap: { preferredMeasuresPerLine: 4, minSpacing: 1.6, maxSpacing: 2.8 },
    });
  }, [abc]);

  return <div className="sheet-music" ref={containerRef} dir="ltr" />;
}
