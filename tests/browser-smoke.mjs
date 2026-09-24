/**
 * End-to-end smoke test against a real browser.
 *
 * `npm run build && npm run preview` in one shell, then `npm run test:browser`
 * in another. It drives the built site the way a visitor would — opening every
 * tool, feeding the demo file through the ones that take audio, working the
 * controls with the keyboard — because a green `tsc` says nothing about
 * whether the audio pipeline still produces sound.
 *
 * Playwright is not a dependency of the site: it is several hundred megabytes
 * of browser for a static page that ships none of it. Install it where the
 * test runs (`npm i -g playwright`) and this picks it up.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * Local install first, then the global one — `import` does not look in the
 * global root on its own, and a globally installed Playwright is the usual
 * arrangement for a browser that no dependency of this site needs.
 */
async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch {
    // Falls through to the global root below.
  }
  try {
    const { execSync } = await import("node:child_process");
    const root = execSync("npm root -g", { encoding: "utf8" }).trim();
    return await import(pathToFileURL(`${root}/playwright/index.mjs`).href);
  } catch {
    console.error(
      "Playwright is not installed. `npm i -g playwright` (or `npm i -D playwright`) and run this again.",
    );
    process.exit(2);
  }
}

const { chromium } = await loadPlaywright();

const BASE = process.env.SMOKE_URL ?? "http://127.0.0.1:4173/SongToNotes/";
const DEMO = fileURLToPath(new URL("../public/demo.wav", import.meta.url));
// An eleven-minute WAV, when the runner provides one (see the transcript
// section); the long-file checks are skipped without it.
const LONG = process.env.SMOKE_LONG_WAV ?? null;
const failures = [];
const log = (ok, name, extra = "") => {
  if (!ok) failures.push(name + (extra ? ` — ${extra}` : ""));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
};

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });

// Counting the voices the synth starts is the only way from outside the page
// to tell one playback from two overlapping ones.
await page.addInitScript(() => {
  window.__oscillators = 0;
  const create = AudioContext.prototype.createOscillator;
  AudioContext.prototype.createOscillator = function countingCreateOscillator() {
    window.__oscillators += 1;
    return create.call(this);
  };
});

const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

await page.goto(BASE, { waitUntil: "networkidle" });

// --- hub ---
const cards = await page.locator(".tool-card").count();
log(cards === 21, "hub renders all 21 tool cards", `found ${cards}`);

await page.locator(".hub-search input").fill("קריוקי");
await page.waitForTimeout(150);
const filtered = await page.locator(".tool-card").count();
log(filtered >= 1 && filtered < 10, "hub search filters", `found ${filtered}`);
await page.locator(".hub-search input").fill("");

// --- every tool opens ---
const TOOLS = ["notes", "ringtone", "vocals", "speed", "metronome", "tuner", "piano", "ear", "analyze", "transcript", "chords", "songbook", "convert", "video", "rhythm", "mixer", "lyrics", "tts", "beats", "theory"];
for (const id of TOOLS) {
  await page.goto(`${BASE}#/${id}`, { waitUntil: "load" });
  await page.waitForTimeout(500);
  await page.waitForSelector(".tool-body h1, .tool-hero h1", { timeout: 30_000 }).catch(() => {});
  const heading = await page.locator(".tool-body h1, .tool-hero h1").first().textContent().catch(() => null);
  log(Boolean(heading), `tool "${id}" renders`, heading ?? "no heading");
}

// --- unknown route falls back to hub ---
await page.goto(`${BASE}#/nope-not-a-tool`, { waitUntil: "load" });
await page.waitForTimeout(400);
log(await page.locator(".hub-hero").isVisible(), "unknown route falls back to the hub");

// --- ringtone tool end to end with a real file ---
await page.goto(`${BASE}#/ringtone`, { waitUntil: "load" });
await page.waitForTimeout(300);
await page.locator(".drop-zone input[type=file]").setInputFiles(DEMO);
await page.waitForSelector(".section-picker", { timeout: 30_000 });
log(true, "ringtone: demo.wav decodes and the section picker appears");
const sectionButtons = await page.locator(".section-choices button").count();
log(sectionButtons === 3, "ringtone: chorus, verse and instrumental are offered", `found ${sectionButtons}`);

await page.waitForTimeout(600);
const downloadEnabled = await page.locator(".download-buttons button").first().isEnabled();
log(downloadEnabled, "ringtone: download button becomes enabled (render finished)");

// the waveform region survives a keyboard edge nudge
const startSlider = page.locator(".waveform-handles input").first();
await startSlider.focus();
const handlesVisible = await page.locator(".waveform-handles").evaluate(
  (el) => el.getBoundingClientRect().height > 10,
);
log(handlesVisible, "waveform: keyboard handles reveal on focus");
const startField = page.locator(".trim-fields input[type=number]").first();
const startBefore = await startField.inputValue();
// ArrowUp always increases; in this RTL container ArrowRight decreases.
for (let i = 0; i < 12; i += 1) await startSlider.press("ArrowUp");
await page.waitForTimeout(300);
const startAfter = await startField.inputValue();
log(Number(startAfter) > Number(startBefore), "waveform: arrow keys move the selection edge", `${startBefore} -> ${startAfter}`);
for (let i = 0; i < 5; i += 1) await startSlider.press("ArrowDown");
await page.waitForTimeout(300);
const startBack = await startField.inputValue();
log(Number(startBack) < Number(startAfter), "waveform: the edge moves back down too", `${startAfter} -> ${startBack}`);
const endSlider = page.locator(".waveform-handles input").nth(1);
const endField = page.locator(".trim-fields input[type=number]").nth(1);
const endBefore = await endField.inputValue();
for (let i = 0; i < 10; i += 1) await endSlider.press("ArrowDown");
await page.waitForTimeout(300);
const endAfter = await endField.inputValue();
log(Number(endAfter) < Number(endBefore), "waveform: the end handle moves independently", `${endBefore} -> ${endAfter}`);

