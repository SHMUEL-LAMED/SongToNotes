import type { ReactNode } from "react";
import { useIdleOffscreen } from "../lib/useIdleOffscreen";

/**
 * The head of a section on the home page: a beam of light falling from the
 * section above onto a small label, then the title. The beams are what tie
 * the page together under the hero, so every section starts with one.
 */
export function SectionHead({
  id,
  eyebrow,
  title,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  children?: ReactNode;
}) {
  const idle = useIdleOffscreen<HTMLElement>();
  return (
    <header className="aura-head" ref={idle}>
      <span className="aura-beam" aria-hidden="true" />
      <span className="aura-eyebrow">
        <span className="aura-eyebrow-dot" aria-hidden="true" />
        {eyebrow}
      </span>
      <h2 id={id}>{title}</h2>
      {children}
    </header>
  );
}
