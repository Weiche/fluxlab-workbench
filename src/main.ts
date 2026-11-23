import "./style.css";
import { icon } from "./icons.ts";
import {
  defaults,
  initial,
  limit,
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
import { chart, type Frame } from "./charts.ts";
import type { Geometry } from "./geometry.ts";
import { voltageComponents } from "./voltage.ts";
import SolverWorker from "./worker.ts?worker&inline";
import batchExample from "../public/examples/operating-points.csv?raw";
import mapExample from "../public/examples/flux-map.csv?raw";

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
  '<span><i class="dash" style="--color:#ce8740"></i>电压极限</span>';
const legend = (kind: string) =>
  kind === "current"
    ? '<span><i class="area"></i>可行域</span><span><i style="--color:#2963d9"></i>电流极限</span><span><i style="--color:#ce8740"></i>电压极限</span><span><i class="dash" style="--color:#9670ba"></i>等转矩线</span><span class="mtpa"><i class="dash" style="--color:#10988b"></i>MTPA</span><span class="no-data" hidden><i class="unmapped"></i>无数据</span>'
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
<main><div class="page-head"><div><h1 id="page-title">稳态运行分析</h1><div class="project-meta">${icon("motor", 14)}<span id="project-name"></span><i></i><span id="model-meta"></span></div></div><div class="details-action"><label class="head-model">${icon("model", 14)}<select aria-label="模型" id="model-choice"><option value="ideal">理想模型</option><option value="engineering">常参数工程模型</option><option value="map">磁链图模型</option></select></label><button class="small-btn hide-side" data-action="sidebar" aria-expanded="false" aria-controls="side">${icon("sliders")}参数</button><div class="popup-wrap"><button class="btn primary" data-action="export-menu" aria-haspopup="true" aria-expanded="false" id="export-btn">${icon("export")}导出结果${icon("down", 12)}</button><div id="export-menu" class="menu" hidden><button data-action="csv">导出结果 CSV</button><button data-action="png">导出双图 PNG</button></div></div></div></div>
<section class="card batch-panel" id="batch-panel" hidden><div class="section-head"><span class="icon-tile">${icon("batch")}</span><h2>工况序列</h2><div class="batch-actions"><button class="small-btn" data-action="batch-import">${icon("folder", 14)}导入 CSV</button><button class="small-btn" data-action="sample">载入示例</button>${iconButton("prev", "上一工况", "prev")}${iconButton("play", "播放或暂停", "play")}${iconButton("next", "下一工况", "next")}</div></div><div id="batch-list"></div></section>
<section class="metrics" aria-label="运行指标">${metric("torque", "电磁转矩", "torque", "#147f72", "N·m")}${metric("current", "电流幅值", "wave", "#3472b9", "A")}${metric("voltage", "电压幅值", "bolt", "#ba843b", "V")}${metric("speed", "机械转速", "speed", "#8371a6", "rpm")}</section>
<div class="plots">${card("current", "电流平面约束分析", "grid", "")}${card("voltage", "电压平面矢量图", "vector", "blue")}</div>
<section class="card detail-card"><div class="section-head"><span class="icon-tile">${icon("table")}</span><h2>运行点明细</h2><button class="cmp-toggle" data-action="compare" id="compare-btn">求解器对照 ${icon("right", 12)}</button><span class="status" id="status">计算中</span></div><div class="detail-body"><div class="values"><table class="data-table"><thead><tr><th>物理量</th><th>d 轴</th><th>q 轴</th><th>单位</th></tr></thead><tbody id="values"></tbody></table></div><div class="margins"><h3>约束裕量</h3><div id="margins"></div></div></div><div class="error-text" id="state-note" hidden></div></section>
</main></div><footer class="bottom"><span class="live" id="live">实时求解</span><span id="method"></span><span>dq 同步坐标系</span><span class="push">幅值约定 · 相峰值</span><span>FluxLab 1.0</span></footer>
<dialog id="dialog"><div class="section-head"><h2 id="dialog-title"></h2>${iconButton("close", "关闭", "close")}</div><div class="dialog-inner" id="dialog-body"></div></dialog><input id="file" type="file" hidden><div class="toast" id="toast" role="status" hidden></div>`;
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
const symbols: Partial<Record<Key, string>> = {
  rpm: "n",
  torque: "Tₑ",
  id: "iᵈ",
  iq: "iᑫ",
  poles: "p",
  ld: "Lᵈ",
  lq: "Lᑫ",
  psi: "ψf",
  vdc: "Udc",
  imax: "Imax",
};
const source = (k: Key) => (k in o ? o[k as "rpm"] : p[k as "ld"]);
const num = (k: Key) =>
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
  source(k) +
  '">' +
  (unit[k] ? "<span>" + unit[k] + "</span>" : "") +
  "</div>";
function field(k: Key) {
  return (
    '<div class="field"><label for="n-' +
    k +
    '">' +
    labels[k] +
    ' <i class="symbol">' +
    (symbols[k] ?? "") +
    "</i></label>" +
    num(k) +
    "</div>"
  );
}
function range(k: Key, lo: number, hi: number, step: number) {
  const val = source(k);
  lo = Math.min(val, lo);
  hi = Math.max(val, hi);
  return (
    '<div class="range-field"><div class="range-top"><label for="s-' +
    k +
    '">' +
    labels[k] +
    ' <i class="symbol">' +
    (symbols[k] ?? "") +
    "</i></label>" +
    num(k) +
    '</div><input id="s-' +
    k +
    '" aria-label="' +
    labels[k] +
    '滑块" data-range="' +
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
const flag = (k: "useR" | "useTemp" | "useK" | "direct", s: string) =>
  '<label class="check"><input type="checkbox" data-flag="' +
  k +
  '" ' +
  (p[k] ? "checked" : "") +
  ">" +
  s +
  "</label>";
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
  const mode = o.mode === "auto",
    map = p.model === "map";
  const op =
    '<div class="segmented" aria-label="运行点给定方式"><button data-action="auto" class="' +
    (mode ? "sel" : "") +
    '">自动求点</button><button data-action="manual" class="' +
    (!mode ? "sel" : "") +
    '">手动验点</button></div>' +
    range("rpm", -8000, 8000, 10) +
    (mode
      ? range("torque", -120, 120, 0.5)
      : range("id", -p.imax, p.imax, 0.5) + range("iq", -p.imax, p.imax, 0.5));
  const motor =
    field("poles") +
    (map
      ? '<p class="note">磁链来自导入的 dq 查表数据。</p>'
      : field("ld") + field("lq") + field("psi"));
  const constraint =
    range(p.direct ? "vmax" : "vdc", 1, p.direct ? 600 : 800, 1) +
    range("imax", 1, 400, 1) +
    flag("direct", "直接给定可用电压上限");
  $<HTMLSelectElement>("model-choice").value = p.model;
  const model =
    (map
      ? '<div class="note file-name">' +
        esc(mapName) +
        '</div><div class="map-links"><button class="small-btn" data-action="map-import">导入磁链图</button><a class="inline-link" download href="./examples/flux-map.csv">示例 CSV</a></div>'
      : "") +
    (p.model !== "ideal"
      ? flag("useR", "计入定子电阻") +
        (p.useR
          ? field("rs") +
            flag("useTemp", "铜阻温度修正") +
            (p.useTemp ? field("temperature") : "")
          : "") +
        (!p.direct
          ? flag("useK", "修正电压利用率") + (p.useK ? field("k") : "")
          : "")
      : "") +
    '<div class="field"><label for="solver">求解器</label><select id="solver" ' +
    (p.model !== "ideal" || !mode ? "disabled" : "") +
    ">" +
    (mode
      ? '<option value="analytic" ' +
        (p.model === "ideal" && p.solver === "analytic" ? "selected" : "") +
        '>解析法</option><option value="numeric" ' +
        (p.model !== "ideal" || p.solver === "numeric" ? "selected" : "") +
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
}
function toast(t: string) {
  $("toast").textContent = t;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => ($("toast").hidden = true), 4500);
}
let dragging = false;
let pending: { p: Parameters; o: Operation; id: number } | null = null;
function enqueue(modelChange = false) {
  if (modelChange) {
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
  pending = { p: { ...p }, o: { ...o }, id: ++id };
  const keepMap = p.map === sentMap;
  worker.postMessage({
    id,
    p: sentRevision === revision ? null : { ...p, map: keepMap ? null : p.map },
    keepMap,
    o,
    compare,
    preview: dragging,
    ratio: plotRatio(),
  });
  sentRevision = revision;
  sentMap = p.map;
}
worker.onmessage = (e) => {
  busy = false;
  const m = e.data;
  if (m.error) {
    toast(m.error);
    if (dirty) send();
    return;
  }
  if (m.g) lastG = m.g;
  if (pending && lastG) {
    frame = { p: pending.p, o: m.o, r: m.r, g: lastG };
    comparison = m.comparison;
    renderFrame();
    $("live").textContent = m.preview ? "拖动预览" : "实时求解";
  }
  if (dirty) send();
};
worker.onerror = (e) => {
  busy = false;
  toast("求解线程异常 " + e.message);
};
function graphs() {
  if (!frame) return;
  if (tab === "batch" && rowIndex >= 0 && !rows[rowIndex]?.op) {
    invalidRowView();
    return;
  }
  chart($("current"), "current", frame);
  chart($("voltage"), "voltage", frame);
  if (expanded && $("zoom")) chart($("zoom"), expanded, frame);
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
function renderFrame() {
  if (!frame) return;
  const { p: v, o: op, r } = frame,
    x = r.point;
  if (tab === "batch" && rowIndex >= 0 && !rows[rowIndex].op) {
    invalidRowView();
    return;
  }
  $("m-torque").textContent = f(x?.torque);
  $("m-current").textContent = f(x?.current);
  $("m-voltage").textContent = f(x?.voltage);
  $("m-speed").textContent = op.rpm.toLocaleString("en-US", {
    maximumFractionDigits: 1,
  });
  $("f-torque").textContent =
    op.mode === "auto" ? "目标 " + f(op.torque, 1) + " N·m" : "由给定电流计算";
  $("f-current").textContent = "极限 " + f(v.imax, 1) + " A";
  $("f-voltage").textContent = "极限 " + f(limit(v), 1) + " V";
  $("f-speed").textContent =
    "电频率 " + f(Math.abs((op.rpm * v.poles) / 60), 1) + " Hz";
  $("status").textContent = statusText[r.status];
  $("status").className = "status" + (r.status === "ok" ? "" : " warn");
  $("method").textContent = r.method;
  $("live").textContent = "实时求解";
  $("compare-btn").hidden = v.model !== "ideal" || op.mode !== "auto";
  const val = (
    label: string,
    a: number | undefined,
    b: number | undefined,
    u: string,
  ) =>
    "<tr><td>" +
    label +
    "</td><td>" +
    f(a, 2) +
    "</td><td>" +
    f(b, 2) +
    '</td><td class="unit">' +
    u +
    "</td></tr>";
  $("values").innerHTML =
    val(
      "定子电流",
      x?.d ?? (op.mode === "manual" ? op.id : undefined),
      x?.q ?? (op.mode === "manual" ? op.iq : undefined),
      "A",
    ) +
    val("端电压", x?.ud, x?.uq, "V") +
    voltageComponents(v, op.rpm, x)
      .map(({ label, symbol, ud, uq }) =>
        val(label + " " + symbol, ud, uq, "V"),
      )
      .join("");
  const legendElement = $("voltage").nextElementSibling!;
  if (legendElement.getAttribute("data-model") !== v.model) {
    legendElement.innerHTML = voltageLegend(v);
    legendElement.setAttribute("data-model", v.model);
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
  $("state-note").hidden = !notes[r.status];
  $("state-note").textContent = notes[r.status] ?? "";
  document
    .querySelectorAll<HTMLElement>(".mtpa")
    .forEach((el) => (el.hidden = v.model === "map"));
  document
    .querySelectorAll<HTMLElement>(".no-data")
    .forEach((el) => (el.hidden = v.model !== "map"));
  graphs();
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
new ResizeObserver(() => {
  graphs();
  enqueue();
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
    dragging = false;
    enqueue();
    if (tab === "batch" && !batchReady && !batchWorker) startBatch();
    return;
  }
  if (k) {
    if (el.value === "" || !setNumber(k, +el.value)) {
      toast(labels[k] + " 超出有效范围");
      el.value = String(source(k));
    }
    sidebar();
    return;
  }
  if (el.dataset.flag) {
    p = { ...p, [el.dataset.flag]: el.checked };
    sidebar();
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
      ? '<table class="data-table comparison"><thead><tr><th>方法</th><th>id / A</th><th>iq / A</th><th>Te / N·m</th><th>ΔU / V</th><th>转矩残差 / N·m</th></tr></thead><tbody>' +
          line(a) +
          line(b) +
          "</tbody></table>" +
          delta
      : "正在独立求解…",
    true,
  );
}
function stop() {
  if (playing) clearInterval(playing);
  playing = 0;
  const b = document.querySelector<HTMLButtonElement>("[data-action=play]");
  if (b) b.innerHTML = icon("play");
}
function invalidRowView() {
  const row = rows[rowIndex];
  if (!row || row.op) return;
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
  $("status").textContent = "输入无效";
  $("status").className = "status warn";
  $("values").innerHTML = "";
  $("margins").innerHTML = "";
  $("compare-btn").hidden = true;
  $("state-note").hidden = false;
  $("state-note").textContent = "第 " + row.line + " 行 · " + row.error;
}
function selectRow(i: number) {
  if (i < 0 || i >= rows.length) return;
  rowIndex = i;
  const op = rows[i].op;
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
      ops: rows.slice(pos, pos + 8).map((row) => row.op),
    });
  }
  w.onmessage = (e) => {
    if (token !== batchRevision) return;
    if (e.data.error) {
      toast(e.data.error);
      w.terminate();
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
  w.onerror = (e) => toast("批量求解失败 " + e.message);
  next();
  renderBatch();
}
function renderBatch() {
  if (tab !== "batch") return;
  $("batch-list").innerHTML = rows.length
    ? '<div class="batch-table"><table class="data-table"><thead><tr><th>行</th><th>给定方式</th><th>机械转速 / rpm</th><th>给定值</th><th>转矩 / N·m</th><th>状态</th></tr></thead><tbody>' +
      rows
        .map((row, i) => {
          const op = row.op,
            r = batchResults[i];
          return (
            '<tr tabindex="0" data-row="' +
            i +
            '" class="' +
            (rowIndex === i ? "active" : "") +
            '"><td>' +
            row.line +
            "</td><td>" +
            (op?.mode === "auto" ? "自动求点" : op ? "手动验点" : "—") +
            "</td><td>" +
            (op?.rpm ?? "—") +
            "</td><td>" +
            (op
              ? op.mode === "auto"
                ? op.torque + " N·m"
                : op.id + ", " + op.iq + " A"
              : "—") +
            "</td><td>" +
            f(r?.point?.torque, 2) +
            "</td><td>" +
            esc(row.error || (r ? statusText[r.status] : "计算中")) +
            "</td></tr>"
          );
        })
        .join("") +
      "</tbody></table></div>"
    : '<div class="batch-empty">导入工况表或载入示例，逐点查看约束与矢量。<a class="inline-link" href="./examples/operating-points.csv" download>下载 CSV 模板</a></div>';
  for (const a of ["prev", "next", "play"]) {
    const b = document.querySelector<HTMLButtonElement>(
      "[data-action=" + a + "]",
    )!;
    b.disabled =
      !rows.length ||
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
  if (t === "batch" && !batchReady && !batchWorker) startBatch();
  renderBatch();
}
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
    ? rows.map((row, i) =>
        output(row.raw, batchResults[i], row.error, String(row.line)),
      )
    : [
        output(
          [
            op.mode,
            String(op.rpm),
            op.mode === "auto" ? String(op.torque) : "",
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
      op.mode === "auto"
        ? "目标 " + op.torque + " N·m"
        : "给定 " + op.id + ", " + op.iq + " A",
      statusText[r.status],
      r.method,
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
  ctx.fillText(
    "P  ( " +
      f(r.point?.d, 2) +
      ", " +
      f(r.point?.q, 2) +
      " ) A     Te  " +
      f(r.point?.torque, 2) +
      " N·m     ΔI  " +
      f(r.point?.im, 2) +
      " A",
    24,
    518,
  );
  ctx.fillText(
    "P  ( " +
      f(r.point?.ud, 2) +
      ", " +
      f(r.point?.uq, 2) +
      " ) V     ΔU  " +
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
function loadRows(text: string) {
  const fresh = readBatch(text);
  stop();
  rows = fresh;
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
    else if (importType === "batch") loadRows(text);
    else {
      const v = readProject(text);
      stop();
      batchWorker?.terminate();
      batchWorker = null;
      batchRevision++;
      p = v.p;
      o = v.o;
      name = v.name;
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
  return file === "flux-map.csv" ? mapExample : batchExample;
}
async function settled() {
  const until = performance.now() + 10000;
  while (dirty || busy) {
    if (performance.now() > until) throw Error("当前工况仍在求解，请稍后重试");
    await new Promise((resolve) => setTimeout(resolve, 8));
  }
}
async function action(a: string) {
  if (a !== "export-menu") {
    $("export-menu").hidden = true;
    $("export-btn").setAttribute("aria-expanded", "false");
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
        JSON.stringify({ version: 1, name, p, o, mapName, rows }),
        "application/json",
      );
      break;
    case "batch-import":
      choose("batch");
      break;
    case "map-import":
      choose("map");
      break;
    case "sample":
      loadRows(await sample("operating-points.csv"));
      break;
    case "map-sample":
      loadMap(await sample("flux-map.csv"), "flux-map.csv");
      break;
    case "prev":
      selectRow(rowIndex - 1);
      break;
    case "next":
      selectRow(rowIndex + 1);
      break;
    case "play":
      if (playing) {
        stop();
        break;
      }
      if (rowIndex < 0 || rowIndex === rows.length - 1) selectRow(0);
      playing = window.setInterval(() => {
        if (rowIndex >= rows.length - 1) stop();
        else selectRow(rowIndex + 1);
      }, 900);
      document.querySelector("[data-action=play]")!.innerHTML = icon("pause");
      break;
    case "export-menu":
      $("export-menu").hidden = !$("export-menu").hidden;
      $("export-btn").setAttribute(
        "aria-expanded",
        String(!$("export-menu").hidden),
      );
      break;
    case "csv":
      await settled();
      exportCsv();
      break;
    case "png":
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
      name = "IPMSM 基准电机";
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
        "<h3>输入与运行点</h3><p>转速为有符号机械转速。电流、电压均为相基波峰值。自动求点寻找满足目标电磁转矩的最小电流，手动验点直接计算指定电流。P 表示选中的运行点或标明的边界点。</p><h3>稳态 dq 方程</h3><p>ωₑ = 2πpn / 60<br>uᵈ = Rₛiᵈ − ωₑψᑫ　　uᑫ = Rₛiᑫ + ωₑψᵈ<br>Tₑ = 1.5p (ψᵈiᑫ − ψᑫiᵈ)</p><h3>模型与约束</h3><p>理想模型使用常数电感与永磁体磁链，定子电阻为零。工程模型可启用铜阻和温度修正，铜温度系数取 0.00393 / °C。磁链图以双线性插值计算总磁链。线性 SVPWM 电压上限为 kᵤUdc / √3。</p><h3>读图</h3><p>电流图的着色区域同时满足电流与电压约束。MTPA 是单位电流最大转矩轨迹。电压图将各项首尾相接，蓝色矢量是从原点指向合成端点的端电压。常参数模型显示电阻压降、永磁反电动势及两轴电流耦合项。磁链图模型使用当前工况的总磁链，显示 −ωₑψq 在 d 轴上的分量和 ωₑψd 在 q 轴上的分量。零值分量可在明细中查看。裕量等于极限减去实际幅值。</p><h3>工况回放</h3><p>导入 CSV 后点击表格行或播放。分析、回放和导出复用同一模型。示例电机与磁链数据用于方法验证。</p>",
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
  if (!el.closest(".popup-wrap")) {
    $("export-menu").hidden = true;
    $("export-btn").setAttribute("aria-expanded", "false");
  }
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
  if (e.key === "Escape") $("export-menu").hidden = true;
});
sidebar();
enqueue();
