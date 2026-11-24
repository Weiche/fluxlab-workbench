import {
  defaults,
  pwmMethods,
  initial,
  type FluxMap,
  type Operation,
  type Parameters,
} from "./model.ts";
import type { ReplaySettings } from "./replay.ts";
export interface Row {
  line: number;
  op: Operation | null;
  error: string;
  raw: string[];
}
export interface Project {
  name: string;
  p: Parameters;
  o: Operation;
  rows: Row[];
  mapName: string;
  speedRange?: number;
  replay?: ReplaySettings;
}
function csv(text: string) {
  const lines = text
    .replace(/^\uFEFF/, "")
    .trimEnd()
    .split(/\r?\n/);
  return lines
    .map((line, i) => ({
      line: i + 1,
      data: line.split(",").map((v) => v.trim().replace(/^"(.*)"$/, "$1")),
    }))
    .filter((row) => row.data.some((v) => v.length));
}
function number(value: string | undefined, label: string) {
  if (value === undefined || value === "" || !Number.isFinite(Number(value)))
    throw Error(label + " 缺少有效数值");
  return Number(value);
}
function columns(header: string[], names: string[]) {
  const ids = names.map((x) => header.indexOf(x));
  if (ids.includes(-1) || new Set(header).size !== header.length)
    throw Error("CSV 表头应包含 " + names.join(", "));
  return ids;
}
export function readMap(text: string): FluxMap {
  const [header, ...rows] = csv(text),
    names = ["id_A", "iq_A", "psi_d_Wb", "psi_q_Wb"],
    ix = columns(header?.data ?? [], names);
  const pts = rows.map((row) =>
    ix.map((i, j) => number(row.data[i], "第 " + row.line + " 行 " + names[j])),
  );
  const axis = (i: number) =>
    Array.from(new Set(pts.map((v) => v[i]))).sort((a, b) => a - b);
  const d = axis(0),
    q = axis(1);
  if (d.length < 2 || q.length < 2) throw Error("两条电流轴均需至少两个节点");
  if (d.length * q.length !== pts.length) throw Error("网格不完整或含重复点");
  const fd = d.map(() => Array<number>(q.length).fill(NaN)),
    fq = d.map(() => Array<number>(q.length));
  const di = new Map(d.map((x, i) => [x, i])),
    qi = new Map(q.map((x, i) => [x, i]));
  for (const [x, y, a, b] of pts) {
    const i = di.get(x)!,
      j = qi.get(y)!;
    if (Number.isFinite(fd[i][j])) throw Error("网格含重复电流点");
    fd[i][j] = a;
    fq[i][j] = b;
  }
  return { d, q, fd, fq };
}
export const batchHeader = "mode,rpm,torque_Nm,id_A,iq_A";
export function readBatch(text: string): Row[] {
  const [header, ...rows] = csv(text);
  const speedOnly = header?.data.length === 1 && header.data[0] === "rpm";
  const ix = speedOnly
    ? []
    : columns(header?.data ?? [], batchHeader.split(","));
  if (!rows.length) throw Error("CSV 中没有工况");
  return rows.map(({ line, data }) => {
    const raw = speedOnly
      ? ["max-output", data[0] ?? "", "", "", ""]
      : ix.map((i) => data[i] ?? "");
    try {
      const [mode, n, t, d, q] = raw;
      if (mode !== "auto" && mode !== "manual" && mode !== "max-output")
        throw Error("mode 应为 auto、manual 或 max-output");
      const op: Operation = {
        ...initial,
        mode: mode === "max-output" ? "auto" : mode,
        rpm: number(n, "rpm"),
      };
      if (mode === "max-output") op.maxOutput = true;
      else if (mode === "auto") op.torque = number(t, "torque_Nm");
      else {
        op.id = number(d, "id_A");
        op.iq = number(q, "iq_A");
      }
      if (!validOp(op)) throw Error("给定超过支持范围");
      return { op, line, error: "", raw };
    } catch (e) {
      return { op: null, line, error: (e as Error).message, raw };
    }
  });
}
export const bounds = {
  poles: [1, 200],
  ld: [0.0001, 1000],
  lq: [0.0001, 1000],
  psi: [0.000001, 100],
  rs: [0, 100],
  temperature: [-100, 500],
  k: [0.001, 1],
  vdc: [0.01, 100000],
  vmax: [0.01, 100000],
  imax: [0.01, 100000],
  rpm: [-1e6, 1e6],
  torque: [-1e7, 1e7],
  id: [-1e5, 1e5],
  iq: [-1e5, 1e5],
} as const;
const inRange = (v: unknown, key: keyof typeof bounds) =>
  typeof v === "number" &&
  Number.isFinite(v) &&
  v >= bounds[key][0] &&
  v <= bounds[key][1];
