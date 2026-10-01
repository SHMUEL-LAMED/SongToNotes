/**
 * One stop of a guided tour: a bubble that points at a part of the page and
 * says what it is for.
 */
export type TourStep = {
  /**
   * What the step points at, as a CSS selector. Several can be given,
   * comma-separated, and the first one visible on screen is used. A step
   * whose target is not on screen — nothing picked yet, a panel that opens
   * later — is shown in the middle of the screen instead, so what it explains
   * is never lost. Without a target at all, the step is centred.
   */
  target?: string;
  title: string;
  text: string;
  /** Leave the step out, rather than centre it, when its target is not on screen. */
  optional?: boolean;
};
