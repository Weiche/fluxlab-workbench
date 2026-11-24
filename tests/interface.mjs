import { chromium, _electron } from "@playwright/test";
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaults, initial, solve } from "../src/model.ts";
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
  assert.equal(
    await page
      .getByLabel("计入定子电阻", { exact: true })
      .evaluate((input) => input.closest("details").dataset.group),
    "motor",
  );
  assert.equal(await page.locator("#tn-card + .plots").count(), 1);
  const speedChart = page.locator("#tn");
  const showNegative = page.getByRole("checkbox", { name: "显示负转矩" });
  assert.equal(await showNegative.isChecked(), false);
  assert.match(await speedChart.getAttribute("aria-label"), /非负转矩/);
  const axis = await speedChart.boundingBox();
  const speedSlider = page.locator("#s-rpm");
  const sliderBox = await speedSlider.boundingBox();
  assert.ok(sliderBox.y >= axis.y + axis.height);
  closeTo(sliderBox.x + 7, axis.x + 58);
  closeTo(sliderBox.x + sliderBox.width - 7, axis.x + axis.width - 34);
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
  const preset = page.getByRole("combobox", { name: "载入预设" });
  const replayMode = page.getByRole("combobox", { name: "回放方式" });
  const keepMaxOutput = page.getByRole("checkbox", { name: "保持最大出力" });
  assert.equal(await replayMode.inputValue(), "step");
  await preset.selectOption("mixed");
  await replayMode.selectOption("step");
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
  const maxOutput = page.getByRole("checkbox", { name: "最大出力转矩" });
  const torque = page.locator("#n-torque");
  assert.ok(!(await maxOutput.isChecked()));
  await maxOutput.check();
  await wait("f-torque", "23.05 kW");
  assert.equal(await torque.inputValue(), "73.39");
  assert.ok(await torque.evaluate((el) => el.readOnly));
  assert.ok(await page.locator("#s-torque").isHidden());
  const maxProject = await grab("save");
  assert.equal(JSON.parse(maxProject).o.maxOutput, true);

  await page.locator("#n-rpm").fill("-4500");
  await page.locator("#n-rpm").press("Enter");
  await wait("f-torque", "26.04 kW");
  assert.equal(await torque.inputValue(), "-55.25");
  await maxOutput.uncheck();
  await wait("f-torque", "目标");
  assert.ok(!(await torque.evaluate((el) => el.readOnly)));
  assert.ok(Math.abs(Number(await torque.inputValue()) + 55.25) < 0.005);
  assert.ok(await page.locator("#s-torque").isVisible());
  await torque.fill("-25");
  await torque.press("Enter");
  await wait("m-torque", "-25.0");
  const hiddenPoint = page.getByText("当前运行点为负转矩", { exact: true });
  assert.ok(await hiddenPoint.isVisible());
  const minSpeed = await speedSlider.getAttribute("min");
  const maxSpeed = await speedSlider.getAttribute("max");
  await showNegative.check();
  assert.match(await speedChart.getAttribute("aria-label"), /正负转矩/);
  assert.ok((await speedChart.boundingBox()).height > axis.height);
  assert.ok(await hiddenPoint.isHidden());
  assert.ok(await page.locator("#tn-point-key").isVisible());
  assert.equal(await speedSlider.getAttribute("min"), minSpeed);
  assert.equal(await speedSlider.getAttribute("max"), maxSpeed);
  assert.equal(await text("m-torque"), "-25.0");
  await showNegative.uncheck();
  assert.match(await speedChart.getAttribute("aria-label"), /非负转矩/);
  assert.ok(await hiddenPoint.isVisible());

  await file("open", {
    name: "max-output.json",
    mimeType: "application/json",
    buffer: maxProject,
  });
  await wait("f-torque", "23.05 kW");
  assert.ok(await maxOutput.isChecked());
  assert.equal(await torque.inputValue(), "73.39");
  const rangeInput = page.locator("#n-speed-span");
  const rpmInput = page.locator("#n-rpm");
  const waitForRange = (value) =>
    page.waitForFunction(
      (expected) => document.getElementById("s-rpm").max === expected,
      value,
    );
  await waitForRange("11000");
  const automatic = Number(await speedSlider.getAttribute("max"));
  const busVoltage = page.locator("#n-vdc");
  await busVoltage.fill("200");
  await busVoltage.press("Enter");
  await waitForRange("8100");
  await busVoltage.fill("260");
  await busVoltage.press("Enter");
  await waitForRange("11000");
  await rangeInput.fill("24000");
  await rangeInput.press("Enter");
  assert.equal(await speedSlider.getAttribute("max"), "24000");
  assert.equal(await speedSlider.getAttribute("min"), "-24000");
  const rangeProject = await grab("save");
  assert.equal(JSON.parse(rangeProject).speedRange, 24000);
  await rpmInput.fill("29000");
  await rpmInput.press("Enter");
  await wait("m-speed", "29,000");
  assert.ok(Number(await speedSlider.getAttribute("max")) >= 29000);
  assert.equal(await speedSlider.inputValue(), "29000");
  await file("open", {
    name: "speed-range.json",
    mimeType: "application/json",
    buffer: rangeProject,
  });
  await wait("m-speed", "3,000");
  assert.equal(await speedSlider.getAttribute("max"), "24000");
  await rangeInput.fill("");
  await rangeInput.press("Enter");
  await waitForRange(String(automatic));
  assert.equal(await rangeInput.inputValue(), String(automatic));

  await by("batch").click();
  assert.deepEqual(await preset.locator("option").allTextContents(), [
    "载入预设",
    "升降速",
    "高速区扫描",
    "正反转",
    "混合工况示例",
  ]);
  await preset.selectOption("high-speed");
  assert.equal(await replayMode.inputValue(), "smooth");
  assert.ok(await keepMaxOutput.isChecked());
  await wait("m-speed", "3,500");
  const readSpeed = () =>
    Number(document.getElementById("m-speed").textContent.replaceAll(",", ""));
  await by("play").click();
  await page.waitForFunction(() => {
    const rpm = Number(
      document.getElementById("m-speed").textContent.replaceAll(",", ""),
    );
    return rpm > 3700 && rpm < 4700;
  });
  await by("play").click();
  await wait("live", "实时求解");
  const held = await page.evaluate(readSpeed);
  assert.ok(held > 3700 && held < 5000);
  const maximum = solve(defaults, { ...initial, rpm: held, maxOutput: true });
  assert.ok(
    Math.abs(Number(await text("m-torque")) - maximum.point.torque) < 0.11,
  );
  await page.waitForTimeout(120);
  assert.equal(await page.evaluate(readSpeed), held);
  await by("play").click();
  await wait("m-speed", "8,500");
  await wait("live", "实时求解");
  assert.equal(await page.locator("tr.active").getAttribute("data-row"), "3");
  assert.equal(await by("play").getAttribute("aria-label"), "播放");
  const replayProject = await grab("save");
  assert.deepEqual(JSON.parse(replayProject).replay, {
    mode: "smooth",
    keepMaxOutput: true,
  });

  await preset.selectOption("mixed");
  await wait("m-torque", "24.0");
  await keepMaxOutput.check();
  await wait("f-torque", "机械转换功率");
  assert.match(await page.locator("tr.active").innerText(), /最大出力/);
  await keepMaxOutput.uncheck();
  await wait("m-torque", "24.0");
  await file("batch-import", {
    name: "speeds.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("rpm\n1000\ninvalid\n-3000"),
  });
  await wait("batch-list", "缺少有效数值");
  await by("play").click();
  await wait("m-speed", "-3,000");
  await wait("live", "实时求解");
  assert.equal(await page.locator("tr.active").getAttribute("data-row"), "2");
  assert.ok(Number(await text("m-torque")) < 0);
  await by("export-menu").click();
  assert.match((await grab("csv")).toString(), /"max-output","-3000",""/);
  await file("open", {
    name: "saved-replay.json",
    mimeType: "application/json",
    buffer: replayProject,
  });
  await wait("m-speed", "8,500");
  assert.equal(await replayMode.inputValue(), "smooth");
  assert.ok(await keepMaxOutput.isChecked());
  assert.deepEqual(errors, []);
  console.log(
    "Passed interaction, dual solvers, map, overshoot, stepped and smooth replay, presets, invalid rows, PNG/CSV, project save/reopen, reset, automatic speed range and signed torque display.",
  );
} finally {
  if (desktop) await desktop.close();
  if (browser) await browser.close();
  await rm(downloadDir, { recursive: true, force: true });
}

function closeTo(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 0.1, `${actual} != ${expected}`);
}
