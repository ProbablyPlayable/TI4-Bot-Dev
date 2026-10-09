// JSPI proof: the engine's blocking decider is answered from a promise in Chromium.
// Usage (from web2/, which has Playwright): node ../crates/ti4-wasm/js/jspi.mjs <file.wasm>
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(`${process.cwd()}/`);
const { chromium } = require("@playwright/test");

const wasm = readFileSync(process.argv[2]).toString("base64");
const browser = await chromium.launch();
const page = await browser.newPage();
const report = await page.evaluate(async (base64) => {
  if (!("Suspending" in WebAssembly)) return { error: "no JSPI in this browser" };
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  let exports;
  const text = (pointer, length) =>
    new TextDecoder().decode(new Uint8Array(exports.memory.buffer, pointer, length));
  // An export returns a length, negated when the response buffer holds an error text.
  const response = (status) => {
    const body = text(exports.ti4_response_ptr(), Math.abs(status));
    if (status < 0) throw new Error(body);
    return JSON.parse(body);
  };
  const asked = [];
  // The engine calls this synchronously; JSPI parks the wasm stack until the promise settles.
  const ask = new WebAssembly.Suspending(async () => {
    // A real timer tick: the event loop runs while the game is parked.
    await new Promise((resolve) => setTimeout(resolve, 5));
    // A query into the same instance while its game is suspended.
    const choice = JSON.parse(text(exports.ti4_pending_ptr(), exports.ti4_pending_len()));
    asked.push(`${choice.player}: ${choice.prompt} [${choice.options.length}]`);
    return choice.options.length - 1;
  });
  ({ exports } = (await WebAssembly.instantiate(bytes, { host: { ask } })).instance);
  const play = WebAssembly.promising(exports.ti4_play_hosted);
  const started = performance.now();
  const running = play(7, 10);
  const pendingBeforeFirstAnswer = running instanceof Promise;
  const result = response(await running);
  return { pendingBeforeFirstAnswer, asked, result, ms: Math.round(performance.now() - started) };
}, wasm);
console.log(`chromium ${browser.version()}`);
console.log(JSON.stringify(report, null, 2));
await browser.close();
if (report.error || report.asked.length !== 10) process.exit(1);