// a plain click slides the ringtone rather than wiping the selection
const lengthBeforeClick = Number(await endField.inputValue()) - Number(await startField.inputValue());
const strip = page.locator(".waveform svg");
const box = await strip.boundingBox();
await page.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
await page.waitForTimeout(300);
const startAfterClick = Number(await startField.inputValue());
const lengthAfterClick = Number(await endField.inputValue()) - startAfterClick;
log(
  Math.abs(lengthAfterClick - lengthBeforeClick) < 0.25 && startAfterClick > Number(startBack),
  "waveform: a click moves the ringtone and keeps its length",
  `start ${startBack} -> ${startAfterClick}, length ${lengthBeforeClick.toFixed(1)} -> ${lengthAfterClick.toFixed(1)}`,
);
const legend = await page.locator(".waveform-legend").textContent();
log(/\d:\d\d–\d:\d\d/.test(legend ?? ""), "waveform: the selection survives the click", legend?.trim() ?? "");
log((await page.locator(".waveform-legend button").count()) === 0, "waveform: no 'whole song' button on a fixed-length cut");

// the volume dial must change the rendered audio even with normalise ticked
const normaliseBox = page.locator(".checkbox-field input[type=checkbox]").first();
log(await normaliseBox.isChecked(), "ringtone: normalise is on by default");

// --- the exported file, not just the UI state ---
// The volume dial used to be a no-op whenever "normalise" was ticked, because
// peak normalisation scaled the baked-in level straight back out. The only
// proof that it works is the bytes that come out of the download.
const rmsOf = (path) => {
  const raw = readFileSync(path);
  let peak = 0;
  let sum = 0;
  let count = 0;
  for (let offset = 44; offset + 1 < raw.length; offset += 2) {
    const sample = raw.readInt16LE(offset) / 32768;
    peak = Math.max(peak, Math.abs(sample));
    sum += sample * sample;
    count += 1;
  }
  return { peak, rms: Math.sqrt(sum / count), frames: count };
};

const gainSlider = page.locator(".range-field", { hasText: "עוצמה" }).locator("input[type=range]");
const exportAtGain = async (gain) => {
  await gainSlider.fill(String(gain));
  await page.waitForTimeout(900);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.locator(".download-buttons button").first().click(),
  ]);
  return rmsOf(await download.path());
};

const atFull = await exportAtGain(100);
const atLoud = await exportAtGain(200);
const atQuiet = await exportAtGain(40);
log(atLoud.rms > atFull.rms * 1.3, "export: 200% is louder than 100% with normalise on",
  `rms ${atFull.rms.toFixed(3)} -> ${atLoud.rms.toFixed(3)}`);
log(atQuiet.rms < atFull.rms * 0.6, "export: 40% is quieter than 100%",
  `rms ${atFull.rms.toFixed(3)} -> ${atQuiet.rms.toFixed(3)}`);
log(atLoud.peak <= 1.0001, "export: the boost stays inside full scale", `peak ${atLoud.peak.toFixed(4)}`);
log(Math.abs(atFull.peak - 0.98) < 0.02, "export: normalised audio lands on the ceiling",
  `peak ${atFull.peak.toFixed(4)}`);
log(atFull.frames === atLoud.frames && atLoud.frames === atQuiet.frames,
  "export: the gain does not change the clip length");

// --- analyze tool runs on the same file ---
await page.goto(`${BASE}#/analyze`, { waitUntil: "load" });
await page.waitForTimeout(300);
await page.locator(".drop-zone input[type=file]").setInputFiles(DEMO);
await page.waitForSelector(".analyze-stats", { timeout: 60_000 });
const bpm = await page.locator(".stat-card.is-hero strong").first().textContent();
log(Boolean(bpm) && bpm !== "—", "analyze: reports a BPM", bpm ?? "");

// --- vocals tool: the fast separation runs on a worker and yields a file ---
await page.goto(`${BASE}#/vocals`, { waitUntil: "load" });
await page.waitForTimeout(300);
await page.locator(".drop-zone input[type=file]").setInputFiles(DEMO);
await page.waitForSelector(".transport", { timeout: 60_000 });
await page.waitForFunction(
  () => {
    const button = document.querySelector(".download-buttons button");
    return button && !button.disabled;
  },
  null,
  { timeout: 60_000 },
);
const [karaoke] = await Promise.all([
  page.waitForEvent("download"),
  page.locator(".download-buttons button").first().click(),
]);
const karaokeStats = rmsOf(await karaoke.path());
log(karaokeStats.frames > 1000 && karaokeStats.rms > 0.001, "vocals: the karaoke export is real audio",
  `rms ${karaokeStats.rms.toFixed(3)}, ${karaokeStats.frames} samples`);
log(/בשרת|בדפדפן|בודק/.test((await page.locator(".ai-separator p").first().textContent()) ?? ""),
  "vocals: the AI separation explains where it runs (server, or the browser when the server has no key)");

// --- speed tool renders a stretched buffer ---
await page.goto(`${BASE}#/speed`, { waitUntil: "load" });
await page.waitForTimeout(300);
await page.locator(".drop-zone input[type=file]").setInputFiles(DEMO);
await page.waitForSelector(".waveform", { timeout: 30_000 });
await page.waitForSelector(".transport", { timeout: 60_000 });
log(true, "speed: time-stretch renders and the transport appears");

// --- metronome starts and stops ---
await page.goto(`${BASE}#/metronome`, { waitUntil: "load" });
await page.waitForTimeout(400);
const metroButton = page.locator(".tool-body button").first();
await metroButton.click();
await page.waitForTimeout(700);
log(true, "metronome: start button responds");

