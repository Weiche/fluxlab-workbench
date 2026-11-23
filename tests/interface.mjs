import { chromium, _electron } from "@playwright/test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const downloadDir = await mkdtemp(join(tmpdir(), "fluxlab-test-"));
const desktop = process.env.ELECTRON_BIN
  ? await _electron.launch({
      executablePath: process.env.ELECTRON_BIN,
      args: [
        ...(process.platform === "linux"
          ? [
              "--headless",
              "--ozone-platform=headless",
              "--disable-gpu",
              "--no-sandbox",
            ]
          : []),
        ...(process.env.ELECTRON_APP ? [process.env.ELECTRON_APP] : []),
      ],
    })
  : null;
const browser = desktop
  ? null
  : await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
      args: ["--no-sandbox"],
    });
try {
  const page = desktop
    ? await desktop.firstWindow()
    : await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  if (!desktop) await page.goto(process.env.APP_URL || "http://localhost:5173");
  const by = (a) => page.locator('[data-action="' + a + '"]'),
    text = (id) => page.locator("#" + id).innerText();
  const wait = (id, expected) =>
    page.waitForFunction(
      ([id, s]) => document.getElementById(id).textContent.includes(s),
      [id, expected],
    );
  async function file(action, payload) {
    await by(action).click();
    await page.locator("#file").setInputFiles(payload);
  }
  if (desktop)
    await desktop.evaluate(({ session }, dir) => {
      session.defaultSession.on("will-download", (_event, item) => {
        const path = dir + "/" + item.getFilename();
        item.setSavePath(path);
        item.once("done", (_event, state) => {
          globalThis.testExport = state === "completed" ? path : "failed";
        });
      });
    }, downloadDir);
  async function grab(action) {
    if (desktop) {
      await desktop.evaluate(() => {
        globalThis.testExport = null;
      });
      await by(action).click();
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const file = await desktop.evaluate(() => globalThis.testExport);
        if (file) return readFile(file);
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw Error("Desktop download did not finish: " + action);
    }
    const promise = page.waitForEvent("download");
    await by(action).click();
    const d = await promise;
    return readFile(await d.path());
  }
  await wait("status", "可行运行点");
  assert.equal(await text("m-torque"), "48.0");
  assert.ok(await page.locator("#current + .legend .mtpv").isVisible());
  assert.equal(await page.locator("#model-choice").inputValue(), "engineering");
  assert.equal(await text("method"), "数值法");
  assert.ok(await page.getByLabel("计入定子电阻", { exact: true }).isChecked());
  assert.match(await text("values"), /电阻压降.*-1.22.*3.52/);
  assert.match(await text("values"), /永磁反电动势/);
  assert.match(
    await page.locator("label[for=s-vdc]").innerHTML(),
    /V<sub>dc<\/sub>/,
  );
  assert.match(await page.locator("#values").innerHTML(), /ψ<sub>f<\/sub>/);
  assert.match(await text("values"), /电感电压.*-88.57.*-15.28/);
  assert.match(
    await page.locator("#voltage + .legend").innerText(),
    /逆变器六边形/,
  );
  assert.match(
    await page.locator("#voltage + .legend").innerText(),
    /永磁反电动势\s+电感电压\s+电阻压降/,
  );
  const pwm = page.getByLabel("调制方式", { exact: true });
  assert.equal(await pwm.inputValue(), "SVPWM");
  await pwm.selectOption("SPWM");
  await wait("f-voltage", "130.0 V");
  assert.match(
    await page.locator("#voltage + .legend").innerText(),
    /SPWM 电压限值/,
  );
  await pwm.selectOption("SVPWM");
  await wait("f-voltage", "150.1 V");
  const directLimit = page.getByLabel("直接给定可用电压上限", { exact: true });
  await directLimit.check();
  assert.ok(await pwm.isDisabled());
  assert.ok(await page.locator("#s-vdc").isVisible());
  assert.ok(await page.locator("#s-vmax").isVisible());
  await directLimit.uncheck();
  await page.locator("#model-choice").selectOption("ideal");
  await wait("method", "解析法");
  assert.match(await text("values"), /电阻压降.*0.00.*0.00/);
  await by("compare").click();
  await wait("dialog-body", "数值法");
  await by("close").click();
  await by("manual").click();
  await page.locator("#n-iq").fill("155");
  await page.locator("#n-iq").press("Enter");
  await wait("status", "超出约束");
  const saved = await grab("save");
  const project = JSON.parse(saved);
  assert.equal(project.o.iq, 155);
  await by("export-menu").click();
  const csv = (await grab("csv")).toString();
  assert.match(csv, /155/);
  assert.match(csv, /超出约束/);
  await by("export-menu").click();
  assert.equal((await grab("png")).subarray(1, 4).toString(), "PNG");
  await by("expand-voltage").click();
  assert.ok(await page.locator("#zoom").isVisible());
  assert.match(await page.locator("#zoom + .legend").innerText(), /电感电压/);
  assert.match(
    await page.locator("#zoom + .legend").innerText(),
    /逆变器六边形/,
  );
  await by("close").click();
  await page.locator("#model-choice").selectOption("map");
  await by("map-sample").click();
  await wait("status", "超出磁链图");
  assert.ok(await page.locator("#current + .legend .mtpv").isHidden());
  assert.match(
    await page.locator("#voltage + .legend").innerText(),
    /q 轴磁链项/,
  );
  assert.match(await text("values"), /d 轴磁链项/);
  await file("open", {
    name: "saved.json",
    mimeType: "application/json",
    buffer: saved,
  });
  await wait("status", "超出约束");
  assert.equal(await page.locator("#n-iq").inputValue(), "155");
  assert.equal(await page.locator("#model-choice").inputValue(), "ideal");
  await by("batch").click();
  await by("sample").click();
  await wait("batch-list", "目标不可达");
  await by("next").click();
  await wait("m-torque", "48.0");
  await by("play").click();
  await page.waitForTimeout(1050);
  await by("play").click();
  assert.equal(await page.locator("tr.active").getAttribute("data-row"), "2");
  await by("export-menu").click();
  assert.equal((await grab("csv")).toString().trim().split("\n").length, 9);
  await file("batch-import", {
    name: "bad.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      "mode,rpm,torque_Nm,id_A,iq_A\nauto,3000,,,\nauto,1000,24,,",
    ),
  });
  await wait("status", "输入无效");
  assert.equal(await text("m-torque"), "—");
  await by("next").click();
  await wait("m-torque", "24.0");
  await by("analysis").click();
  await by("reset").click();
  await by("confirm-reset").click();
  await wait("m-torque", "48.0");
  await wait("method", "数值法");
  assert.equal(await page.locator("#model-choice").inputValue(), "engineering");
  assert.ok(await page.getByLabel("计入定子电阻", { exact: true }).isChecked());
  assert.deepEqual(errors, []);
  console.log(
    "Passed interaction, dual solvers, map, overshoot, replay, invalid rows, PNG/CSV, project save/reopen and reset.",
  );
} finally {
  if (desktop) await desktop.close();
  if (browser) await browser.close();
  await rm(downloadDir, { recursive: true, force: true });
}
