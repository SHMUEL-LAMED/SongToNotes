/**
 * The site in Yiddish and English.
 *
 * The interface is written in Hebrew, in the components themselves. Rather
 * than thread a translation function through every one of them, the page is
 * translated where it is shown: once a dictionary is loaded, every Hebrew
 * text node and label attribute is looked up — exactly, or against the
 * patterns of the template strings that carry numbers and names — and
 * replaced; a MutationObserver does the same for whatever React renders
 * next. The code keeps working in Hebrew, so nothing that compares or
 * parses a string changes, and what the visitor typed (lyrics, titles) is
 * left alone unless it happens to be a whole interface phrase.
 *
 * Hebrew visitors download none of this.
 */

export type Lang = "he" | "yi" | "en";

export const LANGUAGES: { id: Lang; label: string; short: string; dir: "rtl" | "ltr" }[] = [
  { id: "he", label: "עברית", short: "עב", dir: "rtl" },
  { id: "yi", label: "ייִדיש", short: "ייִ", dir: "rtl" },
  { id: "en", label: "English", short: "EN", dir: "ltr" },
];

/** The languages whose dictionaries are complete enough to offer. */
export const OFFERED: Lang[] = ["he", "yi", "en"];

const LANG_KEY = "musictools.lang.v1";
const HEBREW = /[֐-׿]/;
const ATTRIBUTES = ["aria-label", "title", "placeholder", "alt"];

export function currentLang(): Lang {
  try {
    const stored = localStorage.getItem(LANG_KEY);
    if ((stored === "yi" || stored === "en") && OFFERED.includes(stored)) return stored;
  } catch {
    // Hebrew, then.
  }
  return "he";
}

/** Switching reloads the page, so every string starts from its Hebrew source. */
export function setLang(lang: Lang) {
  try {
    localStorage.setItem(LANG_KEY, lang);
  } catch {
    // Without storage the choice cannot outlive the reload.
    return;
  }
  window.location.reload();
}

/** What the language model is asked to answer in, named in Hebrew for the prompt. */
export function langForModel(lang: Lang = currentLang()) {
  return lang === "yi" ? "יידיש" : lang === "en" ? "אנגלית" : "עברית";
}

type Dictionary = Record<string, string>;
type Pattern = { regexes: RegExp[]; target: string; weight: number };

export type Translator = (text: string) => string | null;

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Builds the lookup: exact phrases, and templates ("{0} כלים") as patterns. */
export function createTranslator(dictionary: Dictionary): Translator {
  const exact = new Map<string, string>();
  const patterns: Pattern[] = [];
  for (const [source, target] of Object.entries(dictionary)) {
    if (!target) continue;
    if (/\{\d+\}/.test(source)) {
      const pieces = source.split(/\{(\d+)\}/);
      const order: number[] = [];
      // Several readings: every slot non-empty first, so "{1}{2}" splits
      // "1, מודגש" as 1 + ", מודגש"; then empty slots allowed, so "2" fits.
      const last = pieces.length - 2;
      const build = (slot: string, lastSlot = slot) =>
        new RegExp(`^${pieces.map((piece, index) => (index % 2 === 0 ? escape(piece) : index === last ? lastSlot : slot)).join("")}$`);
      pieces.forEach((piece, index) => {
        if (index % 2 === 1) order.push(Number(piece));
      });
      // A third reading lets each slot run up to the next separator, so
      // "13, מודגש" can split as 13 + ", מודגש".
      const regexes = [build("([\\s\\S]+?)"), build("([\\s\\S]*?)"), build("([^,·:—–]*)", "([\\s\\S]*?)")];
      // The target names its slots by the source's numbers; the regex
      // captures them in source order.
      const literal = pieces.filter((_, index) => index % 2 === 0).join("");
      patterns.push({ regexes, target: order.reduce((text, slot, at) => text.replaceAll(`{${slot}}`, `\uE000${at}\uE000`), target), weight: literal.length });
    } else {
      exact.set(source, target);
    }
  }
  // The most specific pattern wins.
  patterns.sort((a, b) => b.weight - a.weight);
  const cache = new Map<string, string | null>();

  // Labels glued together in code ("השתקה: סנר", "טום · 3 שנ׳") have no
  // Hebrew of their own to key on: translate the pieces between separators,
  // the strongest separator first. Returns null when no piece changed.
  const LEVELS = [/( — | – )/, /( · )/, /(: )/, /(, )/];
  const byParts = (text: string, level = 0, strict = false): string | null => {
    for (let at = level; at < LEVELS.length; at += 1) {
      const pieces = text.split(LEVELS[at]);
      if (pieces.length < 3) continue;
      let changed = false;
      let missed = false;
      const out = pieces.map((piece, index) => {
        if (index % 2 === 1 || !HEBREW.test(piece)) return piece;
        const clean = piece.trim();
        const done = exact.get(clean) ?? matchPattern(clean) ?? byParts(clean, at + 1, strict);
        if (done === null) {
          missed = true;
          return piece;
        }
        changed = true;
        return done;
      });
      // Strict: every piece or nothing, so a template that covers the whole
      // line still gets its turn.
      return changed && !(strict && missed) ? out.join("") : null;
    }
    return null;
  };

  // The first reading in which every Hebrew value is itself translatable
  // wins; failing that, the first reading at all.
  const matchPattern = (text: string): string | null => {
    let fallback: string | null = null;
    for (const pattern of patterns) {
      for (const regex of pattern.regexes) {
        const match = regex.exec(text);
        if (!match) continue;
        let complete = true;
        const filled = pattern.target.replace(/\uE000(\d+)\uE000/g, (_, at: string) => {
          const value = match[Number(at) + 1] ?? "";
          if (!HEBREW.test(value)) return value;
          const done = translate(value.trim());
          if (done === null) {
            complete = false;
            return value;
          }
          return value.replace(value.trim(), done);
        });
        if (complete) return filled;
        fallback ??= filled;
      }
    }
    return fallback;
  };

  const translate: Translator = (text) => {
    const cached = cache.get(text);
    if (cached !== undefined) return cached;
    let result: string | null = exact.get(text) ?? null;
    // A heading like "שם — תיאור" is two phrases, not one template.
    if (result === null && /( — | – | · )/.test(text)) result = byParts(text, 0, true);
    if (result === null) result = matchPattern(text);
    if (result === null) result = byParts(text, 0);
    if (cache.size > 20_000) cache.clear();
    cache.set(text, result);
    return result;
  };
  return translate;
}