// --- ear trainer: a question really plays and the score really moves ---
await page.goto(`${BASE}#/ear`, { waitUntil: "load" });
await page.waitForTimeout(300);
// A fresh score, whatever an earlier run left in this profile's storage.
await page.evaluate(() => localStorage.removeItem("musictools.eartraining.v1"));
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(400);
await page.locator(".ear-empty button").click();
await page.waitForSelector(".ear-choices button", { timeout: 10_000 });
const earChoices = await page.locator(".ear-choices button").count();
log(earChoices >= 2, "ear: the beginner round offers its answers", `found ${earChoices}`);

// Whichever button is pressed, exactly one answer must come back right.
await page.locator(".ear-choices button").first().click();
await page.waitForTimeout(200);
const marked = await page.locator(".ear-choices button.is-right").count();
log(marked === 1, "ear: the answer is revealed on exactly one button", `found ${marked}`);
const askedAfterOne = await page.locator(".ear-score strong").first().textContent();
log(askedAfterOne === "1", "ear: answering counts the question", `asked ${askedAfterOne}`);
log(
  await page.locator(".ear-choices button").first().isDisabled(),
  "ear: the buttons lock once the answer is in",
);

// Enter moves on; the next question arrives unanswered.
await page.keyboard.press("Enter");
await page.waitForTimeout(300);
log(
  (await page.locator(".ear-choices button.is-right").count()) === 0,
  "ear: Enter starts a fresh question",
);
// Switching exercise must not leave the previous question's buttons up.
await page.locator(".segmented-control button", { hasText: "אקורדים" }).first().click();
await page.waitForTimeout(250);
log(
  (await page.locator(".ear-choices").count()) === 0 &&
    (await page.locator(".ear-empty").isVisible()),
  "ear: changing the exercise clears the old question",
);
const chordScore = await page.locator(".ear-score strong").first().textContent();
log(chordScore === "0", "ear: each exercise keeps its own score", `asked ${chordScore}`);

// Back to the two-note exercise, with a question sounding, for the checks
// below: both the shortcuts and the replay need one on screen.
await page.locator(".segmented-control button", { hasText: "מרווחים" }).first().click();
await page.waitForTimeout(200);
await page.locator(".ear-empty button").click();
await page.waitForSelector(".ear-choices button", { timeout: 10_000 });

// The browser's own shortcuts stay the browser's: Ctrl+R must still reload.
const modifierVerdict = await page.evaluate(() => {
  const press = (init) => {
    const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
    document.body.dispatchEvent(event);
    return event.defaultPrevented;
  };
  return {
    reload: press({ key: "r", ctrlKey: true }),
    command: press({ key: "r", metaKey: true }),
    tab: press({ key: "1", ctrlKey: true }),
    plain: press({ key: "r" }),
  };
});
log(
  !modifierVerdict.reload && !modifierVerdict.command && !modifierVerdict.tab,
  "ear: Ctrl/Cmd shortcuts are left to the browser",
  JSON.stringify(modifierVerdict),
);
log(modifierVerdict.plain, "ear: plain R still replays the question");

// Replaying mid-phrase must schedule the notes once, not twice.
const oscillators = await page.evaluate(async () => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const button = document.querySelector(".ear-playback .primary-button");
  button.click();
  await wait(250); // the phrase is now under way
  const before = window.__oscillators ?? 0;
  button.click(); // replay on top of it
  await wait(2500);
  return (window.__oscillators ?? 0) - before;
});
// A beginner interval is two notes, and the piano voice gives each two
// oscillators: four for one pass, twice that when a replay starts two.
log(
  oscillators > 0 && oscillators <= 5,
  "ear: replaying mid-phrase starts the notes once",
  `${oscillators} oscillators`,
);

// A keystroke from outside the trainer — the top bar, or the account dialog
// that opens over it — must not answer the hidden question.
const askedBeforeOutside = await page.locator(".ear-score strong").first().textContent();
await page.locator("button.theme-toggle").focus();
await page.keyboard.press("1");
await page.waitForTimeout(250);
log(
  (await page.locator(".ear-score strong").first().textContent()) === askedBeforeOutside &&
    (await page.locator(".ear-choices button.is-right").count()) === 0,
  "ear: a digit pressed outside the trainer does not answer the question",
);

// Enter on a focused button must press that button, not fire the shortcut.
await page.locator(".segmented-control button", { hasText: "מרווחים" }).first().focus();
await page.keyboard.press("Enter");
await page.waitForTimeout(250);
log(
  (await page.locator(".ear-choices").count()) === 0 &&
    (await page
      .locator(".segmented-control button", { hasText: "מרווחים" })
      .first()
      .getAttribute("aria-pressed")) === "true",
  "ear: Enter on a focused button presses it instead of starting a question",
);
// With focus off the controls the shortcut is back.
await page.evaluate(() => document.activeElement instanceof HTMLElement && document.activeElement.blur());
await page.keyboard.press("Enter");
await page.waitForTimeout(300);
log(
  (await page.locator(".ear-choices button").count()) > 0,
  "ear: Enter outside the controls still starts a question",
);

// The hard interval level has twelve answers but a keyboard has nine digits,
// so only nine may carry a shortcut — and the hint must say nine.
await page.locator(".segmented-control button", { hasText: "מתקדם" }).first().click();
await page.waitForTimeout(200);
await page.locator(".ear-empty button").click();
await page.waitForSelector(".ear-choices button", { timeout: 10_000 });
const hardChoices = await page.locator(".ear-choices button").count();
const keyed = await page.locator(".ear-choices button[aria-keyshortcuts]").count();
const hint = (await page.locator(".ear-hint").textContent()) ?? "";
log(hardChoices === 12, "ear: the advanced interval round offers all twelve", `found ${hardChoices}`);
log(keyed === 9, "ear: only the answers a digit can reach carry a shortcut", `found ${keyed}`);
log(/1–9/.test(hint), "ear: the hint promises nine keys, not twelve", hint.replace(/\s+/g, " ").trim());

