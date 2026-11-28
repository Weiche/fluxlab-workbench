import "./style.css";
import { icon } from "./icons.ts";
import {
  defaults,
  initial,
  limit,
  isMaxOutput,
  pwmMethods,
  statusText,
  type Parameters,
  type Operation,
  type Result,
} from "./model.ts";
import {
  bounds,
  readBatch,
  readMap,
  readProject,
  download,
  type Row,
} from "./files.ts";
import {
  chart,
  inverterBoundaryColor,
  mtpvColor,
  type Frame,
} from "./charts.ts";
import type { Geometry } from "./geometry.ts";
import { voltageComponents } from "./voltage.ts";
import { math, mathHtml, mathCanvasLayout, type MathText } from "./notation.ts";
import SolverWorker from "./worker.ts?worker&inline";
import SpeedWorker from "./tn-worker.ts?worker&inline";
import type { SpeedResponse } from "./tn-worker.ts";
import {
  drawSpeedChart,
  envelopeColor,
  speedAxis,
  speedSpan,
  type SpeedRangeEstimate,
  type TorqueEnvelope,
} from "./tn.ts";
import {
  commandType,
  defaultReplay,
  interpolateCommand,
  replayOperation,
  replayTransition,
  sameReplayCommand,
  type ReplaySettings,
  type ReplayTransition,
} from "./replay.ts";
import batchExample from "../public/examples/operating-points.csv?raw";
import speedExample from "../public/examples/playback-speeds.csv?raw";
import mapExample from "../public/examples/flux-map.csv?raw";
import {
  motorPresets,
  findMotorPreset,
  type MotorPreset,
} from "./motor-presets.ts";

const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id)! as T;
const esc = (v: unknown) =>
  String(v).replace(
    /[&<>"']/g,
    (s) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        s
      ]!,
  );
const f = (n: number | undefined | null, k = 1) =>
  n == null ? "—" : n.toFixed(k);
const modelNames = {
  ideal: "理想模型",
  engineering: "常参数工程模型",
  map: "磁链图模型",
};
let p: Parameters = { ...defaults },
  o: Operation = { ...initial },
  name = "IPMSM 基准电机",
  motorPresetId: string | undefined,
  mapName = "",
  rows: Row[] = [],
  rowIndex = -1,
  batchResults: (Result | null)[] = [];
let tab: "analysis" | "batch" = "analysis",
  compare = false,
  comparison: Result | null = null,
  frame: Frame | null = null;
let expanded: "current" | "voltage" | null = null,
  playing = 0,
  dirty = true,
  busy = false,
  id = 0,
  revision = 1,
  sentRevision = 0;
let replay: ReplaySettings = defaultReplay;
let replayLeg: {
  next: number;
  elapsed: number;
  commands: ReplayTransition | null;
} | null = null;
let replayClock: number | null = null;
let replaySpan = 0;
let peakPresetSpeed: number | null = null;
const replayDuration = 900;
const peakPresetId = "peak-speed";
const replayPresets = [
  { id: "ramp", label: "升降速", csv: speedExample },
  { id: peakPresetId, label: "0 → 最高速 → 0", csv: null },
  { id: "high-speed", label: "高速区扫描", csv: "rpm\n3500\n5000\n6500\n8500" },
  { id: "reverse", label: "正反转", csv: "rpm\n0\n3000\n0\n-3000\n0" },
  { id: "mixed", label: "混合工况示例", csv: batchExample },
];
let speedRange: number | undefined;
let displayedSpeedRange = "";
let tnSpan = 1,
  tnParameters: Parameters | null = null,
  tnEstimate: SpeedRangeEstimate | undefined,
  tnEnvelope: TorqueEnvelope | null = null;
let tnWorker: Worker | null = null,
  tnTimer = 0,
  tnNeedsEnvelope = false;
let sentMap: Parameters["map"] = null;
let lastG: Geometry | null = null,
  batchRevision = 0,
  batchWorker: Worker | null = null,
  batchReady = false,
  toastTimer = 0;
const worker = new SolverWorker();
const iconButton = (action: string, title: string, ic: string) =>
  '<button class="ico-btn" data-action="' +
  action +
  '" title="' +
  title +
  '" aria-label="' +
  title +
  '">' +
  icon(ic) +
  "</button>";
const voltageLegend = (parameters: Parameters) =>
  '<span><i style="--color:#2963d9"></i>端电压</span>' +
  voltageComponents(parameters, 0, null)
    .map(
      ({ label, color }) =>
        `<span><i style="--color:${color}"></i>${label}</span>`,
    )
    .join("") +
  `<span><i class="dash" style="--color:#ce8740"></i>${parameters.direct ? "给定电压限值" : parameters.pwm + " 电压限值"}</span>` +
  `<span><i style="--color:${inverterBoundaryColor}"></i>逆变器六边形</span>`;
const legend = (kind: string) =>
  kind === "current"
    ? `<span><i class="area"></i>可行域</span><span><i style="--color:#2963d9"></i>电流极限</span><span><i style="--color:#ce8740"></i>电压极限</span><span><i class="dash" style="--color:#9670ba"></i>等转矩线</span><span class="mtpa"><i class="dash" style="--color:#10988b"></i>MTPA</span><span class="mtpv" hidden title="圆点对应当前电压限值，电流限值另行判断"><i class="dash" style="--color:${mtpvColor}"></i>MTPV</span><span class="no-data" hidden><i class="unmapped"></i>无数据</span>`
    : voltageLegend(frame?.p ?? p);
const card = (key: string, title: string, ic: string, color: string) =>
  '<section class="card"><div class="card-head"><span class="icon-tile ' +
  color +
  '">' +
  icon(ic) +
  "</span><h2>" +
  title +
  "</h2>" +
  iconButton("expand-" + key, "放大" + title, "expand") +
  '</div><canvas class="plot" id="' +
  key +
  '" aria-label="' +
  title +
  '"></canvas><div class="legend">' +
  legend(key) +
  "</div></section>";
const metric = (
  key: string,
  title: string,
  ic: string,
  color: string,
  unit: string,
) =>
  '<div class="metric" style="--mc:' +
  color +
  '"><div class="metric-name">' +
  icon(ic, 15) +
  title +
  '</div><div class="metric-val"><b id="m-' +
  key +
  '">—</b><small>' +
  unit +
  '</small></div><div class="metric-foot" id="f-' +
  key +
  '"></div></div>';