/** A text as the dictionary keys it: whitespace collapsed, ends trimmed. */
export function normalize(text: string) {
  return text.replace(/\s+/g, " ").trim();
}

function skip(element: Element | null) {
  return Boolean(element?.closest('[translate="no"], textarea, script, style, [contenteditable="true"]'));
}

/** Translates a document and keeps translating what is added to it. */
export function translateDocument(root: HTMLElement, translate: Translator) {
  // What we wrote, so our own writes are not taken for new Hebrew — Yiddish
  // is written in the same letters.
  const written = new WeakMap<Node, string>();
  const writtenAttr = new WeakMap<Element, Map<string, string>>();

  const doText = (node: Text) => {
    const data = node.data;
    if (!HEBREW.test(data) || written.get(node) === data || skip(node.parentElement)) return;
    const result = translate(normalize(data));
    if (result === null) return;
    const lead = data.match(/^\s*/)?.[0] ?? "";
    const trail = data.match(/\s*$/)?.[0] ?? "";
    const next = `${lead}${result}${trail}`;
    written.set(node, next);
    if (next !== data) node.data = next;
  };

  const doAttributes = (element: Element) => {
    for (const name of ATTRIBUTES) {
      const value = element.getAttribute(name);
      if (!value || !HEBREW.test(value)) continue;
      const mine = writtenAttr.get(element);
      if (mine?.get(name) === value) continue;
      if (element.closest('[translate="no"]')) continue;
      const result = translate(normalize(value));
      if (result === null) continue;
      const map = mine ?? new Map<string, string>();
      map.set(name, result);
      writtenAttr.set(element, map);
      element.setAttribute(name, result);
    }
  };

  const walk = (start: Node) => {
    if (start.nodeType === Node.TEXT_NODE) {
      doText(start as Text);
      return;
    }
    if (start.nodeType !== Node.ELEMENT_NODE) return;
    doAttributes(start as Element);
    const walker = document.createTreeWalker(start, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
    let node = walker.nextNode();
    while (node) {
      if (node.nodeType === Node.TEXT_NODE) doText(node as Text);
      else doAttributes(node as Element);
      node = walker.nextNode();
    }
  };

  walk(root);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "characterData") doText(record.target as Text);
      else if (record.type === "attributes") doAttributes(record.target as Element);
      else record.addedNodes.forEach(walk);
    }
  });
  observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRIBUTES });
  return () => observer.disconnect();
}

const LOADERS: Record<Exclude<Lang, "he">, () => Promise<{ default: Dictionary }>> = {
  yi: () => import("../i18n/yi.json"),
  en: () => import("../i18n/en.json"),
};

/**
 * Runs before the app renders. For Hebrew it does nothing; otherwise the
 * page is held invisible (for at most a few seconds) until the dictionary
 * is in, so it never flashes Hebrew first.
 */
export async function startI18n() {
  const lang = currentLang();
  if (lang === "he") return;
  const root = document.documentElement;
  const spec = LANGUAGES.find((item) => item.id === lang)!;
  root.lang = lang;
  root.dir = spec.dir;
  root.dataset.lang = lang;
  root.style.visibility = "hidden";
  const reveal = window.setTimeout(() => (root.style.visibility = ""), 4000);
  try {
    const dictionary = (await LOADERS[lang]()).default;
    translateDocument(root, createTranslator(dictionary));
  } catch {
    // The site stays in Hebrew rather than stay hidden.
  } finally {
    window.clearTimeout(reveal);
    root.style.visibility = "";
  }
}
