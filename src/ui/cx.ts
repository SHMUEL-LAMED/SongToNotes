/** Joins the class names that are set, skipping the false and empty ones. */
export function cx(...parts: Array<string | false | null | undefined | 0>): string {
  return parts.filter(Boolean).join(" ");
}