$("app").innerHTML =
  `<header><div class="brand"><img src="./flux.svg" alt=""><b>FluxLab</b><span>电机分析工作台</span></div><nav aria-label="工作区"><button data-action="analysis" id="nav-analysis" class="sel">${icon("analysis")}运行分析</button><button data-action="batch" id="nav-batch">${icon("batch")}工况回放</button></nav><div class="head-actions"><button data-action="open" title="打开项目">${icon("folder")}<span>打开项目</span></button><button data-action="save" title="保存项目">${icon("save")}<span>保存项目</span></button><i class="divider"></i>${iconButton("help", "使用说明", "help")}</div></header>
<div class="shell" id="shell"><aside><div class="side-title">${icon("sliders", 18)}<strong>参数设置</strong>${iconButton("reset", "恢复示例参数", "reset")}</div><div class="side-body" id="side"></div></aside>
<main><div class="page-head"><div><h1 id="page-title">稳态运行分析</h1><div class="project-meta">${icon("motor", 14)}<span id="project-name"></span><i></i><span id="model-meta"></span></div></div><div class="details-action"><label class="head-model">${icon("model", 14)}<select aria-label="模型" id="model-choice"><option value="engineering">常参数工程模型</option><option value="ideal">理想模型</option><option value="map">磁链图模型</option></select></label><button class="small-btn hide-side" data-action="sidebar" aria-expanded="false" aria-controls="side">${icon("sliders")}参数</button><div class="popup-wrap"><button class="btn primary" data-action="export-menu" aria-controls="export-menu" aria-expanded="false" id="export-btn">${icon("export")}导出结果${icon("down", 12)}</button><div id="export-menu" class="menu" hidden><button data-action="csv">导出结果 CSV</button><button data-action="png">导出双图 PNG</button></div></div></div></div>
<section class="card batch-panel" id="batch-panel" hidden>
  <div class="section-head"><span class="icon-tile">${icon("batch")}</span><h2>工况序列</h2>
    <div class="batch-actions"><select id="replay-preset" aria-label="载入预设"><option value="" selected disabled>载入预设</option>${replayPresets.map(({ id, label }) => `<option value="${id}">${label}</option>`).join("")}</select><button class="small-btn" data-action="batch-import">${icon("folder", 14)}导入 CSV</button></div>
  </div>
  <div class="replay-toolbar">
    <div class="replay-transport">${iconButton("prev", "上一工况", "prev")}${iconButton("play", "播放", "play")}${iconButton("next", "下一工况", "next")}<button class="small-btn replay-loop" data-action="replay-loop" aria-pressed="false">${icon("repeat", 14)}循环回放</button></div>
    <label class="replay-mode">回放方式 <select id="replay-mode"><option value="step">逐点回放</option><option value="smooth">平滑过渡</option></select></label>
    <label class="check replay-max" title="开启时优先按最大出力求解，关闭后按各行给定方式回放"><input id="replay-max" type="checkbox">保持最大出力</label>
    <span id="replay-preset-note" role="status"></span>
    <span id="replay-status" role="status"></span>
  </div>
  <div id="batch-list"></div>
</section>
<section class="metrics" aria-label="运行指标">${metric("torque", "电磁转矩", "torque", "#147f72", "N·m")}${metric("current", "电流幅值", "wave", "#3472b9", "A")}${metric("voltage", "电压幅值", "bolt", "#ba843b", "V")}${metric("speed", "机械转速", "speed", "#8371a6", "rpm")}</section>
<div class="result-state" role="status"><span class="status" id="status">计算中</span><span id="state-note" hidden></span></div>
<section class="card tn-card" id="tn-card" style="--tn-left:${speedAxis.left}px;--tn-right:${speedAxis.right}px">
  <div class="card-head"><span class="icon-tile blue">${icon("analysis")}</span><h2>转矩–转速</h2>
    <label class="check tn-toggle"><input id="tn-negative" type="checkbox" aria-controls="tn">显示负转矩</label>
    <div class="tn-controls" id="tn-controls"></div>
  </div>
  <canvas class="tn-plot" id="tn" aria-label="非负转矩与转速包络图"></canvas>
  <div class="tn-slider"><input id="s-rpm" type="range" aria-label="机械转速滑块" step="any"></div>
  <div class="legend tn-legend"><span><i style="--color:${envelopeColor}"></i>转矩包络</span><span id="tn-point-key"><i class="tn-marker"></i>运行点</span><span id="tn-hidden-point" hidden>当前运行点为负转矩</span><span id="tn-status" role="status"></span></div>
</section>
<div class="plots">${card("current", "电流平面约束分析", "grid", "")}${card("voltage", "电压平面矢量图", "vector", "blue")}</div>
<section class="card detail-card"><div class="section-head"><span class="icon-tile">${icon("table")}</span><h2>运行点明细</h2><button class="cmp-toggle" data-action="compare" id="compare-btn">求解器对照 ${icon("right", 12)}</button></div><div class="detail-body"><div class="values"><table class="data-table"><thead><tr><th>物理量</th><th>d 轴</th><th>q 轴</th><th>单位</th></tr></thead><tbody id="values"></tbody></table></div><div class="margins"><h3>约束裕量</h3><div id="margins"></div></div></div></section>
</main></div><footer class="bottom"><span class="live" id="live">实时求解</span><span id="method"></span><span>dq 同步坐标系</span><span class="push">幅值约定 · 相峰值</span><span>FluxLab 1.0</span></footer>
<dialog id="dialog" aria-labelledby="dialog-title"><div class="section-head"><h2 id="dialog-title"></h2>${iconButton("close", "关闭", "close")}</div><div class="dialog-inner" id="dialog-body"></div></dialog><input id="file" type="file" hidden><div class="toast" id="toast" role="status" hidden></div>`;
type Key = keyof typeof bounds;
const unit: Record<Key, string> = {
  rpm: "rpm",
  torque: "N·m",
  id: "A",
  iq: "A",
  vdc: "V",
  vmax: "V",
  imax: "A",
  poles: "",
  ld: "mH",
  lq: "mH",
  psi: "Wb",
  rs: "Ω",
  temperature: "°C",
  k: "",
};
const labels: Record<Key, string> = {
  rpm: "机械转速",
  torque: "目标转矩",
  id: "d 轴电流",
  iq: "q 轴电流",
  vdc: "直流母线电压",
  vmax: "可用电压上限",
  imax: "相电流峰值",
  poles: "极对数",
  ld: "d 轴电感",
  lq: "q 轴电感",
  psi: "永磁体磁链",
  rs: "定子电阻 (20 °C)",
  temperature: "绕组温度",
  k: "电压利用率",
};
const symbols: Partial<Record<Key, MathText>> = {
  rpm: "n",
  torque: math.te,
  id: math.id,
  iq: math.iq,
  poles: "p",
  ld: math.ld,
  lq: math.lq,
  psi: math.psiF,
  vdc: math.vdc,
  vmax: math.vmax,
  imax: math.imax,
  rs: math.rs,
  k: math.voltageUse,
};
const source = (k: Key) => (k in o ? o[k as "rpm"] : p[k as "ld"]);
const num = (k: Key, readOnly = false) =>
  '<div class="number"><input aria-label="' +
  labels[k] +
  '数值" id="n-' +
  k +
  '" data-number="' +
  k +
  '" type="number" step="' +
  (k === "poles" ? "1" : "any") +
  '" min="' +
  bounds[k][0] +
  '" max="' +
  bounds[k][1] +
  '" value="' +
  (readOnly ? "" : source(k)) +
  (readOnly ? '" readonly>' : '">') +
  (unit[k] ? "<span>" + unit[k] + "</span>" : "") +
  "</div>";
function field(k: Key, readOnly = false) {
  return (
    '<div class="field"><label for="n-' +
    k +
    '">' +
    labels[k] +
    ' <i class="symbol">' +
    mathHtml(symbols[k] ?? "") +
    "</i></label>" +
    num(k, readOnly) +
    "</div>"
  );
}
function range(k: Key, lo: number, hi: number, step: number) {
  const val = source(k);
  const defaultMin = lo;
  const defaultMax = hi;
  lo = Math.min(val, lo);
  hi = Math.max(val, hi);
  return (
    '<div class="range-field"><div class="range-top"><label for="s-' +
    k +
    '">' +
    labels[k] +
    ' <i class="symbol">' +
    mathHtml(symbols[k] ?? "") +
    "</i></label>" +
    num(k) +
    '</div><input id="s-' +
    k +
    '" aria-label="' +
    labels[k] +
    '滑块" data-min="' +
    defaultMin +
    '" data-max="' +
    defaultMax +
    '" data-range="' +
    k +
    '" type="range" min="' +
    lo +
    '" max="' +
    hi +
    '" step="' +
    step +
    '" value="' +
    val +
    '" style="--pct:' +
    ((val - lo) / (hi - lo)) * 100 +
    '%"><div class="ends"><span>' +
    lo +
    "</span><span>" +
    hi +
    " " +
    unit[k] +
    "</span></div></div>"
  );
}
function syncRange(k: Key) {
  const slider = $<HTMLInputElement>("s-" + k);
  if (!slider) return;
  const val = source(k);
  const min = k === "id" || k === "iq" ? -p.imax : Number(slider.dataset.min);
  const max = k === "id" || k === "iq" ? p.imax : Number(slider.dataset.max);
  const lo = Math.min(min, val);
  const hi = Math.max(max, val);
  slider.min = String(lo);
  slider.max = String(hi);
  slider.value = String(val);
  slider.style.setProperty("--pct", ((val - lo) / (hi - lo)) * 100 + "%");
  const ends = slider.nextElementSibling!;
  ends.firstElementChild!.textContent = String(lo);
  ends.lastElementChild!.textContent = hi + " " + unit[k];
}
const flag = (k: "useR" | "useTemp" | "useK" | "direct", s: string) =>
  '<label class="check"><input type="checkbox" data-flag="' +
  k +
  '" ' +
  (p[k] ? "checked" : "") +
  ">" +
  s +
  "</label>";
$("tn-controls").innerHTML =
  '<div class="tn-field"><label for="n-rpm">机械转速</label>' +
  num("rpm") +
  '</div><div class="tn-field"><label for="n-speed-span">横轴范围</label><div class="number"><span>±</span><input id="n-speed-span" type="number" min="1" max="' +
  bounds.rpm[1] +
  '" step="any" placeholder="自动" title="清空恢复自动范围"><span>rpm</span></div></div>';
const groups = new Set(["oper", "motor", "constraint", "model"]);
const section = (key: string, title: string, ic: string, html: string) =>
  '<details data-group="' +
  key +
  '" ' +
  (groups.has(key) ? "open" : "") +
  "><summary>" +
  icon(ic, 15) +
  title +
  icon("down", 13) +
  '</summary><div class="group">' +
  html +
  "</div></details>";
