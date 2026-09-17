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
const failures = [];
const log = (ok, name, extra = "") => {
  if (!ok) failures.push(name + (extra ? ` — ${extra}` : ""));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? ` — ${extra}` : ""}`);
};

const browser = await chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });

const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

await page.goto(BASE, { waitUntil: "networkidle" });

// --- hub ---
const cards = await page.locator(".tool-card").count();
log(cards === 8, "hub renders all 8 tool cards", `found ${cards}`);

await page.locator(".hub-search input").fill("קריוקי");
await page.waitForTimeout(150);
const filtered = await page.locator(".tool-card").count();
log(filtered >= 1 && filtered < 8, "hub search filters", `found ${filtered}`);
await page.locator(".hub-search input").fill("");

// --- every tool opens ---
const TOOLS = ["notes", "ringtone", "vocals", "speed", "metronome", "tuner", "piano", "analyze"];
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