// --- the skip control reaches the content without hijacking the route ---
await page.goto(`${BASE}#/metronome`, { waitUntil: "load" });
// A hash-only navigation keeps the page — and with it whatever was clicked
// last — so the tab order is measured from a reloaded, untouched page.
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(400);
await page.keyboard.press("Tab");
const firstStop = await page.evaluate(
  () => `${document.activeElement?.tagName}.${document.activeElement?.className}`,
);
log(
  firstStop.includes("skip-link"),
  "a11y: the skip control is the first stop for the keyboard",
  firstStop,
);
await page.keyboard.press("Enter");
await page.waitForTimeout(250);
const skipLanded = await page.evaluate(() => ({
  focused: document.activeElement?.classList.contains("page-content"),
  hash: window.location.hash,
}));
log(
  skipLanded.focused && skipLanded.hash === "#/metronome",
  "a11y: skipping moves focus to the content and keeps the route",
  `hash ${skipLanded.hash}`,
);
log(
  Boolean(await page.locator("p.sr-only[aria-live=polite]").first().textContent()),
  "a11y: the page announces which tool is open",
);

// --- transcript tool: prepares the audio and asks for the model ---
// The model is fetched from the Hugging Face hub, which this test box may not
// reach; what is checked here is everything up to that point and the honest
// message when it is not reachable — or the text, where it is.
await page.goto(`${BASE}#/transcript`, { waitUntil: "load" });
await page.waitForTimeout(300);
log(
  (await page.locator("select[aria-label='שפת הדיבור'] option").count()) >= 5,
  "transcript: offers a choice of languages",
);
await page.locator(".drop-zone input[type=file]").setInputFiles(DEMO);
await page.waitForSelector(".transcript-tool .primary-button", { timeout: 30_000 });
log(true, "transcript: a loaded file offers the transcribe button");
// Signed out, the recogniser on the server would refuse; the page says so
// before a byte goes up, and offers to sign in instead of the transcribe button.
await page.waitForSelector(".transcript-signin", { timeout: 10_000 });
log(
  /להתחבר/.test((await page.locator(".transcript-signin p").textContent()) ?? ""),
  "transcript: signed out, the run is replaced by a sign-in prompt (the key stays on the server)",
);
log((await page.locator(".transcript-tool .primary-button").count()) === 1,
  "transcript: the only primary button is the sign-in one");
log(!/מוריד|הורד/.test((await page.locator(".transcript-tool").textContent()) ?? ""),
  "transcript: nothing on the page asks the visitor to download anything");
log(/בשרת/.test((await page.locator(".transcript-tool .setting-field small").last().textContent()) ?? ""),
  "transcript: the page explains the work is done on the server");

// A long recording: decoded in pieces to 16 kHz mono, cut into windows.
if (LONG) {
  // The tool is already open with the demo file; a reload starts it clean.
  await page.goto(`${BASE}#/transcript`, { waitUntil: "load" });
  await page.reload({ waitUntil: "load" });
  await page.waitForTimeout(300);
  await page.locator(".drop-zone input[type=file]").setInputFiles(LONG);
  await page.waitForSelector(".selected-file", { timeout: 120_000 });
  const details = (await page.locator(".selected-file .file-details span").textContent()) ?? "";
  log(/11:00/.test(details) && /מונו/.test(details) && /16 kHz/.test(details),
    "transcript: an eleven-minute file decodes to 16 kHz mono", details.trim());
  log(await page.locator(".waveform").isVisible(), "transcript: the long file gets a waveform to pick a range on");
  log(/חלקים של כ־4 דקות/.test((await page.locator(".transcript-tool .engine-note").textContent()) ?? ""),
    "transcript: a long file is announced as windowed work");
  // The run itself needs an account and the server; signed out it stays a prompt.
  log(await page.locator(".transcript-signin").isVisible(),
    "transcript: the long file too waits for a sign-in before anything is sent");
}

// A saved transcript reopens with its text and timestamps, no model needed.
await page.evaluate(() => {
  const now = new Date().toISOString();
  localStorage.setItem("music-tools.works.v1", JSON.stringify([{
    id: "t1", kind: "transcript", title: "שיעור", sourceName: "lesson.m4a",
    summary: { words: 5, duration: 9, languageLabel: "עברית" },
    payload: { segments: [{ start: 0, end: 4, text: "שלום לכולם" }, { start: 4.5, end: 9, text: "ברוכים הבאים לשיעור" }], language: "he", model: "whisper-1" },
    fileName: null, deviceId: null, filePath: null, createdAt: now, updatedAt: now, localOnly: true,
  }]));
});
await page.locator(".account-button").click();
await page.waitForSelector(".me-item");
await page.locator(".me-item-title", { hasText: "שיעור" }).click();
await page.waitForSelector(".transcript-result textarea", { timeout: 10_000 });
const reopened = await page.locator(".transcript-result textarea").inputValue();
log(/שלום לכולם\nברוכים הבאים לשיעור/.test(reopened), "transcript: a saved transcript reopens with its text");
log((await page.locator(".transcript-segments li").count()) === 2, "transcript: and its timestamps");
const [srt] = await Promise.all([
  page.waitForEvent("download"),
  page.locator(".transcript-downloads button", { hasText: "SRT" }).click(),
]);
const srtText = readFileSync(await srt.path(), "utf8");
log(/00:00:04,500 --> 00:00:09,000\nברוכים הבאים לשיעור/.test(srtText), "transcript: the SRT download carries the cues");

