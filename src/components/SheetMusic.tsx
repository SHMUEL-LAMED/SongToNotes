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
  // The staff is drawn in currentColor; the standalone file has no page to
  // inherit it from, so the ink is pinned here.
  clone.setAttribute("color", "#10141f");
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

/**
 * Opens the staff alone in a print window. Printing the page itself would
 * carry the whole interface onto the paper; this way the visitor gets a clean
 * sheet, and "save as PDF" in the print dialog gives them a PDF for free.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function printSheet(svg: SVGSVGElement | null, title: string) {
  const markup = sheetToSvg(svg);
  if (!markup) return false;
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;inset:0;width:0;height:0;border:0;opacity:0";
  document.body.appendChild(frame);
  const doc = frame.contentDocument;
  if (!doc) {
    frame.remove();
    return false;
  }
  doc.open();
  doc.write(
    `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>` +
      `<style>@page{margin:14mm}body{margin:0;font-family:system-ui,sans-serif}` +
      `h1{font-size:16pt;margin:0 0 10mm;text-align:center}svg{width:100%;height:auto}</style>` +
      `</head><body><h1>${title}</h1>${markup}</body></html>`,
  );
  doc.close();
  const win = frame.contentWindow;
  if (!win) {
    frame.remove();
    return false;
  }
  // The print dialog is modal, so the frame can go as soon as it returns.
  win.addEventListener("afterprint", () => frame.remove());
  window.setTimeout(() => {
    win.focus();
    win.print();
    window.setTimeout(() => frame.remove(), 60_000);
  }, 120);
  return true;
}
