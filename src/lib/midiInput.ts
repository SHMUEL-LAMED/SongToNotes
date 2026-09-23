import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A hardware keyboard or pad controller, through Web MIDI. The browser asks
 * the visitor before it lets a page listen, so nothing connects until they
 * press the button once; after that the choice is remembered and the next
 * visit reconnects by itself.
 */

export type MidiHandlers = {
  /** A key or pad went down; velocity is 0..1. */
  onNoteOn?: (midi: number, velocity: number) => void;
  onNoteOff?: (midi: number) => void;
  /** The sustain pedal (controller 64). */
  onSustain?: (down: boolean) => void;
};

export type MidiState = {
  supported: boolean;
  connected: boolean;
  /** Names of the inputs that are plugged in right now. */
  devices: string[];
  error: string | null;
  connect: () => void;
  disconnect: () => void;
};

const REMEMBER_KEY = "musictools.midi.v1";

type MidiMessage = { data: Uint8Array | null };

/** What a raw MIDI message means, or null for anything the site ignores. */
export function parseMidiMessage(
  data: ArrayLike<number>,
): { type: "on"; note: number; velocity: number } | { type: "off"; note: number } | { type: "sustain"; down: boolean } | null {
  if (data.length < 2) return null;
  const status = data[0] & 0xf0;
  const first = data[1];
  const second = data.length > 2 ? data[2] : 0;
  // A note-on with velocity zero is how most keyboards say note-off.
  if (status === 0x90 && second > 0) return { type: "on", note: first, velocity: second / 127 };
  if (status === 0x80 || status === 0x90) return { type: "off", note: first };
  if (status === 0xb0 && first === 64) return { type: "sustain", down: second >= 64 };
  return null;
}

function remembered() {
  try {
    return localStorage.getItem(REMEMBER_KEY) === "1";
  } catch {
    return false;
  }
}

function remember(on: boolean) {
  try {
    localStorage.setItem(REMEMBER_KEY, on ? "1" : "0");
  } catch {
    // The connection still works for this visit.
  }
}

export function useMidiInput(handlers: MidiHandlers): MidiState {
  const supported = typeof navigator !== "undefined" && "requestMIDIAccess" in navigator;
  const handlersRef = useRef(handlers);
  const accessRef = useRef<MIDIAccess | null>(null);
  const mountedRef = useRef(true);
  const [connected, setConnected] = useState(false);
  const [devices, setDevices] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    handlersRef.current = handlers;
  });

  const onMessage = useCallback((event: Event) => {
    const { data } = event as unknown as MidiMessage;
    if (!data) return;
    const message = parseMidiMessage(data);
    if (!message) return;
    const current = handlersRef.current;
    if (message.type === "on") current.onNoteOn?.(message.note, message.velocity);
    else if (message.type === "off") current.onNoteOff?.(message.note);
    else current.onSustain?.(message.down);
  }, []);

  const attach = useCallback(
    (access: MIDIAccess) => {
      const names: string[] = [];
      access.inputs.forEach((input) => {
        input.removeEventListener("midimessage", onMessage);
        input.addEventListener("midimessage", onMessage);
        names.push(input.name || "בקר MIDI");
      });
      setDevices(names);
    },
    [onMessage],
  );

  const detach = useCallback(() => {
    const access = accessRef.current;
    if (!access) return;
    access.inputs.forEach((input) => input.removeEventListener("midimessage", onMessage));
    access.onstatechange = null;
    accessRef.current = null;
  }, [onMessage]);

  // No state changes before the browser answers, so the effect below can
  // reconnect on load without rendering twice.
  const request = useCallback(() => {
    navigator
      .requestMIDIAccess()
      .then((access) => {
        // The tool may have closed while the browser was asking.
        if (!mountedRef.current) return;
        detach();
        accessRef.current = access;
        attach(access);
        // Plugging a keyboard in or out while the page is open.
        access.onstatechange = () => attach(access);
        setError(null);
        setConnected(true);
        remember(true);
      })
      .catch(() => {
        if (!mountedRef.current) return;
        setConnected(false);
        remember(false);
        setError("הדפדפן לא אישר גישה לבקר. אפשר לאשר בהגדרות האתר ולנסות שוב.");
      });
  }, [attach, detach]);

  const connect = useCallback(() => {
    if (!supported) {
      setError("הדפדפן הזה לא תומך בבקרי MIDI. נסו Chrome או Edge.");
      return;
    }
    request();
  }, [request, supported]);

  const disconnect = useCallback(() => {
    detach();
    setConnected(false);
    setDevices([]);
    remember(false);
  }, [detach]);

  useEffect(() => {
    mountedRef.current = true;
    if (supported && remembered()) request();
    return () => {
      mountedRef.current = false;
      detach();
    };
  }, [request, detach, supported]);

  return { supported, connected, devices, error, connect, disconnect };
}