// The AI card sits under the transcript: server work, so signed out it only
// explains, and nothing on it asks for a download.
log(await page.locator(".transcript-ai").isVisible(), "transcript: the AI card (tidy, summary, translation) is offered");
log((await page.locator(".transcript-ai-actions .chip-toggle").count()) === 3, "transcript: three AI actions");
log(/להתחבר/.test((await page.locator(".transcript-ai .ai-status").textContent().catch(() => "")) ?? ""),
  "transcript: signed out, the AI card says to sign in");

// --- chords: the demo file yields a chord timeline with diagrams, and a sheet to download ---
await page.goto(`${BASE}#/chords`, { waitUntil: "load" });
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(300);
await page.locator(".drop-zone input[type=file]").setInputFiles(DEMO);
await page.waitForSelector(".chords-timeline", { timeout: 90_000 });
const chordBlocks = await page.locator(".chords-block").count();
log(chordBlocks > 0, "chords: the demo song yields a chord timeline", `${chordBlocks} blocks`);
log((await page.locator(".chords-diagrams .chord-diagram").count()) > 0, "chords: each distinct chord gets a fingering diagram");
const firstChord = (await page.locator(".chords-block span").first().textContent()) ?? "";
await page.locator("input[aria-label='טרנספוזיציה בחצאי טונים']").fill("2");
const movedChord = (await page.locator(".chords-block span").first().textContent()) ?? "";
log(firstChord !== movedChord, "chords: transposing changes the chord names", `${firstChord} -> ${movedChord}`);
await page.locator("input[aria-label='טרנספוזיציה בחצאי טונים']").fill("0");
await page.locator("input[aria-label='מיקום הקאפו']").fill("2");
log(/קאפו בשריג 2/.test((await page.locator(".chords-tool .table-footnote").textContent()) ?? ""), "chords: a capo is reported under the diagrams");
const [chordSheet] = await Promise.all([
  page.waitForEvent("download"),
  page.locator(".chords-tool .download-buttons button", { hasText: "TXT" }).click(),
]);
const chordText = readFileSync(await chordSheet.path(), "utf8");
log(/0:00\s+[A-G]/.test(chordText), "chords: the sheet lists chords with times", chordText.split("\n").slice(0, 3).join(" | "));
await page.locator(".chords-tool .download-buttons button", { hasText: "לשירון" }).click();
await page.waitForSelector(".songbook-tool", { timeout: 10_000 });
log((await page.locator(".songbook-chord").allTextContents()).some((item) => /[A-G]/.test(item)), "chords: 'to songbook' opens the songbook showing the chords");
await page.locator(".songbook-toolbar .segmented-control button", { hasText: "עריכה" }).click();

// --- songbook: bracketed chords render above the words, transpose, and print-ready text ---
await page.locator(".songbook-editor").fill("[Am]היה היה [G]פעם\n[C]ילד קטן");
await page.locator(".songbook-toolbar .segmented-control button", { hasText: "תצוגה" }).click();
await page.waitForSelector(".songbook-sheet");
log((await page.locator(".songbook-chord").allTextContents()).filter((item) => item.trim()).join(" ") === "Am G C", "songbook: chords sit above the words");
await page.locator("button[aria-label='חצי טון למעלה']").click();
log((await page.locator(".songbook-chord").allTextContents()).filter((item) => item.trim()).join(" ") === "A#m G# C#", "songbook: transposing up moves every chord");
log((await page.locator(".songbook-diagrams .chord-diagram").count()) === 3, "songbook: the song's chords get diagrams");
await page.locator(".songbook-toolbar .segmented-control button", { hasText: "עריכה" }).click();
await page.locator(".songbook-editor").fill("Am      G\nהיה היה פעם");
await page.locator(".songbook-editor-tools .link-button").first().click();
log((await page.locator(".songbook-editor").inputValue()) === "[Am]היה היה [G]פעם", "songbook: chords pasted over lyrics fold into brackets");

// --- converter: the demo becomes an MP3 in the browser, and can be handed to another tool ---
await page.goto(`${BASE}#/convert`, { waitUntil: "load" });
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(300);
await page.locator(".drop-zone input[type=file]").setInputFiles(DEMO);
await page.waitForSelector(".convert-tool .primary-button", { timeout: 30_000 });
log(/MP3/.test((await page.locator(".convert-tool .primary-button").textContent()) ?? ""), "convert: offers MP3 by default with a size estimate");
await page.locator(".convert-tool .primary-button").click();
await page.waitForSelector(".convert-result", { timeout: 120_000 });
const [mp3Download] = await Promise.all([
  page.waitForEvent("download"),
  page.locator(".convert-result .download-buttons button", { hasText: "הורד" }).click(),
]);
const mp3Bytes = readFileSync(await mp3Download.path());
log(mp3Download.suggestedFilename().endsWith(".mp3") && mp3Bytes.length > 10_000, "convert: an MP3 file comes out", `${mp3Bytes.length} bytes`);
log((mp3Bytes[0] === 0xff && (mp3Bytes[1] & 0xe0) === 0xe0) || (mp3Bytes[0] === 0x49 && mp3Bytes[1] === 0x44), "convert: the file starts with an MP3 frame or ID3 tag");
await page.locator(".convert-result .download-buttons button", { hasText: "לתמלול" }).click();
await page.waitForSelector(".transcript-tool .selected-file", { timeout: 30_000 });
log(/\.mp3/.test((await page.locator(".transcript-tool .selected-file strong").textContent()) ?? ""), "convert: the result is handed to the transcript tool without a re-upload");

// --- video: the tool has its own drop zone that only takes video ---
await page.goto(`${BASE}#/video`, { waitUntil: "load" });
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(300);
log(await page.locator(".video-tool .drop-zone").isVisible(), "video: a drop zone for a video file");
log(/video/.test((await page.locator(".video-tool input[type=file]").getAttribute("accept")) ?? ""), "video: accepts video files");

