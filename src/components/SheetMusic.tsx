import { useEffect, useRef } from "react";
import ABCJS from "abcjs";

type SheetMusicProps = {
  abc: string;
  onRendered?: (svg: SVGSVGElement | null) => void;
};

export function SheetMusic({ abc, onRendered }: SheetMusicProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const notify = useRef(onRendered);

  useEffect(() => {
    notify.current = onRendered;
  }, [onRendered]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.replaceChildren();
    ABCJS.renderAbc(container, abc, {
      responsive: "resize",
      add_classes: true,
      paddingtop: 16,
      paddingbottom: 24,
      paddingleft: 8,
      paddingright: 8,
      staffwidth: 740,
      wrap: { preferredMeasuresPerLine: 4, minSpacing: 1.6, maxSpacing: 2.7 },
      format: {
        titlefont: "Heebo, sans-serif 17",
        gchordfont: "Heebo, sans-serif 12",
        tempofont: "Heebo, sans-serif 11",
        composerfont: "Heebo, sans-serif 11",
      },
    });
    notify.current?.(container.querySelector("svg"));
    return () => notify.current?.(null);
  }, [abc]);

  return <div className="sheet-music" ref={containerRef} dir="ltr" />;
}

/**
 * Serialises the rendered staff to a standalone SVG so the sheet can be saved
 * or dropped into a document. Fonts are left as text, which keeps the file
 * small and the notes selectable.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function sheetToSvg(svg: SVGSVGElement | null) {
  if (!svg) return null;
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const background = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "rect",
  );
  background.setAttribute("width", "100%");
  background.setAttribute("height", "100%");
  background.setAttribute("fill", "#ffffff");
  clone.insertBefore(background, clone.firstChild);
  return new XMLSerializer().serializeToString(clone);
}
