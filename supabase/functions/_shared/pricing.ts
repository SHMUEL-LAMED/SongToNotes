/**
 * How much of a price each piece of server work is — pure arithmetic, with no
 * imports, so the site's own tests check it and the page's estimates
 * (src/lib/credits.ts) can be held to the same numbers.
 *
 * The prices themselves live in public.credit_settings; these say how many
 * times the price applies ("units").
 */

/** Characters of language-model text work in one unit of the "text" price. */
export const TEXT_UNIT_CHARS = 10_000;
/** Characters read into an MP3 in one unit of the "tts" price. */
export const TTS_UNIT_CHARS = 1_000;

/**
 * Minutes of transcription a window adds to the day, rounded up once for the
 * whole day rather than once per window: the first second of a minute pays for
 * it, and the rest of that minute is already paid. `heardBefore` is how much
 * audio the account had transcribed today before this window.
 */
export function minutesCrossed(heardBefore: number, seconds: number) {
  const before = Math.max(0, heardBefore);
  const after = before + Math.max(0, seconds);
  return Math.max(0, Math.ceil(after / 60) - Math.ceil(before / 60));
}

/** Language-model text work: a unit for every 10,000 characters, at least one. */
export function textUnits(characters: number) {
  return Math.max(1, Math.ceil(Math.max(0, characters) / TEXT_UNIT_CHARS));
}

/** An MP3 from text: a unit for every 1,000 characters, at least one. */
export function ttsUnits(characters: number) {
  return Math.max(1, Math.ceil(Math.max(0, characters) / TTS_UNIT_CHARS));
}
