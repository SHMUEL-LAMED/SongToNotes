import { Cable } from "lucide-react";
import type { MidiState } from "../lib/midiInput";

/** The connect button and a line saying what is plugged in. */
export function MidiButton({ midi }: { midi: MidiState }) {
  if (!midi.supported) return null;
  const label = midi.connected
    ? midi.devices.length
      ? `MIDI: ${midi.devices.join(", ")}`
      : "MIDI מחובר, אין בקר"
    : "חיבור בקר MIDI";
  return (
    <>
      <button
        type="button"
        className={`secondary-button ${midi.connected && midi.devices.length ? "is-on" : ""}`}
        onClick={midi.connected ? midi.disconnect : midi.connect}
        aria-pressed={midi.connected}
        title={midi.connected ? "ניתוק הבקר" : "נגינה ממקלדת או מבקר פדים שמחובר למחשב"}
      >
        <Cable size={16} />
        {label}
      </button>
      {midi.error && (
        <p className="error-message" role="alert">
          {midi.error}
        </p>
      )}
    </>
  );
}
