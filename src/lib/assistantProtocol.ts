/**
 * How the model asks the site to do something: a fenced block tagged
 * `action` holding one JSON call, as many blocks as it likes, in the order
 * they should run. This pulls those blocks out of a reply, leaving the prose
 * for the conversation, and tolerates the ways models bend the format — a
 * `json` fence, a list of calls, the parameters spread at the top level, a
 * bare JSON line with no fence — and the older `[[open:tool]]` marker.
 */
import type { ActionCall } from "./assistantActions";

export type PlanStatus = "pending" | "active" | "done";
export type PlanStep = { text: string; status: PlanStatus };

export type ParsedReply = {
  /** The reply without its action and plan blocks. */
  text: string;
  actions: ActionCall[];
  /** The task list the model wrote in a ```plan block, the last one if several. */
  plan: PlanStep[] | null;
  /** True while a fence is open, in a reply still being written. */
  pending: boolean;
};

const FENCE = "```";
const OPEN_MARKER = /\[\[open:([a-z-]+)\]\]/gi;
/** A call on a line of its own, which some models write instead of a fence. */
const BARE_LINE = /^[ \t]*\{\s*"(?:action|id|name|tool)"\s*:[^\n]*\}[ \t]*\n?/gm;

/** A call, from any of the shapes the model may write it in. */
function toCall(value: unknown): ActionCall | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = [record.action, record.id, record.name, record.tool].find((item) => typeof item === "string" && item.trim());
  if (typeof id !== "string") return null;
  const nested = [record.params, record.parameters, record.arguments, record.args, record.input].find(
    (item) => item && typeof item === "object" && !Array.isArray(item),
  );
  let params: Record<string, unknown>;
  if (nested) {
    params = { ...(nested as Record<string, unknown>) };
  } else {
    params = { ...record };
    for (const key of ["action", "id", "name", "tool", "params", "parameters", "arguments", "args", "input"]) delete params[key];
    // `tool` is the parameter of the navigate action itself.
    if (typeof record.action === "string" && record.action.trim() === "navigate" && typeof record.tool === "string") params.tool = record.tool;
  }
  return { id: id.trim(), params };
}

const STEP = /^\s*(?:[-*•]|\d+[.)])?\s*(?:\[([ xX~>-])\])?\s*(.+?)\s*$/;

/** The steps of a plan block: one a line, `[x]` done, `[~]` under way. */
export function parsePlan(body: string): PlanStep[] | null {
  const steps = body
    .split("\n")
    .map((line): PlanStep | null => {
      const match = STEP.exec(line);
      if (!match || !match[2]) return null;
      const mark = (match[1] ?? " ").toLowerCase();
      return { text: match[2].replace(/^\*\*(.+)\*\*$/, "$1"), status: mark === "x" ? "done" : mark === "~" || mark === ">" || mark === "-" ? "active" : "pending" };
    })
    .filter((step): step is PlanStep => step !== null)
    .slice(0, 20);
  return steps.length ? steps : null;
}

function parseCalls(body: string): ActionCall[] | null {
  const trimmed = body.trim();
  if (!trimmed) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // Several objects one after another, or a trailing comma, are common.
    try {
      parsed = JSON.parse(`[${trimmed.replace(/}\s*,?\s*{/g, "},{").replace(/,\s*$/, "")}]`);
    } catch {
      return null;
    }
  }
  const list = Array.isArray(parsed) ? parsed : [parsed];
  const calls = list.map(toCall).filter((call): call is ActionCall => call !== null);
  return calls.length ? calls : null;
}

/** Prose: the markers and bare calls come out of it, the rest is kept. */
function prose(text: string, actions: ActionCall[]) {
  return text
    .replace(OPEN_MARKER, (_, tool: string) => {
      actions.push({ id: "navigate", params: { tool: tool.toLowerCase() } });
      return "";
    })
    .replace(BARE_LINE, (whole) => {
      const calls = parseCalls(whole);
      if (!calls) return whole;
      actions.push(...calls);
      return "";
    });
}

export function parseAssistantReply(raw: string): ParsedReply {
  const source = raw.replace(/\r/g, "");
  const actions: ActionCall[] = [];
  let plan: PlanStep[] | null = null;
  const pieces: string[] = [];
  let pending = false;
  let cursor = 0;

  for (;;) {
    const open = source.indexOf(FENCE, cursor);
    if (open < 0) {
      pieces.push(prose(source.slice(cursor), actions));
      break;
    }
    pieces.push(prose(source.slice(cursor, open), actions));
    const newline = source.indexOf("\n", open);
    const close = newline < 0 ? -1 : source.indexOf(FENCE, newline);
    if (close < 0) {
      // A fence the model opened and has not closed yet: the block is still
      // being written, so nothing in it is a call and nothing of it is shown.
      pending = true;
      break;
    }
    const tag = source.slice(open + FENCE.length, newline).trim().toLowerCase();
    const body = source.slice(newline + 1, close);
    const calls = parseCalls(body);
    if (tag === "plan" || tag === "todo" || tag === "tasks") {
      plan = parsePlan(body) ?? plan;
    } else if (tag === "action" || tag === "actions") {
      // A block meant as an action that did not parse is still an action the
      // model tried to make; saying so is better than showing it as prose.
      if (calls) actions.push(...calls);
      else actions.push({ id: "invalid", params: { raw: body.trim().slice(0, 300) } });
    } else if ((tag === "" || tag === "json") && calls) {
      actions.push(...calls);
    } else {
      // An ordinary code block — an example of chords, a snippet — stays.
      pieces.push(source.slice(open, close + FENCE.length));
    }
    cursor = close + FENCE.length;
  }

  return {
    text: pieces
      .join("")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    actions,
    plan,
    pending,
  };
}
