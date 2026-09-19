/**
 * Note names as people type them — "C4", "F#3", "Bb2", "לה4" — to MIDI
 * numbers, for the assistant's requests to play or sound a note.
 */
const LETTERS: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const HEBREW: Record<string, number> = { דו: 0, רה: 2, מי: 4, פה: 5, סול: 7, לה: 9, סי: 11 };

export function parseNoteName(input: string): number | null {
  const text = input.trim();
  if (/^\d{1,3}$/.test(text)) {
    const midi = Number(text);
    return midi >= 0 && midi <= 127 ? midi : null;
  }
  const latin = text.match(/^([A-Ga-g])([#♯b♭]?)(-?\d)?$/);
  if (latin) {
    const base = LETTERS[latin[1].toLowerCase()];
    const accidental = latin[2] === "#" || latin[2] === "♯" ? 1 : latin[2] === "b" || latin[2] === "♭" ? -1 : 0;
    const octave = latin[3] === undefined ? 4 : Number(latin[3]);
    const midi = (octave + 1) * 12 + base + accidental;
    return midi >= 0 && midi <= 127 ? midi : null;
  }
  const hebrew = text.match(/^(דו|רה|מי|פה|סול|לה|סי)([#♯b♭]?)(-?\d)?$/);
  if (hebrew) {
    const accidental = hebrew[2] === "#" || hebrew[2] === "♯" ? 1 : hebrew[2] === "b" || hebrew[2] === "♭" ? -1 : 0;
    const octave = hebrew[3] === undefined ? 4 : Number(hebrew[3]);
    const midi = (octave + 1) * 12 + HEBREW[hebrew[1]] + accidental;
    return midi >= 0 && midi <= 127 ? midi : null;
  }
  return null;
}