// --- rhythm: a round runs from the audio clock; taps are judged and scored ---
await page.goto(`${BASE}#/rhythm`, { waitUntil: "load" });
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(300);
log((await page.locator(".rhythm-step.is-hit").count()) === 4, "rhythm: the default pattern shows four hits");
await page.locator("input[aria-label='קצב']").fill("200");
await page.locator(".rhythm-tool .primary-button").click();
await page.waitForSelector(".rhythm-pad.is-live", { timeout: 5_000 });
// Tap eight times at 200 BPM quarter notes (300 ms) once the count-in is over.
await page.waitForTimeout(1300);
for (let index = 0; index < 8; index += 1) {
  await page.keyboard.press("Space");
  await page.waitForTimeout(300);
}
await page.waitForSelector(".rhythm-score", { timeout: 10_000 });
const rhythmAccuracy = (await page.locator(".rhythm-score .stat-card strong").first().textContent()) ?? "";
log(/\d+%/.test(rhythmAccuracy), "rhythm: the round ends with a score", rhythmAccuracy);
log((await page.locator(".rhythm-tap").count()) === 8, "rhythm: every tap is drawn against its hit");

// --- mixer: two copies of the demo become a stereo mix ---
await page.goto(`${BASE}#/mixer`, { waitUntil: "load" });
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(300);
await page.locator(".mixer-add input[type=file]").setInputFiles([DEMO, DEMO]);
await page.waitForFunction(() => document.querySelectorAll(".mixer-track").length === 2, null, { timeout: 30_000 });
log(true, "mixer: two tracks load side by side");
await page.locator(".mixer-track").nth(1).locator("button[aria-label^='השתק']").click();
log((await page.locator(".mixer-track.is-silent").count()) === 1, "mixer: muting silences one track");
await page.locator(".mixer-tool .download-buttons button", { hasText: "צור מיקס" }).click();
const [mixDownload] = await Promise.all([
  page.waitForEvent("download"),
  page.locator(".mixer-tool .download-buttons button", { hasText: "הורד" }).click({ timeout: 60_000 }),
]);
const mixBytes = readFileSync(await mixDownload.path());
log(mixDownload.suggestedFilename().endsWith("-mix.wav") && mixBytes.length > 44 && mixBytes.toString("ascii", 0, 4) === "RIFF", "mixer: the mix renders to a WAV", `${mixBytes.length} bytes`);

// --- lyrics: a saved work reopens as karaoke lines and exports LRC ---
await page.goto(`${BASE}#/lyrics`, { waitUntil: "load" });
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(300);
await page.locator(".drop-zone input[type=file]").setInputFiles(DEMO);
await page.waitForSelector(".lyrics-tool .transcript-signin", { timeout: 30_000 });
log(true, "lyrics: signed out, the run asks to sign in (the recogniser is on the server)");
await page.evaluate(() => {
  const now = new Date().toISOString();
  localStorage.setItem("music-tools.works.v1", JSON.stringify([{
    id: "l1", kind: "lyrics", title: "שיר", sourceName: "song.mp3",
    summary: { lines: 2, duration: 5 },
    payload: { lines: [
      { start: 0, end: 2, text: "שלום עולם", words: [{ text: "שלום", start: 0.1, end: 0.6 }, { text: "עולם", start: 0.8, end: 1.5 }] },
      { start: 2.5, end: 4, text: "מה נשמע", words: [{ text: "מה", start: 2.6, end: 2.9 }, { text: "נשמע", start: 3.1, end: 3.8 }] },
    ], language: "he" },
    fileName: null, deviceId: null, filePath: null, createdAt: now, updatedAt: now, localOnly: true,
  }]));
});
await page.locator(".account-button").click();
await page.waitForSelector(".me-item");
await page.locator(".me-item-title", { hasText: "שיר" }).first().click();
await page.waitForSelector(".lyrics-karaoke", { timeout: 10_000 });
log((await page.locator(".lyrics-word").count()) === 4, "lyrics: a saved work reopens with its words");
const [lrc] = await Promise.all([
  page.waitForEvent("download"),
  page.locator(".lyrics-tool .download-buttons button", { hasText: "LRC מילים" }).click(),
]);
const lrcText = readFileSync(await lrc.path(), "utf8");
log(/\[00:00\.00\]<00:00\.10>שלום <00:00\.80>עולם/.test(lrcText), "lyrics: the enhanced LRC carries word times", lrcText.split("\n")[1]);

// --- vocals pro mode: the mode switch exists and explains itself ---
await page.goto(`${BASE}#/vocals`, { waitUntil: "load" });
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(300);
await page.locator(".drop-zone input[type=file]").setInputFiles(DEMO);
await page.waitForSelector(".vocals-tool .segmented-control", { timeout: 30_000 });
await page.locator(".vocals-tool .segmented-control button", { hasText: "מקצועי" }).click();
log(await page.locator(".vocals-pro").isVisible(), "vocals: pro mode offers separation into stems");
log(/ערוצים/.test((await page.locator(".vocals-pro").textContent()) ?? ""), "vocals: pro mode explains the stems");

// --- text to speech: the browser's voices, with a server file behind sign-in ---
await page.goto(`${BASE}#/tts`, { waitUntil: "load" });
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(300);
const ttsSample = "שלום, זהו מבחן הקראה.";
await page.locator(".tts-text").fill(ttsSample);
log((await page.locator(".tts-meta").textContent() ?? "").includes(`${ttsSample.length}/4000`), "tts: counts the characters");
log((await page.locator(".tts-tool .transport-button.primary").isEnabled()), "tts: the read-aloud button is ready");
log(await page.locator(".tts-tool .download-buttons button").first().isDisabled(), "tts: the server MP3 waits for a sign-in");

