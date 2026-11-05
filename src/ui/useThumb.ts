import { useLayoutEffect, type RefObject } from "react";

/**
 * Places a thumb (the segmented control's pill, the tabs' underline) under
 * the selected item of a group, measured rather than computed: the items are
 * not all the same width, they wrap or scroll on a phone, and the font may
 * arrive after the first paint. The position is written straight onto the
 * thumb as custom properties (`--{prefix}-x/-y/-w/-h`) and the group is
 * marked with data attributes React does not manage, so measuring never
 * re-renders anything. `data-thumb` says the thumb is placed;
 * `data-moved` is added from the second placement on, so the first one does
 * not slide in from the corner.
 */
export function useThumb(
  groupRef: RefObject<HTMLElement | null>,
  thumbRef: RefObject<HTMLElement | null>,
  selector: string,
  prefix: "seg" | "tab",
  selected: unknown,
) {
  useLayoutEffect(() => {
    const group = groupRef.current;
    const thumb = thumbRef.current;
    if (!group || !thumb) return;
    let placed = false;
    const place = () => {
      const target = group.querySelector<HTMLElement>(selector);
      if (!target) {
        delete group.dataset.thumb;
        return;
      }
      // offsetLeft/offsetTop are physical, from the group's padding edge;
      // the stylesheet places the thumb from the physical left to match.
      thumb.style.setProperty(`--${prefix}-x`, `${target.offsetLeft}px`);
      thumb.style.setProperty(`--${prefix}-y`, `${target.offsetTop}px`);
      thumb.style.setProperty(`--${prefix}-w`, `${target.offsetWidth}px`);
      thumb.style.setProperty(`--${prefix}-h`, `${target.offsetHeight}px`);
      if (placed) group.dataset.moved = "";
      group.dataset.thumb = "";
      placed = true;
    };
    place();
    // Fonts arriving and the window changing width both move the items.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    observer?.observe(group);
    group.querySelectorAll<HTMLElement>(":scope > button, :scope > a").forEach((item) => observer?.observe(item));
    return () => observer?.disconnect();
  }, [groupRef, thumbRef, selector, prefix, selected]);
}
