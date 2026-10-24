import { Loader2 } from "lucide-react";
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { currentOffer, sendOffer } from "../lib/currentFile";
import { familyOf, findTool } from "../lib/tools";
import "../styles/tool-tabs.css";

/**
 * The tabs of a tool that brings several together. Each tab is a tool with an
 * address of its own, so moving between them is moving between addresses —
 * the back button and a shared link land on the same tab. A song open in one
 * tab comes along to the next when that tab takes songs: switching from
 * converting one file to joining several should not mean choosing it again.
 */
export function ToolTabs({ current }: { current: string }) {
  const [moving, setMoving] = useState<string | null>(null);
  const navRef = useRef<HTMLElement>(null);
  // Where the pill under the chosen tab sits, measured rather than computed:
  // the tabs are not all the same width, and on a phone the strip scrolls.
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null);
  const family = familyOf(current);

  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const measure = () => {
      const active = nav.querySelector<HTMLElement>(".tool-tab.is-active");
      setThumb(active ? { x: active.offsetLeft, w: active.offsetWidth } : null);
    };
    measure();
    // Fonts arriving and the window changing width both move the tabs.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(nav);
    return () => observer?.disconnect();
  }, [current]);

  if (!family) return null;
  const currentTool = findTool(current);

  const open = (id: string) => {
    if (id === current || moving) return;
    const target = findTool(id);
    const offer = currentOffer();
    if (offer && offer.tool === current && target?.quick) {
      setMoving(id);
      void sendOffer(offer, id)
        .catch(() => window.location.assign(`#/${id}`))
        .finally(() => setMoving(null));
      return;
    }
    window.location.assign(`#/${id}`);
  };

  const navStyle = {
    "--accent-hue": currentTool?.hue,
    "--tab-x": thumb ? `${thumb.x}px` : undefined,
    "--tab-w": thumb ? `${thumb.w}px` : undefined,
    "--tab-ready": thumb ? 1 : 0,
  } as CSSProperties;

  return (
    <nav ref={navRef} className={`tool-tabs ${thumb ? "has-thumb" : ""}`} aria-label="חלקי הכלי" style={navStyle}>
      <span className="tool-tabs-thumb" aria-hidden="true" />
      {family.tabs.map((tab) => {
        const tool = findTool(tab.id);
        if (!tool) return null;
        const Icon = tool.icon;
        const active = tab.id === current;
        return (
          <a
            key={tab.id}
            href={`#/${tab.id}`}
            className={`tool-tab ${active ? "is-active" : ""}`}
            aria-current={active ? "page" : undefined}
            style={{ "--accent-hue": tool.hue } as CSSProperties}
            onClick={(event) => {
              // Plain clicks go through `open`, which can carry the song
              // along; a modified click still opens the tab in a new window.
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
              event.preventDefault();
              open(tab.id);
            }}
          >
            {moving === tab.id ? <Loader2 size={16} className="spin" /> : <Icon size={16} />}
            <span>{tab.label}</span>
          </a>
        );
      })}
    </nav>
  );
}