function sidebar() {
  const active = document.activeElement as HTMLElement | null;
  const focused = active && $("side").contains(active) ? active : null;
  const mode = o.mode === "auto",
    maxOutput = isMaxOutput(o),
    map = p.model === "map";
  const preset = findMotorPreset(motorPresetId);
  const torqueRange = preset?.torqueRange ?? 120;
  const torqueStep = Math.min(0.5, torqueRange / 100);
  const currentStep = preset && p.imax < 10 ? 0.01 : 0.5;
  const limitRange = preset ? Math.ceil(preset.parameters.imax * 2) : 400;
  const lowCurrent = preset && limitRange <= 20;
  const torqueControl =
    '<div class="operation-torque"><label class="check"><input id="max-output" type="checkbox"' +
    (maxOutput ? " checked" : "") +
    ">最大出力转矩</label>" +
    (maxOutput
      ? field("torque", true)
      : range("torque", -torqueRange, torqueRange, torqueStep)) +
    "</div>";
  const op =
    '<div class="segmented" aria-label="运行点给定方式"><button data-action="auto" class="' +
    (mode ? "sel" : "") +
    '">自动求点</button><button data-action="manual" class="' +
    (!mode ? "sel" : "") +
    '">手动验点</button></div>' +
    (mode
      ? torqueControl
      : range("id", -p.imax, p.imax, currentStep) +
        range("iq", -p.imax, p.imax, currentStep));
  const motor =
    '<div class="motor-preset-control"><button class="small-btn" data-action="motor-presets">' +
    icon("motor", 14) +
    '电机预设</button>' +
    (preset ? catalogLink(preset.sources[0], "参考目录") : "") +
    "</div>" +
    field("poles") +
    (map
      ? '<p class="note">磁链来自导入的 dq 查表数据。</p>'
      : field("ld") + field("lq") + field("psi")) +
    (p.model === "ideal"
      ? ""
      : flag("useR", "计入定子电阻") +
        (p.useR
          ? field("rs") +
            flag("useTemp", "铜阻温度修正") +
            (p.useTemp ? field("temperature") : "")
          : ""));
  const modulation =
    '<div class="field"><label for="pwm-method">调制方式</label><select id="pwm-method"' +
    (p.direct ? " disabled" : "") +
    ">" +
    pwmMethods
      .map(
        (method) =>
          `<option${method === p.pwm ? " selected" : ""}>${method}</option>`,
      )
      .join("") +
    "</select></div>";
  const constraint =
    modulation +
    range("vdc", 1, preset?.voltageClass === "low" ? 60 : 800, 1) +
    (p.direct ? range("vmax", 1, 600, 1) : "") +
    range("imax", lowCurrent ? 0.1 : 1, limitRange, lowCurrent ? 0.1 : 1) +
    flag("direct", "直接给定可用电压上限");
  $<HTMLSelectElement>("model-choice").value = p.model;
  const model =
    (map
      ? '<div class="note file-name">' +
        esc(mapName) +
        '</div><div class="map-links"><button class="small-btn" data-action="map-import">导入磁链图</button><a class="inline-link" download href="./examples/flux-map.csv">示例 CSV</a></div>'
      : "") +
    (p.model !== "ideal"
      ? !p.direct
        ? flag("useK", "修正电压利用率") + (p.useK ? field("k") : "")
        : ""
      : "") +
    '<div class="field"><label for="solver">求解器</label><select id="solver" ' +
    (p.model !== "ideal" || !mode || maxOutput ? "disabled" : "") +
    ">" +
    (mode
      ? '<option value="analytic" ' +
        (p.model === "ideal" && !maxOutput && p.solver === "analytic"
          ? "selected"
          : "") +
        '>解析法</option><option value="numeric" ' +
        (p.model !== "ideal" || maxOutput || p.solver === "numeric"
          ? "selected"
          : "") +
        ">数值法</option>"
      : "<option>直接计算</option>") +
    "</select></div>" +
    (p.model !== "ideal" && mode
      ? '<p class="note">含实际因素或查表磁链时使用数值法。</p>'
      : "");
  $("side").innerHTML =
    section("oper", "运行工况", "target", op) +
    section("motor", "电机参数", "motor", motor) +
    section("constraint", "电压与电流约束", "shield", constraint) +
    section("model", "模型与求解", "model", model);
  $("side")
    .querySelectorAll("details")
    .forEach((d) =>
      d.addEventListener("toggle", () => {
        const k = d.dataset.group!;
        if (d.open) groups.add(k);
        else groups.delete(k);
      }),
    );
  $("project-name").textContent = name;
  $("model-meta").textContent = modelNames[p.model] + " · " + p.poles + " 极对";
  if (focused?.id) $(focused.id)?.focus({ preventScroll: true });
  else if (focused?.dataset.action)
    $("side")
      .querySelector<HTMLElement>(`[data-action="${focused.dataset.action}"]`)
      ?.focus({ preventScroll: true });
  else if (focused?.dataset.flag)
    $("side")
      .querySelector<HTMLElement>(`[data-flag="${focused.dataset.flag}"]`)
      ?.focus({ preventScroll: true });
}
function toast(t: string) {
  $("toast").textContent = t;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => ($("toast").hidden = true), 4500);
}
let dragging = false;
let pending: {
  p: Parameters;
  o: Operation;
  id: number;
  preview: string;
} | null = null;
function drawTN() {
  const invalidRow = tab === "batch" && rowIndex >= 0 && !rows[rowIndex]?.op;
  const rpm = invalidRow
    ? undefined
    : playing && replayLeg?.commands && frame
      ? frame.o.rpm
      : o.rpm;
  const torque =
    frame && frame.o.rpm === rpm ? frame.r.point?.torque : undefined;
  const showNegative = $<HTMLInputElement>("tn-negative").checked;
  const hiddenPoint = !showNegative && (torque ?? 0) < 0;
  $("tn-point-key").hidden = torque === undefined || hiddenPoint;
  $("tn-hidden-point").hidden = !hiddenPoint;
  drawSpeedChart($("tn"), tnSpan, rpm, torque, tnEnvelope, showNegative);
}
function syncSpeed() {
  const modelChanged = tnParameters !== p;
  if (modelChanged) tnEstimate = undefined;
  const extent = Math.max(Math.abs(o.rpm), replaySpan);
  const automaticSpan = dragging && tnParameters ? tnSpan : tnEstimate?.span;
  const span = speedSpan(p, extent, speedRange ?? automaticSpan);
  const slider = $<HTMLInputElement>("s-rpm");
  if (slider.max !== String(span)) {
    slider.min = String(-span);
    slider.max = String(span);
  }
  const rpm = String(o.rpm);
  if (slider.value !== rpm) slider.value = rpm;
  const progress = (1 + o.rpm / span) * 50 + "%";
  if (slider.style.getPropertyValue("--pct") !== progress)
    slider.style.setProperty("--pct", progress);
  const rpmInput = $<HTMLInputElement>("n-rpm");
  const spanInput = $<HTMLInputElement>("n-speed-span");
  if (document.activeElement !== rpmInput) {
    const displayedRpm = replayLeg?.commands ? String(+o.rpm.toFixed(1)) : rpm;
    if (rpmInput.value !== displayedRpm) rpmInput.value = displayedRpm;
  }
  if (
    displayedSpeedRange !== String(span) &&
    (document.activeElement !== spanInput ||
      spanInput.value === displayedSpeedRange)
  )
    displayedSpeedRange = spanInput.value = String(span);
  const envelopeChanged = modelChanged || tnSpan !== span;
  if (envelopeChanged) {
    tnParameters = p;
    tnSpan = span;
    tnEnvelope = null;
    if (!dragging && (!playing || !replayLeg?.commands)) drawTN();
  }
  // The operating point has priority while a parameter or speed is being dragged.
  if (envelopeChanged || (dragging && (tnTimer || tnWorker))) {
    clearTimeout(tnTimer);
    tnTimer = 0;
    tnWorker?.terminate();
    tnWorker = null;
    tnNeedsEnvelope = true;
  }
  if (tnNeedsEnvelope && dragging) {
    if ($("tn-status").textContent !== "拖动结束后更新包络")
      $("tn-status").textContent = "拖动结束后更新包络";
  } else if (tnNeedsEnvelope) {
    tnNeedsEnvelope = false;
    $("tn-status").textContent = "正在计算包络";
    tnTimer = window.setTimeout(() => {
      tnTimer = 0;
      const worker = new SpeedWorker();
      tnWorker = worker;
      worker.onmessage = ({ data }: MessageEvent<SpeedResponse>) => {
        if (tnWorker !== worker) return;
        worker.terminate();
        tnWorker = null;
        tnEstimate = data.estimate;
        tnEnvelope = data.envelope;
        tnSpan = data.span;
        $("tn-status").textContent = data.envelope.partial
          ? "磁链图覆盖不足 · 仅显示表内边界"
          : data.estimate.foundLimit
            ? ""
            : "计算范围内未找到有限转速边界";
        syncSpeed();
        drawTN();
        updatePeakSpeedPreset();
      };
      worker.onerror = () => {
        if (tnWorker !== worker) return;
        $("tn-status").textContent = "包络计算失败";
        worker.terminate();
        tnWorker = null;
        if (peakPresetSelected() && !tnEstimate) {
          resetPresetChoice();
          $("replay-preset-note").textContent = "无法估算预设的最高转速";
          renderBatch();
        }
      };
      worker.postMessage({
        parameters: p,
        rpm: Math.max(Math.abs(o.rpm), replaySpan),
        requested: speedRange,
        estimate: tnEstimate,
      });
    }, 120);
  }
}
function enqueue(modelChange = false) {
  if (modelChange && tab === "batch") stop();
  syncSpeed();
  if (modelChange) {
    if (tab === "batch" && peakPresetSelected())
      $("replay-preset-note").textContent = "正在估算最高转速";
    revision++;
    if (tab === "batch" && !dragging) startBatch();
    else {
      batchWorker?.terminate();
      batchWorker = null;
      batchRevision++;
      batchReady = false;
    }
  }
  dirty = true;
  if (!busy) queueMicrotask(send);
}
function send() {
  if (busy || !dirty) return;
  busy = true;
  dirty = false;
  const preview = dragging
    ? "拖动预览"
    : playing && replay.mode === "smooth"
      ? "平滑回放"
      : "";
  pending = { p: { ...p }, o: { ...o }, id: ++id, preview };
  const keepMap = p.map === sentMap;
  worker.postMessage({
    id,
    p: sentRevision === revision ? null : { ...p, map: keepMap ? null : p.map },
    keepMap,
    o,
    compare,
    preview: preview !== "",
    ratio: currentPlotRatio,
  });
  sentRevision = revision;
  sentMap = p.map;
}
worker.onmessage = (e) => {
  busy = false;
  const m = e.data;
  const completed = pending;
  if (dirty) send();
  if (m.error) {
    toast(m.error);
    return;
  }
  if (m.g) lastG = m.g;
  if (completed && lastG) {
    frame = { p: completed.p, o: m.o, r: m.r, g: lastG };
    comparison = m.comparison;
    renderFrame();
    $("live").textContent = completed.preview || "实时求解";
  }
};
worker.onerror = (e) => {
  busy = false;
  toast("求解线程异常 " + e.message);
};
function graphs() {
  if (tab === "batch" && rowIndex >= 0 && !rows[rowIndex]?.op) {
    invalidRowView();
    return;
  }
  drawTN();
  if (!frame) return;
  chart($("current"), "current", frame);
  chart($("voltage"), "voltage", frame);
  if (expanded && $("zoom")) chart($("zoom"), expanded, frame);
  document
    .querySelectorAll<HTMLElement>(".mtpv")
    .forEach((el) => (el.hidden = frame!.g.mtpv === null));
}
const notes: Partial<Record<Result["status"], string>> = {
  unreachable:
    "目标超出当前转速的转矩能力。图中及明细显示同方向可达边界点，目标转矩保留。",
  coverage: "查表范围不足以判断目标是否可达。显示已覆盖区域内求得的边界点。",
  unresolved: "数值搜索未确认目标解。所示为搜索得到的边界候选点。",
  empty: "当前转速下未找到满足电压和电流限制的运行点。",
  outside: "给定电流超出磁链数据范围，电压与转矩无法计算。",
  over: "给定指令超过约束。图中与明细保留原电流指令。",
};
function showResultState(label: string, warning: boolean, note = "") {
  const status = $("status");
  const detail = $("state-note");
  status.classList.toggle("warn", warning);
  if (status.textContent !== label) status.textContent = label;
  if (detail.textContent !== note) detail.textContent = note;
  detail.hidden = !note;
}
function renderFrame() {
  if (!frame) return;
  const { p: v, o: op, r } = frame,
    x = r.point;
  if (tab === "batch" && rowIndex >= 0 && !rows[rowIndex].op) {
    invalidRowView();
    return;
  }
  graphs();
  const torqueDigits = motorPresetId && Math.abs(x?.torque ?? op.torque) < 1 ? 3 : 1;
  $("m-torque").textContent = f(x?.torque, torqueDigits);
  $("m-current").textContent = f(x?.current);
  $("m-voltage").textContent = f(x?.voltage);
  $("m-speed").textContent = op.rpm.toLocaleString("en-US", {
    maximumFractionDigits: 1,
  });
  const maxOutput = isMaxOutput(op);
  const power = x ? (x.torque * op.rpm * Math.PI) / 30000 : null;
  if (maxOutput && isMaxOutput(o) && op.rpm === o.rpm) {
    $<HTMLInputElement>("n-torque").value = x ? x.torque.toFixed(2) : "";
  }
  $("f-torque").textContent = maxOutput
    ? "机械转换功率 " + f(power, 2) + " kW"
    : op.mode === "auto"
      ? "目标 " + f(op.torque, torqueDigits) + " N·m"
      : "由给定电流计算";
  $("f-current").textContent = "极限 " + f(v.imax, 1) + " A";
  $("f-voltage").textContent = "极限 " + f(limit(v), 1) + " V";
  $("f-speed").textContent =
    "电频率 " + f(Math.abs((op.rpm * v.poles) / 60), 1) + " Hz";
  $("method").textContent = r.method;
  $("live").textContent = "实时求解";
  $("compare-btn").hidden =
    v.model !== "ideal" || op.mode !== "auto" || maxOutput;
  const detailRows = [
    [
      "定子电流",
      x?.d ?? (op.mode === "manual" ? op.id : undefined),
      x?.q ?? (op.mode === "manual" ? op.iq : undefined),
      "A",
    ] as const,
    ["端电压", x?.ud, x?.uq, "V"] as const,
    ...voltageComponents(v, op.rpm, x).map(
      ({ label, symbol, ud, uq }) =>
        [label + " " + mathHtml(symbol), ud, uq, "V"] as const,
    ),
  ];
  const detail = $<HTMLTableSectionElement>("values");
  if (!detail.rows.length || detail.dataset.model !== v.model) {
    detail.innerHTML = detailRows
      .map(
        ([label, , , unit]) =>
          `<tr><td>${label}</td><td></td><td></td><td class="unit">${unit}</td></tr>`,
      )
      .join("");
    detail.dataset.model = v.model;
  }
  detailRows.forEach(([, d, q], index) => {
    const cells = detail.rows[index].cells;
    const displayedD = f(d, 2);
    const displayedQ = f(q, 2);
    if (cells[1].textContent !== displayedD) cells[1].textContent = displayedD;
    if (cells[2].textContent !== displayedQ) cells[2].textContent = displayedQ;
  });
  const legendElement = $("voltage").nextElementSibling!;
  const legendKey = `${v.model}/${v.direct ? "direct" : v.pwm}`;
  if (legendElement.getAttribute("data-model") !== legendKey) {
    legendElement.innerHTML = voltageLegend(v);
    legendElement.setAttribute("data-model", legendKey);
  }
  const margin = (
    name: string,
    num: number | undefined,
    max: number,
    unit: string,
    color: string,
  ) =>
    '<div class="margin-line"><div><span>' +
    name +
    "</span><b>" +
    f(num, 2) +
    " " +
    unit +
    (num != null && Math.abs(num) < 1e-6 * max ? " · 已触限" : "") +
    '</b></div><div class="track ' +
    color +
    '"><i style="width:' +
    Math.max(0, Math.min(100, ((num ?? 0) / max) * 100)) +
    '%"></i></div></div>';
  $("margins").innerHTML =
    margin("电流裕量", x?.im, v.imax, "A", "") +
    margin("电压裕量", x?.vm, limit(v), "V", "blue");
  let note = notes[r.status] ?? "";
  if (maxOutput && r.status === "coverage")
    note = "磁链图未覆盖完整电流范围，当前显示表内搜索结果。";
  if (maxOutput && r.status === "ok") {
    if (op.rpm === 0)
      note = "零速时机械转换功率为零，图中显示最大正静态转矩点。";
    else if (power != null && power <= 0)
      note = "此转速和约束下可行点均无法产生正机械转换功率。";
  }
  showResultState(statusText[r.status], r.status !== "ok", note);
  document
    .querySelectorAll<HTMLElement>(".mtpa")
    .forEach((el) => (el.hidden = v.model === "map"));
  document
    .querySelectorAll<HTMLElement>(".no-data")
    .forEach((el) => (el.hidden = v.model !== "map"));
  if (compare) showComparison();
}
function plotRatio() {
  const el = $<HTMLCanvasElement>("current"),
    w = el.clientWidth,
    h = el.clientHeight;
  return Math.max(
    1,
    Math.ceil(((w - 36) / Math.max(1, Math.min(w - 60, h - 35))) * 10) / 10,
  );
}
let currentPlotRatio = plotRatio();
new ResizeObserver(() => {
  graphs();
  const nextRatio = plotRatio();
  if (currentPlotRatio !== nextRatio) {
    currentPlotRatio = nextRatio;
    enqueue();
  }
}).observe($("current"));
function setNumber(key: Key, value: number) {
  if (
    !Number.isFinite(value) ||
    value < bounds[key][0] ||
    value > bounds[key][1] ||
    (key === "poles" && !Number.isInteger(value))
  )
    return false;
  const op = key in o;
  if (op) o = { ...o, [key]: value };
  else p = { ...p, [key]: value };
  $("model-meta").textContent = modelNames[p.model] + " · " + p.poles + " 极对";
  if (op && tab === "batch") {
    stop();
    rowIndex = -1;
    renderBatch();
  }
  enqueue(!op);
  return true;
}
new ResizeObserver(drawTN).observe($("tn"));
$("tn-negative").addEventListener("change", (e) => {
  const { checked } = e.target as HTMLInputElement;
  $("tn-card").classList.toggle("tn-full", checked);
  $("tn").setAttribute(
    "aria-label",
    checked ? "正负转矩与转速包络图" : "非负转矩与转速包络图",
  );
  drawTN();
});
$("s-rpm").addEventListener("input", (e) => {
  dragging = true;
  const input = e.target as HTMLInputElement;
  setNumber(
    "rpm",
    Math.max(+input.min, Math.min(+input.max, Math.round(input.valueAsNumber))),
  );
});
$("s-rpm").addEventListener("change", () => {
  dragging = false;
  enqueue();
  if (tab === "batch" && !batchReady && !batchWorker) startBatch();
});
$("tn-controls").addEventListener("change", (e) => {
  const input = e.target as HTMLInputElement;
  if (input.id === "n-rpm") {
    if (input.value === "" || !setNumber("rpm", input.valueAsNumber))
      toast("机械转速超出有效范围");
    input.value = String(o.rpm);
  } else if (input.id === "n-speed-span") {
    if (input.value === "") speedRange = undefined;
    else if (input.valueAsNumber >= 1 && input.valueAsNumber <= bounds.rpm[1])
      speedRange = input.valueAsNumber;
    else toast("横轴范围超出有效范围");
    syncSpeed();
    displayedSpeedRange = input.value = String(tnSpan);
    updatePeakSpeedPreset();
  }
});
$("side").addEventListener("input", (e) => {
  const el = e.target as HTMLInputElement,
    k = el.dataset.range as Key;
  if (!k) return;
  dragging = true;
  if (setNumber(k, +el.value)) {
    $<HTMLInputElement>("n-" + k).value = el.value;
    el.style.setProperty(
      "--pct",
      ((+el.value - +el.min) / (+el.max - +el.min)) * 100 + "%",
    );
  }
});
$("side").addEventListener("change", (e) => {
  const el = e.target as HTMLInputElement,
    k = el.dataset.number as Key;
  if (el.dataset.range) {
    if (el.dataset.range === "imax") {
      syncRange("id");
      syncRange("iq");
    }
    dragging = false;
    enqueue();
    if (tab === "batch" && !batchReady && !batchWorker) startBatch();
    return;
  }
  if (k) {
    if (el.value === "" || !setNumber(k, +el.value))
      toast(labels[k] + " 超出有效范围");
    el.value = String(source(k));
    syncRange(k);
    if (k === "imax") {
      syncRange("id");
      syncRange("iq");
    }
    return;
  }
  if (el.id === "max-output") {
    const lastMax =
      !dirty && !busy && frame && isMaxOutput(frame.o)
        ? frame.r.point?.torque
        : undefined;
    const torque =
      !el.checked &&
      lastMax != null &&
      lastMax >= bounds.torque[0] &&
      lastMax <= bounds.torque[1]
        ? lastMax
        : o.torque;
    o = { ...o, maxOutput: el.checked, torque };
    if (tab === "batch") {
      stop();
      rowIndex = -1;
      renderBatch();
    }
    sidebar();
    enqueue();
    return;
  }
  if (el.dataset.flag) {
    p = { ...p, [el.dataset.flag]: el.checked };
    sidebar();
    enqueue(true);
    return;
  }
  if (el.id === "pwm-method") {
    p = { ...p, pwm: el.value as Parameters["pwm"] };
    enqueue(true);
    return;
  }
  if (el.id === "solver") {
    p = { ...p, solver: el.value as Parameters["solver"] };
    enqueue(true);
    return;
  }
});
$("model-choice").addEventListener("change", (e) => {
  const value = (e.target as HTMLSelectElement).value as Parameters["model"];
  if (value === "map" && !p.map) {
    sidebar();
    mapDialog();
    return;
  }
  p = { ...p, model: value };
  sidebar();
  enqueue(true);
});
function modal(title: string, html: string, large = false) {
  $("dialog-title").textContent = title;
  $("dialog-body").innerHTML = html;
  const d = $<HTMLDialogElement>("dialog");
  d.classList.toggle("large", large);
  if (!d.open) d.showModal();
}
function close() {
  const d = $<HTMLDialogElement>("dialog");
  if (d.open) d.close();
  expanded = null;
  compare = false;
}
$<HTMLDialogElement>("dialog").addEventListener("close", () => {
  expanded = null;
  compare = false;
});
function mapDialog() {
  modal(
    "载入磁链图",
    '<p>导入规则矩形网格上的总磁链，列名及单位如下。</p><p><code>id_A, iq_A, psi_d_Wb, psi_q_Wb</code></p><p class="note">插值仅在数据覆盖范围内进行。示例数据包含饱和及交叉耦合，用于演示查表流程。</p><div class="map-links"><button class="btn primary" data-action="map-import">选择 CSV</button><button class="btn" data-action="map-sample">载入示例磁链图</button><a class="inline-link" download href="./examples/flux-map.csv">下载示例</a></div>',
  );
}
function catalogLink(source: MotorPreset["sources"][number], label = source.label) {
  return `<a class="inline-link" href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;
}
function showMotorPreset(preset: MotorPreset) {
  const { parameters: m, operation } = preset;
  const values = [
    ["直流母线", m.vdc + " V"],
    ["限流（相峰值）", m.imax + " A"],
    ["极对数", String(m.poles)],
    ["定子电阻（20 °C）", m.rs + " Ω"],
    ["d / q 轴电感", m.ld + " / " + m.lq + " mH"],
    ["永磁体磁链", m.psi + " Wb"],
    ["起始工况", operation.rpm + " rpm · " + operation.torque + " N·m"],
  ];
  $("motor-preset-preview").innerHTML =
    '<dl class="motor-preset-values">' +
    values
      .map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`)
      .join("") +
    '</dl><p class="note">' +
    esc(preset.note) +
    '</p><div class="motor-preset-sources">' +
    preset.sources.map((source) => catalogLink(source)).join("") +
    "</div>";
}
function motorPresetDialog() {
  const active = findMotorPreset(motorPresetId) ?? motorPresets[0];
  const labels = { low: "低压直流母线", high: "高压直流母线" } as const;
  const options = (["low", "high"] as const)
    .map((voltage) => {
      const group = motorPresets
        .filter((preset) => preset.voltageClass === voltage)
        .map(
          (preset) =>
            `<option value="${preset.id}"${preset === active ? " selected" : ""}>${esc(preset.name)} · ${preset.parameters.vdc} V DC</option>`,
        )
        .join("");
      return `<optgroup label="${labels[voltage]}">${group}</optgroup>`;
    })
    .join("");
  modal(
    "电机预设",
    '<div class="field motor-preset-select"><label for="motor-preset-choice">厂商与型号</label><select id="motor-preset-choice" autofocus>' +
      options +
      '</select></div><div id="motor-preset-preview"></div>' +
      '<p class="note">载入会替换电机参数、约束、磁链图与起始工况。已导入的工况序列仍可回放。</p>' +
      '<div class="map-links"><button class="btn primary" data-action="apply-motor-preset">载入预设</button><button class="btn" data-action="close">取消</button></div>',
  );
  showMotorPreset(active);
}
$("dialog-body").addEventListener("change", (event) => {
  const select = event.target as HTMLSelectElement;
  if (select.id !== "motor-preset-choice") return;
  const preset = findMotorPreset(select.value);
  if (preset) showMotorPreset(preset);
});
function applyMotorPreset(preset: MotorPreset) {
  stop();
  rowIndex = -1;
  p = {
    ...defaults,
    ...preset.parameters,
    vmax: preset.parameters.vdc / Math.sqrt(3),
    temperature: 20,
  };
  o = { ...initial, ...preset.operation, iq: 0 };
  name = preset.name;
  motorPresetId = preset.id;
  speedRange = undefined;
  mapName = "";
  close();
  sidebar();
  enqueue(true);
}
function showComparison() {
  if (!frame) return;
  const a = frame.r,
    b = comparison;
  const cell = (x: Result, key: "d" | "q" | "torque" | "vm") =>
    f(x.point?.[key], 5);
  const line = (x: Result) =>
    "<tr><td>" +
    x.method +
    "</td>" +
    (["d", "q", "torque", "vm"] as const)
      .map((k) => "<td>" + cell(x, k) + "</td>")
      .join("") +
    "<td>" +
    f(x.point ? x.point.torque - frame!.o.torque : null, 6) +
    "</td></tr>";
  const delta =
    b?.point && a.point
      ? '<p class="note">电压裕量差 ' +
        f(Math.abs(b.point.vm - a.point.vm), 6) +
        " V</p>"
      : "";
  modal(
    "同一工况的求解器对照",
    b
      ? '<table class="data-table comparison"><thead><tr><th>方法</th><th>i<sub>d</sub> / A</th><th>i<sub>q</sub> / A</th><th>T<sub>e</sub> / N·m</th><th>ΔV / V</th><th>转矩残差 / N·m</th></tr></thead><tbody>' +
          line(a) +
          line(b) +
          "</tbody></table>" +
          delta
      : "正在独立求解…",
    true,
  );
}
function updatePlayButton() {
  const b = document.querySelector<HTMLButtonElement>("[data-action=play]")!;
  const label = playing ? "暂停" : "播放";
  b.innerHTML = icon(playing ? "pause" : "play");
  b.title = label;
  b.setAttribute("aria-label", label);
}
function stop(keepPosition = false) {
  const wasPlaying = playing !== 0;
  if (wasPlaying) cancelAnimationFrame(playing);
  playing = 0;
  replayClock = null;
  if (!keepPosition) {
    replayLeg = null;
    replaySpan = 0;
    $("replay-status").textContent = "";
  }
  if (wasPlaying) {
    updatePlayButton();
    if (keepPosition) enqueue();
  }
}
function rowOperation(i: number) {
  return replayOperation(rows[i]?.op ?? null, replay.keepMaxOutput);
}
function nextReplayRow(start: number) {
  for (let i = start; i < rows.length; i++) {
    if (replay.mode === "step" || rows[i].op) return i;
  }
  return -1;
}
function nextPlaybackRow() {
  const next = nextReplayRow(rowIndex + 1);
  if (next >= 0 || !replay.loop) return next;
  const first = nextReplayRow(0);
  return first === rowIndex ? -1 : first;
}
function previewReplay(op: Operation) {
  const commandChanged = commandType(o) !== commandType(op);
  o = op;
  if (commandChanged) sidebar();
  // Keep the live inputs in sync without moving focus or rebuilding the sidebar.
  for (const key of op.mode === "manual"
    ? (["id", "iq"] as const)
    : (["torque"] as const)) {
    const input = $<HTMLInputElement>("n-" + key);
    if (!input.readOnly && document.activeElement !== input)
      input.value = String(+op[key].toFixed(2));
    const slider = $<HTMLInputElement>("s-" + key);
    if (slider) {
      const lo = Math.min(+slider.min, op[key]);
      const hi = Math.max(+slider.max, op[key]);
      slider.min = String(lo);
      slider.max = String(hi);
      slider.value = String(op[key]);
      slider.style.setProperty(
        "--pct",
        ((op[key] - lo) / (hi - lo)) * 100 + "%",
      );
    }
  }
  enqueue();
}
function replayTick(now: number) {
  if (!replayLeg) {
    let next = nextPlaybackRow();
    if (
      next >= 0 &&
      next < rowIndex &&
      replay.mode === "smooth" &&
      sameReplayCommand(rowOperation(rowIndex)!, rowOperation(next)!)
    ) {
      selectRow(next);
      next = nextReplayRow(rowIndex + 1);
    }
    if (next < 0) {
      stop();
      syncSpeed();
      return;
    }
    let commands: ReplayTransition | null = null;
    if (replay.mode === "smooth") {
      const from = rowOperation(rowIndex)!;
      const to = rowOperation(next)!;
      const a = batchResults[rowIndex],
        b = batchResults[next];
      if (
        commandType(from) !== commandType(to) &&
        batchWorker &&
        (a === undefined || b === undefined)
      ) {
        const status = $("replay-status");
        if (status.textContent !== "正在求解过渡端点")
          status.textContent = "正在求解过渡端点";
        playing = requestAnimationFrame(replayTick);
        return;
      }
      commands = replayTransition(from, to, a?.point ?? null, b?.point ?? null);
      $("replay-status").textContent =
        "第 " +
        rows[rowIndex].line +
        " → " +
        rows[next].line +
        " 行" +
        (commands ? "" : " · 端点电流不可用，到时切换");
    }
    replayLeg = { next, elapsed: 0, commands };
  }
  replayLeg.elapsed += now - (replayClock ?? now);
  replayClock = now;
  if (replayLeg.elapsed >= replayDuration) {
    selectRow(replayLeg.next);
    replayLeg = null;
    replayClock = null;
    if (nextPlaybackRow() < 0) {
      stop();
      enqueue();
      return;
    }
  } else if (replayLeg.commands) {
    previewReplay(
      interpolateCommand(
        replayLeg.commands,
        replayLeg.elapsed / replayDuration,
      ),
    );
  }
  playing = requestAnimationFrame(replayTick);
}
function playReplay() {
  if (peakPresetSelected() && !tnEstimate) return;
  if (playing) {
    stop(true);
    return;
  }
  if (!replayLeg) {
    const first = nextReplayRow(0);
    if (first < 0) return;
    const restart =
      rowIndex < 0 ||
      (replay.mode === "smooth" && !rows[rowIndex]?.op) ||
      nextReplayRow(rowIndex + 1) < 0;
    if (replay.mode === "smooth")
      replaySpan = rows.reduce(
        (span, row) => Math.max(span, Math.abs(row.op?.rpm ?? 0)),
        0,
      );
    selectRow(restart ? first : rowIndex);
  }
  playing = requestAnimationFrame(replayTick);
  updatePlayButton();
}
function invalidRowView() {
  const row = rows[rowIndex];
  if (!row || row.op) return;
  drawTN();
  for (const key of ["torque", "current", "voltage", "speed"]) {
    $("m-" + key).textContent = "—";
    $("f-" + key).textContent = "";
  }
  for (const key of ["current", "voltage"]) {
    const el = $<HTMLCanvasElement>(key),
      ctx = el.getContext("2d")!;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, el.width, el.height);
    ctx.fillStyle = "#7b8998";
    ctx.textAlign = "center";
    ctx.font = 13 * devicePixelRatio + "px sans-serif";
    ctx.fillText("当前行缺少有效工况", el.width / 2, el.height / 2);
    ctx.restore();
  }
  $("values").innerHTML = "";
  $("margins").innerHTML = "";
  $("compare-btn").hidden = true;
  showResultState("输入无效", true, "第 " + row.line + " 行 · " + row.error);
}
function selectRow(i: number) {
  if (i < 0 || i >= rows.length) return;
  rowIndex = i;
  const op = rowOperation(i);
  if (op) {
    o = { ...op };
    sidebar();
    enqueue();
  } else invalidRowView();
  renderBatch();
}
function startBatch() {
  batchWorker?.terminate();
  batchWorker = null;
  batchResults = [];
  batchReady = false;
  const token = ++batchRevision;
  if (!rows.length) {
    renderBatch();
    return;
  }
  const w = new SolverWorker();
  batchWorker = w;
  let pos = 0;
  function next() {
    const first = pos === 0;
    w.postMessage({
      type: "batch",
      id: token,
      p: first ? p : null,
      ops: rows
        .slice(pos, pos + 8)
        .map((row) => replayOperation(row.op, replay.keepMaxOutput)),
    });
  }
  w.onmessage = (e) => {
    if (token !== batchRevision) return;
    if (e.data.error) {
      toast(e.data.error);
      w.terminate();
      batchWorker = null;
      return;
    }
    batchResults.push(...e.data.results);
    pos = batchResults.length;
    if (pos < rows.length) next();
    else {
      batchReady = true;
      w.terminate();
      batchWorker = null;
    }
    renderBatch();
  };
  w.onerror = (e) => {
    if (token !== batchRevision) return;
    toast("批量求解失败 " + e.message);
    w.terminate();
    batchWorker = null;
  };
  next();
  renderBatch();
}
let renderedRows: Row[] | undefined;
let renderedResults: (Result | null)[] | undefined;
let renderedResultCount = 0;
let renderedKeepMaxOutput = false;