function validOp(o: Operation) {
  return (
    o &&
    ["auto", "manual"].includes(o.mode) &&
    (o.maxOutput === undefined || typeof o.maxOutput === "boolean") &&
    (["rpm", "torque", "id", "iq"] as const).every((k) => inRange(o[k], k))
  );
}
function validMap(m: FluxMap) {
  if (!m || !Array.isArray(m.d) || !Array.isArray(m.q)) return false;
  return (
    [m.d, m.q].every(
      (axis) =>
        axis.length >= 2 &&
        axis.every(
          (v, i) => Number.isFinite(v) && (i === 0 || v > axis[i - 1]),
        ),
    ) &&
    [m.fd, m.fq].every(
      (matrix) =>
        Array.isArray(matrix) &&
        matrix.length === m.d.length &&
        matrix.every(
          (row) =>
            Array.isArray(row) &&
            row.length === m.q.length &&
            row.every(Number.isFinite),
        ),
    )
  );
}
export function readProject(text: string): Project {
  const v = JSON.parse(text),
    p = v.p;
  if (
    v.version !== 1 ||
    !p ||
    typeof v.name !== "string" ||
    typeof v.mapName !== "string" ||
    !validOp(v.o) ||
    !Array.isArray(v.rows)
  )
    throw Error("无效的 FluxLab 项目");
  for (const key of Object.keys(defaults) as (keyof Parameters)[]) {
    if (key in bounds && !inRange(p[key], key as keyof typeof bounds))
      throw Error("项目参数无效 " + key);
    if (typeof defaults[key] === "boolean" && typeof p[key] !== "boolean")
      throw Error("项目选项无效 " + key);
  }
  if (
    !Number.isInteger(p.poles) ||
    !["ideal", "engineering", "map"].includes(p.model) ||
    !["numeric", "analytic"].includes(p.solver) ||
    (p.map !== null && !validMap(p.map)) ||
    (p.model === "map" && !p.map)
  )
    throw Error("模型或磁链网格无效");
  if (
    !v.rows.every(
      (r: Row) =>
        r &&
        Array.isArray(r.raw) &&
        r.raw.length === 5 &&
        r.raw.every((s) => typeof s === "string") &&
        typeof r.error === "string" &&
        Number.isInteger(r.line) &&
        (r.op === null || validOp(r.op)),
    )
  )
    throw Error("工况数据无效");
  const pwm = p.pwm === undefined ? defaults.pwm : p.pwm;
  if (!pwmMethods.includes(pwm)) throw Error("项目调制方式无效");
  const speedRange = v.speedRange;
  if (
    speedRange !== undefined &&
    (!inRange(speedRange, "rpm") || speedRange < 1)
  )
    throw Error("项目横轴范围无效");
  const replay = v.replay;
  if (
    replay !== undefined &&
    (!replay ||
      (replay.mode !== "step" && replay.mode !== "smooth") ||
      typeof replay.keepMaxOutput !== "boolean" ||
      (replay.loop !== undefined && typeof replay.loop !== "boolean"))
  )
    throw Error("项目回放设置无效");
  return {
    name: v.name,
    p: { ...p, pwm },
    o: v.o,
    rows: v.rows,
    mapName: v.mapName,
    speedRange,
    replay,
  };
}
export function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
