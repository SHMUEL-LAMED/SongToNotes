import { useEffect, useRef, useSyncExternalStore } from "react";
import { handOffTo } from "./handoff";
import { currentRoute } from "./router";
import { TOOLS, type ToolDefinition } from "./tools";

/**
 * The file the open tool can pass on to the next one: the song it was given,
 * or — once it has made something — its result. The picker offers the song
 * on its own; a tool with a result offers that too, and the result wins,
 * because "carry on with what I just made" is what someone finishing a step
 * usually wants.
 *
 * A result is offered as a function rather than a file: encoding a WAV of a
 * four-minute song on every slider move would cost more than the button is
 * worth, so it is only built when someone actually sends it.
 */
export type OfferKind = "source" | "result";

export type FileOffer = {
  kind: OfferKind;
  /** The name shown on the buttons, before the file exists. */
  name: string;
  /** The tool offering it, which is left out of the places to send it. */
  tool: string;
  get: () => File | Promise<File>;
};

type Slots = { source: FileOffer | null; result: FileOffer | null };

let slots: Slots = { source: null, result: null };
let snapshot: FileOffer | null = null;
const listeners = new Set<() => void>();

function publish() {
  snapshot = slots.result ?? slots.source;
  for (const listener of listeners) listener();
}

/**
 * Offers a file until the returned function is called. A later offer of the
 * same kind replaces an earlier one; withdrawing an offer that has since been
 * replaced leaves the newer one alone.
 */
export function offerFile(offer: FileOffer): () => void {
  slots = { ...slots, [offer.kind]: offer };
  publish();
  return () => {
    if (slots[offer.kind] !== offer) return;
    slots = { ...slots, [offer.kind]: null };
    publish();
  };
}

/** What can be sent on right now; the result when there is one. */
export function currentOffer(): FileOffer | null {
  return snapshot;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useFileOffer(): FileOffer | null {
  return useSyncExternalStore(subscribe, currentOffer, () => null);
}

/**
 * The tools that open a song handed to them: the same ones the home page
 * offers for a dropped file, since both arrive through the same hand-off.
 */
export function receivingTools(except: string | null, disabled: readonly string[] = []): ToolDefinition[] {
  return TOOLS.filter((tool) => tool.quick && tool.id !== except && !disabled.includes(tool.id));
}

/** Builds the offered file and opens the tool with it. */
export async function sendOffer(offer: FileOffer, tool: string) {
  const file = await offer.get();
  await handOffTo(tool, file, file.name);
}

/**
 * Offers what a tool has made while it has it. `made` is the result itself
 * (a buffer, a file); a new one replaces the offer, and null withdraws it.
 * The file is only built by `get` when someone sends it on.
 */
export function useOfferResult(made: unknown, name: string, get: () => File | Promise<File>) {
  const getRef = useRef(get);
  useEffect(() => {
    getRef.current = get;
  });
  useEffect(() => {
    if (!made) return;
    return offerFile({ kind: "result", name, tool: currentRoute(), get: () => getRef.current() });
  }, [made, name]);
}

/** For tests: forget every offer. */
export function resetOffers() {
  slots = { source: null, result: null };
  publish();
}