function updateBatchRow(row: HTMLTableRowElement, i: number) {
  const op = rowOperation(i);
  const result = batchResults[i];
  const mode = !op
    ? "—"
    : isMaxOutput(op)
      ? "最大出力"
      : op.mode === "auto"
        ? "自动求点"
        : "手动验点";
  const command = !op || isMaxOutput(op)
    ? "—"
    : op.mode === "auto"
      ? op.torque + " N·m"
      : op.id + ", " + op.iq + " A";
  const values = [
    mode,
    String(op?.rpm ?? "—"),
    command,
    f(result?.point?.torque, 2),
    rows[i].error || (result ? statusText[result.status] : "计算中"),
  ];
  values.forEach((value, column) => (row.cells[column + 1].textContent = value));
}

function renderBatch() {
  if (tab !== "batch") return;
  const list = $("batch-list");
  if (renderedRows !== rows) {
    list.innerHTML = rows.length
      ? '<div class="batch-table"><table class="data-table"><thead><tr><th>行</th><th>给定方式</th><th>机械转速 / rpm</th><th>给定值</th><th>转矩 / N·m</th><th>状态</th></tr></thead><tbody>' +
        rows.map((row, i) => `<tr tabindex="0" data-row="${i}"><td>${row.line}</td><td></td><td></td><td></td><td></td><td></td></tr>`).join("") +
        "</tbody></table></div>"
      : '<div class="batch-empty">选择预设或导入工况表。<a class="inline-link" href="./examples/operating-points.csv" download>工况 CSV 模板</a><a class="inline-link" href="./examples/playback-speeds.csv" download>转速 CSV 模板</a></div>';
    renderedRows = rows;
    renderedResults = undefined;
  }
  const table = list.querySelector("table");
  if (table) {
    const body = table.tBodies[0];
    const reset = renderedResults !== batchResults || renderedKeepMaxOutput !== replay.keepMaxOutput;
    const end = reset ? rows.length : batchResults.length;
    for (let i = reset ? 0 : renderedResultCount; i < end; i++)
      updateBatchRow(body.rows[i], i);
    renderedResults = batchResults;
    renderedResultCount = batchResults.length;
    renderedKeepMaxOutput = replay.keepMaxOutput;

    const previous = body.querySelector("tr.active");
    const current = body.rows.item(rowIndex);
    if (previous !== current) {
      previous?.classList.remove("active");
      previous?.removeAttribute("aria-current");
      if (current) {
        current.classList.add("active");
        current.setAttribute("aria-current", "true");
        const scroller = table.parentElement!;
        const viewport = scroller.getBoundingClientRect();
        const row = current.getBoundingClientRect();
        const top = viewport.top + table.tHead!.offsetHeight;
        if (row.top < top) scroller.scrollTop += row.top - top;
        else if (row.bottom > viewport.top + scroller.clientHeight)
          scroller.scrollTop += row.bottom - viewport.top - scroller.clientHeight;
      }
    }
  }
  for (const a of ["prev", "next", "play"]) {
    const b = document.querySelector<HTMLButtonElement>(
      "[data-action=" + a + "]",
    )!;
    b.disabled =
      (peakPresetSelected() && !tnEstimate) ||
      !rows.length ||
      (a === "play" && nextReplayRow(0) < 0) ||
      (a === "prev" && rowIndex <= 0) ||
      (a === "next" && rowIndex === rows.length - 1);
  }
}
function changeTab(t: typeof tab) {
  stop();
  tab = t;
  if (frame) renderFrame();
  $("nav-analysis").classList.toggle("sel", t === "analysis");
  $("nav-batch").classList.toggle("sel", t === "batch");
  $("page-title").textContent = t === "batch" ? "批量工况回放" : "稳态运行分析";
  $("batch-panel").hidden = t !== "batch";
  if (t === "batch") updatePeakSpeedPreset();
  if (t === "batch" && !batchReady && !batchWorker) startBatch();
  renderBatch();
}
function setReplaySettings(settings: ReplaySettings) {
  replay = settings;
  $<HTMLSelectElement>("replay-mode").value = replay.mode;
  $<HTMLInputElement>("replay-max").checked = replay.keepMaxOutput;
  document
    .querySelector('[data-action="replay-loop"]')!
    .setAttribute("aria-pressed", String(Boolean(replay.loop)));
}
function peakPresetSelected() {
  return $<HTMLSelectElement>("replay-preset").value === peakPresetId;
}
function resetPresetChoice() {
  $<HTMLSelectElement>("replay-preset").value = "";
  peakPresetSpeed = null;
  $("replay-preset-note").textContent = "";
}
function updatePeakSpeedPreset() {
  if (tab !== "batch" || !peakPresetSelected()) return;
  if (!tnEstimate) {
    $("replay-preset-note").textContent = "正在估算最高转速";
    renderBatch();
    return;
  }
  const limit = tnEstimate.forwardLimit;
  const peak =
    limit === null
      ? (speedRange ?? tnEstimate.span)
      : limit >= 1
        ? Math.floor(limit)
        : limit;
  $("replay-preset-note").textContent =
    limit === null
      ? "未找到有限正转上限 · 使用横轴范围"
      : p.model === "map"
        ? "最高转速按当前磁链表估算"
        : "";
  if (peak !== peakPresetSpeed) {
    const settings =
      peakPresetSpeed === null
        ? { ...replay, mode: "smooth" as const, keepMaxOutput: true }
        : replay;
    peakPresetSpeed = peak;
    loadRows("rpm\n0\n" + peak + "\n0", settings);
  } else renderBatch();
}
$("replay-mode").addEventListener("change", (e) => {
  stop();
  replay = {
    ...replay,
    mode: (e.target as HTMLSelectElement).value as ReplaySettings["mode"],
  };
  if (rowIndex >= 0) selectRow(rowIndex);
  else renderBatch();
});
$("replay-max").addEventListener("change", (e) => {
  stop();
  replay = { ...replay, keepMaxOutput: (e.target as HTMLInputElement).checked };
  if (rowIndex >= 0) selectRow(rowIndex);
  startBatch();
});
$("replay-preset").addEventListener("change", (e) => {
  const select = e.target as HTMLSelectElement;
  const preset = replayPresets.find(({ id }) => id === select.value);
  if (!preset) return;
  peakPresetSpeed = null;
  $("replay-preset-note").textContent = "";
  if (preset.csv === null) {
    stop();
    updatePeakSpeedPreset();
  } else {
    loadRows(preset.csv, {
      ...replay,
      mode: "smooth",
      keepMaxOutput: preset.id !== "mixed",
    });
  }
});
function textFile(filename: string, content: string, type: string) {
  download(filename, new Blob([content], { type }));
}
function exportCsv() {
  if (!frame) return;
  const batch = tab === "batch" && rows.length > 0;
  if (batch && !batchReady) {
    toast("批量求解完成后可导出");
    return;
  }
  const head =
    "mode,rpm,torque_Nm,id_A,iq_A,actual_id_A,actual_iq_A,ud_V,uq_V,Te_Nm,current_A,voltage_V,current_margin_A,voltage_margin_V,method,status,source_line";
  const output = (
    raw: string[],
    r: Result | null,
    err: string,
    line: string,
  ) => {
    const x = r?.point;
    const safe = (s: unknown) => {
      const str = String(s ?? "");
      const v =
        /^[=+@-]/.test(str) && !Number.isFinite(Number(str)) ? "'" + str : str;
      return '"' + v.replace(/"/g, '""') + '"';
    };
    return [
      ...raw,
      x?.d,
      x?.q,
      x?.ud,
      x?.uq,
      x?.torque,
      x?.current,
      x?.voltage,
      x?.im,
      x?.vm,
      r?.method,
      err || (r ? statusText[r.status] : ""),
      line,
    ]
      .map(safe)
      .join(",");
  };
  const op = frame.o;
  const lines = batch
    ? rows.map((row, i) => {
        const op = rowOperation(i);
        const raw =
          op && isMaxOutput(op)
            ? ["max-output", String(op.rpm), "", "", ""]
            : row.raw;
        return output(raw, batchResults[i], row.error, String(row.line));
      })
    : [
        output(
          [
            isMaxOutput(op) ? "max-output" : op.mode,
            String(op.rpm),
            op.mode === "auto" && !isMaxOutput(op) ? String(op.torque) : "",
            op.mode === "manual" ? String(op.id) : "",
            op.mode === "manual" ? String(op.iq) : "",
          ],
          frame.r,
          "",
          "",
        ),
      ];
  textFile(
    "FluxLab-" + (batch ? "批量结果" : "运行点") + ".csv",
    "\uFEFF" + [head, ...lines].join("\r\n"),
    "text/csv;charset=utf-8",
  );
}
function exportPng() {
  if (tab === "batch" && rowIndex >= 0 && !rows[rowIndex].op) {
    toast("当前行没有有效工况");
    return;
  }
  if (!frame) return;
  const c = document.createElement("canvas"),
    a = $<HTMLCanvasElement>("current"),
    b = $<HTMLCanvasElement>("voltage"),
    w = 1400,
    h = 560;
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#19314a";
  ctx.font = "bold 22px sans-serif";
  ctx.fillText("FluxLab  /  " + name, 24, 37);
  const { p: v, o: op, r } = frame;
  ctx.font = "15px sans-serif";
  ctx.fillText(
    [
      modelNames[v.model],
      op.rpm + " rpm",
      isMaxOutput(op)
        ? op.rpm === 0
          ? "最大静态转矩"
          : "最大出力"
        : op.mode === "auto"
          ? "目标 " + op.torque + " N·m"
          : "给定 " + op.id + ", " + op.iq + " A",
      statusText[r.status],
      r.method,
      v.direct ? "给定电压限值" : v.pwm,
      "相峰值",
    ].join("   ·   "),
    24,
    66,
  );
  function draw(src: HTMLCanvasElement, x: number, title: string) {
    ctx.font = "bold 17px sans-serif";
    ctx.fillText(title, x + 16, 105);
    const scale = Math.min(650 / src.width, 370 / src.height);
    ctx.drawImage(
      src,
      x + (690 - src.width * scale) / 2,
      112,
      src.width * scale,
      src.height * scale,
    );
  }
  draw(a, 0, "电流平面约束分析");
  draw(b, 700, "电压平面矢量图");
  ctx.font = "15px sans-serif";
  const currentCaption = [
    "P  ( " + f(r.point?.d, 2) + ", " + f(r.point?.q, 2) + " ) A     ",
    ...math.te,
    "  " + f(r.point?.torque, 2) + " N·m     ΔI  " + f(r.point?.im, 2) + " A",
  ];
  for (const run of mathCanvasLayout(ctx, currentCaption, "sans-serif", 15)
    .runs) {
    ctx.font = run.fontSpec;
    ctx.fillText(run.text, 24 + run.x, 518 + run.y);
  }
  ctx.font = "15px sans-serif";
  ctx.fillText(
    "P  ( " +
      f(r.point?.ud, 2) +
      ", " +
      f(r.point?.uq, 2) +
      " ) V     ΔV  " +
      f(r.point?.vm, 2) +
      " V",
    724,
    518,
  );
  c.toBlob((blob) => {
    if (blob) download("FluxLab-双图.png", blob);
  });
}
let importType: "open" | "map" | "batch" = "open";
function choose(t: typeof importType) {
  importType = t;
  const input = $<HTMLInputElement>("file");
  input.value = "";
  input.accept = t === "open" ? ".json,.fluxlab" : ".csv";
  input.click();
}
function loadRows(text: string, settings = replay) {
  const fresh = readBatch(text);
  stop();
  setReplaySettings(settings);
  rows = fresh;
  batchResults = [];
  batchReady = false;
  selectRow(0);
  startBatch();
}
function loadMap(text: string, file: string) {
  const map = readMap(text);
  p = { ...p, map, model: "map" };
  mapName = file;
  close();
  sidebar();
  enqueue(true);
}
$("file").addEventListener("change", async () => {
  const file = $<HTMLInputElement>("file").files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    if (importType === "map") loadMap(text, file.name);
    else if (importType === "batch") {
      loadRows(text);
      resetPresetChoice();
      renderBatch();
    } else {
      const v = readProject(text);
      stop();
      batchWorker?.terminate();
      batchWorker = null;
      batchRevision++;
      p = v.p;
      o = v.o;
      speedRange = v.speedRange;
      setReplaySettings(v.replay ?? defaultReplay);
      resetPresetChoice();
      name = v.name;
      motorPresetId = v.motorPresetId;
      mapName = v.mapName;
      rows = v.rows;
      rowIndex = -1;
      sidebar();
      enqueue(true);
      renderBatch();
      toast("已打开 " + name);
    }
  } catch (e) {
    toast((e as Error).message);
  }
});
function sample(file: string) {
  if (file === "flux-map.csv") return mapExample;
  return file === "playback-speeds.csv" ? speedExample : batchExample;
}
async function settled() {
  const until = performance.now() + 10000;
  while (dirty || busy) {
    if (performance.now() > until) throw Error("当前工况仍在求解，请稍后重试");
    await new Promise((resolve) => setTimeout(resolve, 8));
  }
}
function setExportMenu(open: boolean) {
  $("export-menu").hidden = !open;
  $("export-btn").setAttribute("aria-expanded", String(open));
}
async function action(a: string) {
  if (a !== "export-menu") {
    setExportMenu(false);
    if (a === "csv" || a === "png") $("export-btn").focus();
  }
  switch (a) {
    case "analysis":
    case "batch":
      changeTab(a);
      break;
    case "sidebar":
      document
        .querySelector('[data-action="sidebar"]')
        ?.setAttribute(
          "aria-expanded",
          String($("shell").classList.toggle("show-side")),
        );
      break;
    case "auto":
    case "manual": {
      if (a === o.mode) return;
      if (playing && replay.mode === "smooth") stop(true);
      await settled();
      const x = frame?.r.point;
      o = {
        ...o,
        mode: a,
        ...(x
          ? a === "manual"
            ? { id: x.d, iq: x.q }
            : { torque: x.torque }
          : {}),
      };
      stop();
      rowIndex = -1;
      sidebar();
      enqueue();
      renderBatch();
      break;
    }
    case "open":
      choose("open");
      break;
    case "save":
      textFile(
        name + ".fluxlab.json",
        JSON.stringify({
          version: 1,
          name,
          motorPresetId,
          p,
          o,
          mapName,
          rows,
          speedRange,
          replay,
        }),
        "application/json",
      );
      break;
    case "batch-import":
      choose("batch");
      break;
    case "map-import":
      choose("map");
      break;
    case "map-sample":
      loadMap(await sample("flux-map.csv"), "flux-map.csv");
      break;
    case "motor-presets":
      motorPresetDialog();
      break;
    case "apply-motor-preset": {
      const preset = findMotorPreset(
        $<HTMLSelectElement>("motor-preset-choice").value,
      );
      if (preset) applyMotorPreset(preset);
      break;
    }
    case "prev":
      stop();
      selectRow(rowIndex - 1);
      break;
    case "next":
      stop();
      selectRow(rowIndex + 1);
      break;
    case "play":
      playReplay();
      break;
    case "replay-loop":
      setReplaySettings({ ...replay, loop: !replay.loop });
      break;
    case "export-menu":
      setExportMenu($("export-menu").hidden);
      break;
    case "csv":
      if (playing && replay.mode === "smooth") stop(true);
      await settled();
      exportCsv();
      break;
    case "png":
      if (playing && replay.mode === "smooth") stop(true);
      await settled();
      exportPng();
      break;
    case "expand-current":
    case "expand-voltage":
      if (tab === "batch" && rowIndex >= 0 && !rows[rowIndex].op) {
        toast("当前行没有有效工况");
        break;
      }
      expanded = a === "expand-current" ? "current" : "voltage";
      modal(
        expanded === "current" ? "电流平面约束分析" : "电压平面矢量图",
        '<canvas id="zoom" class="plot"></canvas><div class="legend">' +
          legend(expanded) +
          "</div>",
        true,
      );
      graphs();
      break;
    case "compare":
      compare = true;
      comparison = null;
      showComparison();
      enqueue();
      break;
    case "reset":
      modal(
        "恢复示例参数",
        '<p>恢复基准电机、约束与默认运行点。当前工况序列将保留。</p><div class="map-links"><button class="btn" data-action="close">取消</button><button class="btn primary" data-action="confirm-reset">恢复参数</button></div>',
      );
      break;
    case "confirm-reset":
      stop();
      rowIndex = -1;
      p = { ...defaults };
      o = { ...initial };
      speedRange = undefined;
      name = "IPMSM 基准电机";
      motorPresetId = undefined;
      mapName = "";
      close();
      sidebar();
      enqueue(true);
      break;
    case "close":
      close();
      break;
    case "help":
      modal(
        "坐标约定与模型说明",
        "<h3>输入与运行点</h3><p>转速为有符号机械转速。电流、电压均为相基波峰值。自动求点可按给定电磁转矩寻找最小电流。勾选「最大出力转矩」时，按当前转速和约束实时求最大出力，并显示电磁转矩乘机械角速度得到的机械转换功率。手动验点直接计算指定电流。P 表示选中的运行点或标明的边界点。</p><h3>稳态 dq 方程</h3><p>ω<sub>e</sub> = 2πpn / 60<br>V<sub>d</sub> = R<sub>s</sub>i<sub>d</sub> − ω<sub>e</sub>ψ<sub>q</sub>　　V<sub>q</sub> = R<sub>s</sub>i<sub>q</sub> + ω<sub>e</sub>ψ<sub>d</sub><br>T<sub>e</sub> = 1.5p (ψ<sub>d</sub>i<sub>q</sub> − ψ<sub>q</sub>i<sub>d</sub>)</p><h3>模型与约束</h3><p>默认使用常参数工程模型，并计入定子电阻。可关闭定子电阻或切换到理想模型进行对照。工程模型可按绕组温度修正铜阻，铜温度系数取 0.00393 / °C。磁链图以双线性插值计算总磁链。线性调制的相电压峰值上限，SVPWM 为 V<sub>dc</sub> / √3，SPWM 为 V<sub>dc</sub> / 2。常参数工程模型与磁链图模型可再乘以电压利用率 k<sub>v</sub>。直接给定电压上限时，求解使用输入的电压值。紫色六边形表示理想两电平逆变器可合成的平均电压范围，顶点幅值为 2V<sub>dc</sub> / 3。图中取转子电角度 0°，第一个顶点沿正 d 轴。橙色圆表示求解采用的电压限值。</p><h3>读图</h3><p>转矩–转速图默认显示零及正转矩，勾选「显示负转矩」即可查看完整包络。横轴默认随模型求得的可达转速边界调整，图下滑块与横轴同尺度。未找到有限边界时，横轴保留观察范围。可清空横轴范围输入框恢复自动估算。输入更高转速时横轴自动涵盖当前点。电流图的着色区域同时满足电流与电压约束。MTPA 是单位电流最大转矩轨迹。MTPV 是固定转速下，各电压幅值对应的最大正、负转矩点的轨迹。圆点对应当前电压限值，仍需结合电流极限判断是否可达。常参数模型计入当前电阻设置，非零转速时显示 MTPV。电压图将各项首尾相接，蓝色矢量是从原点指向合成端点的端电压。常参数模型依次连接永磁反电动势、电感电压和电阻压降。前两项的终点是旋转磁链电压。电感电压 V<sub>L</sub> 的 (d, q) 分量为 (−ω<sub>e</sub>L<sub>q</sub>i<sub>q</sub>, ω<sub>e</sub>L<sub>d</sub>i<sub>d</sub>)。磁链图模型使用当前工况的总磁链，显示 −ω<sub>e</sub>ψ<sub>q</sub> 在 d 轴上的分量和 ω<sub>e</sub>ψ<sub>d</sub> 在 q 轴上的分量。零值分量可在明细中查看。裕量等于极限减去实际幅值。</p><h3>工况回放</h3><p>可直接载入预设，也可导入工况 CSV 或只含 rpm 一列的转速表。「0 → 最高速 → 0」按当前约束估算正转上限。未找到有限上限时使用横轴范围。开启「循环回放」后，序列会重复播放。平滑过渡缓入缓出，同类工况插值目标转矩或 dq 电流，混合给定方式使用两端 dq 电流衔接。勾选「保持最大出力」后，回放按每个转速重新求最大出力。分析、回放和导出复用同一模型。</p>",
      );
      break;
  }
}
document.addEventListener("click", (e) => {
  const el = e.target as HTMLElement,
    link = el.closest<HTMLAnchorElement>("a[download]"),
    btn = el.closest<HTMLElement>("[data-action]"),
    row = el.closest<HTMLElement>("[data-row]");
  if (link) {
    e.preventDefault();
    const file = link.getAttribute("href")!.split("/").at(-1)!;
    textFile(file, sample(file), "text/csv;charset=utf-8");
    return;
  }
  if (btn) {
    action(btn.dataset.action!).catch((err) => toast(err.message));
    return;
  }
  if (row) {
    stop();
    selectRow(+row.dataset.row!);
  }
  if (!el.closest(".popup-wrap")) setExportMenu(false);
});
$("dialog").addEventListener("click", (e) => {
  if (e.target === $("dialog")) close();
});
document.addEventListener("keydown", (e) => {
  const el = e.target as HTMLElement;
  if (e.key === "Enter" && el.dataset.row) {
    stop();
    selectRow(+el.dataset.row);
  }
  if (e.key === "Escape" && !$("export-menu").hidden) {
    e.preventDefault();
    setExportMenu(false);
    $("export-btn").focus();
  }
});
sidebar();
enqueue();