// --- song identifier: hidden from visitors, so its address lands on the hub ---
await page.goto(`${BASE}#/identify`, { waitUntil: "load" });
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(600);
log(await page.locator(".hub-hero").isVisible(), "identify: hidden, its address lands on the hub");
log((await page.locator(".tool-card", { hasText: "מזהה שיר" }).count()) === 0, "identify: no card for it on the hub");

// --- transcript extras: a reopened transcript has search with jump and a speakers button ---
await page.evaluate(() => {
  const now = new Date().toISOString();
  localStorage.setItem("music-tools.works.v1", JSON.stringify([{
    id: "t2", kind: "transcript", title: "פגישה", sourceName: "meeting.m4a",
    summary: { words: 6, duration: 9, languageLabel: "עברית" },
    payload: { segments: [{ start: 0, end: 4, text: "דנה: שלום לכולם" }, { start: 4.5, end: 9, text: "יוסי: ברוכים הבאים לפגישה" }], language: "he", model: "whisper-1" },
    fileName: null, deviceId: null, filePath: null, createdAt: now, updatedAt: now, localOnly: true,
  }]));
});
await page.goto(`${BASE}#/transcript`, { waitUntil: "load" });
await page.locator(".account-button").click();
await page.waitForSelector(".me-item");
await page.locator(".me-item-title", { hasText: "פגישה" }).first().click();
await page.waitForSelector(".transcript-result", { timeout: 10_000 });
log(/2 דוברים/.test((await page.locator(".transcript-stats").textContent()) ?? ""), "transcript: counts the speakers from the labels");
await page.locator(".transcript-search input").fill("פגישה");
log((await page.locator(".transcript-segments li").count()) === 1 && (await page.locator(".transcript-segments mark").count()) === 1, "transcript: search narrows the sentences and highlights the match");
log((await page.locator(".transcript-jump").count()) === 1, "transcript: each sentence can be jumped to");

// --- share page: a token route renders the share page, and a bad token explains itself ---
await page.goto(`${BASE}#/s/0123456789abcdef`, { waitUntil: "load" });
await page.waitForSelector(".share-page", { timeout: 10_000 });
log(true, "share: a token route opens the share page instead of the hub");
await page.waitForFunction(() => document.querySelector(".share-page .error-message") || document.querySelector(".share-page .tool-intro"), null, { timeout: 20_000 });
log((await page.locator(".share-page .error-message, .share-page .tool-intro").count()) > 0, "share: the page resolves the token (here: not reachable, explained)");

// --- the assistant: a corner button on every page, a panel with a sign-in prompt when signed out ---
log(await page.locator(".assistant-launcher").isVisible(), "assistant: the launcher sits at the corner of the page");
await page.locator(".assistant-launcher").click();
await page.waitForSelector(".assistant-panel", { timeout: 5_000 });
log(true, "assistant: the panel opens");
log((await page.locator(".assistant-suggestions .chip-toggle").count()) >= 3, "assistant: offers suggested questions");
log(await page.locator(".assistant-signin").isVisible(), "assistant: signed out, it asks to sign in instead of sending");
await page.keyboard.press("Escape");
await page.waitForSelector(".assistant-panel", { state: "detached", timeout: 5_000 });
log(true, "assistant: Escape closes it");

// --- the personal area: every tool saves, and the drawer shows it all ---
// Signed out, so everything below goes to this device; the drawer must still
// list it, and each kind must open back into its tool.
await page.goto(`${BASE}#/metronome`, { waitUntil: "load" });
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(400);
await page.evaluate(() => {
  localStorage.removeItem("music-tools.works.v1");
  localStorage.removeItem("music-tools.ringtone-history.v1");
});
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(400);
await page.locator(".bpm-slider").fill("137");
await page.locator(".save-work-button").click();
await page.waitForTimeout(400);
const metroSaved = (await page.locator(".save-work-button").textContent()) ?? "";
log(/נשמר/.test(metroSaved), "save: the metronome preset saves", metroSaved.trim());
log(
  /במכשיר/.test((await page.locator(".save-work-note").textContent()) ?? ""),
  "save: without an account the note says it stayed on this device",
);

await page.goto(`${BASE}#/tuner`, { waitUntil: "load" });
await page.waitForTimeout(300);
await page.locator(".segmented-control button", { hasText: "גיטרה" }).first().click();
await page.locator(".save-work-button").click();
await page.waitForTimeout(400);
log(/נשמר/.test((await page.locator(".save-work-button").textContent()) ?? ""), "save: the tuner setup saves");

// The ear trainer only offers to save once a question has been answered.
await page.goto(`${BASE}#/ear`, { waitUntil: "load" });
await page.evaluate(() => localStorage.removeItem("musictools.eartraining.v1"));
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(300);
log(await page.locator(".save-work-button").isDisabled(), "save: an unplayed ear session cannot be saved");
await page.locator(".segmented-control button", { hasText: "מתחיל" }).first().click();
await page.locator(".ear-empty button").click();
await page.waitForSelector(".ear-choices button", { timeout: 10_000 });
await page.locator(".ear-choices button").first().click();
await page.waitForTimeout(200);
await page.locator(".save-work-button").click();
await page.waitForTimeout(400);
log(/נשמר/.test((await page.locator(".save-work-button").textContent()) ?? ""), "save: the ear session saves");

// A karaoke track: the record goes to the list, the audio to this device.
await page.goto(`${BASE}#/vocals`, { waitUntil: "load" });
await page.waitForTimeout(300);
await page.locator(".drop-zone input[type=file]").setInputFiles(DEMO);
await page.waitForFunction(
  () => {
    const button = document.querySelector(".save-work-button");
    return button && !button.disabled;
  },
  null,
  { timeout: 60_000 },
);
await page.locator(".save-work-button").click();
await page.waitForFunction(
  () => /נשמר/.test(document.querySelector(".save-work-button")?.textContent ?? ""),
  null,
  { timeout: 15_000 },
);
log(true, "save: the karaoke track saves with its file");

