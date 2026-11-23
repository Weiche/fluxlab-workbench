import { chromium } from "@playwright/test";
import { defaults, initial } from "../src/model.ts";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
  args: [
    "--no-sandbox",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
  ],
});
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
  });
  await page.goto(process.env.APP_URL || "http://localhost:5173");
  const axis = Array.from({ length: 101 }, (_, i) => (i - 50) * 3);
  const map = {
    d: axis,
    q: axis,
    fd: axis.map((d) =>
      axis.map((q) => 0.09 + (0.00045 * d) / (1 + 0.09 * (q / 120) ** 2)),
    ),
    fq: axis.map((d) =>
      axis.map(
        (q) =>
          (0.0009 * q) / (1 + 0.14 * (q / 120) ** 2 + 0.05 * (d / 120) ** 2),
      ),
    ),
  };
  const project = {
    version: 1,
    name: "101×101",
    p: { ...defaults, model: "map", map },
    o: initial,
    rows: [],
    mapName: "基准磁链图",
  };
  await page.locator('[data-action="open"]').click({ noWaitAfter: true });
  await page.locator("#file").setInputFiles({
    name: "bench.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await page.waitForFunction(
    () =>
      document.querySelector("#model-meta").textContent.includes("磁链图") &&
      document.querySelector("#method").textContent === "数值法",
  );
  const param = process.env.BENCH_PARAM || "torque";
  const stats = await page.evaluate(async (param) => {
    const keys = {
      torque: ["f-torque", 25, 0.5],
      rpm: ["m-speed", 2300, 10],
      imax: ["f-current", 115, 1],
      vdc: ["f-voltage", 245, 1],
    };
    const [id, base, step] = keys[param],
      slider = document.querySelector("#s-" + param),
      target = document.querySelector("#" + id),
      stamps = new Map(),
      samples = [];
    const parse = () =>
      param === "rpm"
        ? Number(target.textContent.replaceAll(",", ""))
        : parseFloat(target.textContent.split(" ")[1]);
    const displayed = (v) =>
      param === "vdc" ? Number((v / Math.sqrt(3)).toFixed(1)) : v;
    let paintRequest = 0;
    const observer = new MutationObserver(() => {
      const v = parse();
      if (stamps.has(v)) {
        const at = stamps.get(v);
        cancelAnimationFrame(paintRequest);
        paintRequest = requestAnimationFrame(() =>
          samples.push(performance.now() - at),
        );
        stamps.delete(v);
      }
    });
    observer.observe(target, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    const start = performance.now();
    let inputCount = 0,
      lastSet;
    await new Promise((resolve) => {
      function tick(now) {
        if (now - start >= 10000) {
          resolve();
          return;
        }
        const value = base + (inputCount % 55) * step;
        slider.value = String(value);
        lastSet = performance.now();
        stamps.set(displayed(value), lastSet);
        slider.dispatchEvent(new Event("input", { bubbles: true }));
        inputCount++;
        requestAnimationFrame(tick);
      }
      requestAnimationFrame(tick);
    });
    const end = performance.now();
    slider.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((resolve) => {
      function check() {
        if (
          parse() === displayed(Number(slider.value)) &&
          document.querySelector("#live").textContent === "实时求解"
        )
          resolve();
        else requestAnimationFrame(check);
      }
      check();
    });
    const settledMs = performance.now() - lastSet;
    observer.disconnect();
    samples.sort((a, b) => a - b);
    return {
      param,
      durationMs: end - start,
      inputs: inputCount,
      rendered: samples.length,
      chartFps: (samples.length * 1000) / (end - start),
      p95ms: samples[Math.floor(samples.length * 0.95)],
      settledMs,
    };
  }, param);
  console.log(JSON.stringify(stats));
  assert.ok(stats.chartFps >= 30);
  assert.ok(stats.p95ms < 50);
  assert.ok(stats.settledMs < 300);
} finally {
  await browser.close();
}