// The drawer: opens from the account button, lists everything, filters, and
// hands a work back to its tool.
await page.locator(".account-button").click();
await page.waitForSelector(".account-drawer", { timeout: 5_000 });
log(await page.locator(".account-drawer").isVisible(), "area: the drawer slides in from the account button");
await page.waitForFunction(
  () => document.querySelectorAll(".me-item").length >= 4,
  null,
  { timeout: 10_000 },
);
const listed = await page.locator(".me-item").count();
log(listed === 4, "area: all four saved works are listed", `found ${listed}`);
const kinds = (await page.locator(".me-kinds").textContent()) ?? "";
log(
  /קצב שמור/.test(kinds) && /כיוון כלי/.test(kinds) && /אימון שמיעה/.test(kinds) && /הסרת שירה/.test(kinds),
  "area: one filter chip per kind of work",
  kinds.replace(/\s+/g, " ").trim(),
);
const fileBadges = await page.locator(".me-badge.is-file").count();
log(fileBadges === 1, "area: the karaoke track shows its file is on this device", `found ${fileBadges}`);
log(
  (await page.locator(".me-item .icon-button[aria-label='נגן']").count()) === 1,
  "area: only the work with a file offers to play",
);
log(
  /137 BPM/.test((await page.locator(".me-item", { hasText: "קצב שמור" }).textContent()) ?? ""),
  "area: the metronome card says which tempo it holds",
);
log(
  /דיוק/.test((await page.locator(".me-side").textContent()) ?? ""),
  "area: the side shows the ear-training progress",
);

// The stored file is real audio and comes back as a download.
const [savedTrack] = await Promise.all([
  page.waitForEvent("download"),
  page.locator(".me-item .icon-button[aria-label='הורד את הקובץ']").click(),
]);
const savedStats = rmsOf(await savedTrack.path());
log(savedStats.frames > 1000 && savedStats.rms > 0.001, "area: the stored karaoke track downloads as real audio",
  `rms ${savedStats.rms.toFixed(3)}`);

await page.locator(".me-search input").fill("גיטרה");
await page.waitForTimeout(200);
log((await page.locator(".me-item").count()) === 1, "area: search narrows the list");
await page.locator(".me-search input").fill("");
await page.locator(".me-kinds .chip-toggle", { hasText: "קצב שמור" }).click();
await page.waitForTimeout(200);
log((await page.locator(".me-item").count()) === 1, "area: a kind chip narrows the list");

// Rename in place.
await page.locator(".me-item .icon-button[aria-label='שנה שם']").click();
await page.locator(".me-rename input").fill("הקצב של השיר שלי");
await page.keyboard.press("Enter");
await page.waitForTimeout(300);
log(
  /הקצב של השיר שלי/.test((await page.locator(".me-item-title").first().textContent()) ?? ""),
  "area: a work can be renamed in place",
);

// Opening a preset lands in the metronome with that tempo.
await page.locator(".me-item-title").first().click();
await page.waitForTimeout(500);
log(!(await page.locator(".account-drawer").count()), "area: opening a work closes the drawer");
const reopenedBpm = await page.locator(".bpm-value strong").textContent();
log(
  page.url().endsWith("#/metronome") && reopenedBpm === "137",
  "area: the preset reopens the metronome at its tempo",
  `${page.url().split("#")[1]} at ${reopenedBpm}`,
);

// Escape closes; the focus returns to the button that opened it.
await page.locator(".account-button").click();
await page.waitForSelector(".account-drawer");
await page.keyboard.press("Escape");
await page.waitForTimeout(300);
log(!(await page.locator(".account-drawer").count()), "area: Escape closes the drawer");
log(
  await page.evaluate(() => document.activeElement?.classList.contains("account-button")),
  "area: focus returns to the account button",
);

// Delete removes the entry and its file.
await page.locator(".account-button").click();
await page.waitForSelector(".me-item");
page.once("dialog", (dialog) => dialog.accept());
await page.locator(".me-item", { hasText: "הסרת שירה" }).locator(".icon-button.is-danger").click();
await page.waitForTimeout(400);
log((await page.locator(".me-badge.is-file").count()) === 0, "area: deleting a work removes it and its file");
await page.keyboard.press("Escape");
await page.waitForTimeout(200);

// --- dark/light toggle ---
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(300);
const themeBefore = await page.evaluate(() => document.documentElement.dataset.theme);
await page.locator("button.theme-toggle").click();
await page.waitForTimeout(200);
await page.locator("button.theme-toggle").click();
await page.waitForTimeout(300);
const themeAfter = await page.evaluate(() => document.documentElement.dataset.theme);
log(themeBefore !== themeAfter, "theme toggle switches theme", `${themeBefore} -> ${themeAfter}`);

// --- mobile viewport: no horizontal overflow ---
const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
await mobile.goto(BASE, { waitUntil: "networkidle" });
const overflow = await mobile.evaluate(
  () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
);
log(overflow <= 1, "mobile 390px: no horizontal overflow", `${overflow}px`);
await mobile.close();

const realErrors = consoleErrors.filter(
  (t) => !/favicon|fonts.googleapis|supabase|Failed to load resource/i.test(t),
);
log(realErrors.length === 0, "no unexpected console errors", realErrors.slice(0, 3).join(" | "));

await browser.close();
console.log(`\n${failures.length ? `${failures.length} FAILURES:\n- ` + failures.join("\n- ") : "ALL CHECKS PASSED"}`);
process.exit(failures.length ? 1 : 0);
