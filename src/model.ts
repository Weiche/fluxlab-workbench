export interface FluxMap {
  d: number[];
  q: number[];
  fd: number[][];
  fq: number[][];
}
export interface Parameters {
  poles: number;
  ld: number;
  lq: number;
  psi: number;
  rs: number;
  temperature: number;
  useR: boolean;
  useTemp: boolean;
  useK: boolean;
  k: number;
  direct: boolean;
  vdc: number;
  vmax: number;
  imax: number;
  model: "ideal" | "engineering" | "map";
  solver: "analytic" | "numeric";
  map: FluxMap | null;
}
export interface Operation {
  mode: "auto" | "manual";
  rpm: number;
  torque: number;
  id: number;
  iq: number;
}
export const defaults: Parameters = {
  poles: 4,
  ld: 0.45,
  lq: 0.9,
  psi: 0.09,
  rs: 0.045,
  temperature: 80,
  useR: true,
  useTemp: false,
  useK: false,
  k: 0.95,
  direct: false,
  vdc: 260,
  vmax: 150,
  imax: 120,
  model: "ideal",
  solver: "analytic",
  map: null,
};
export const initial: Operation = {
  mode: "auto",
  rpm: 3000,
  torque: 48,
  id: 0,
  iq: 80,
};
export const limit = (p: Parameters) =>
  p.direct
    ? p.vmax
    : (p.vdc * (p.model !== "ideal" && p.useK ? p.k : 1)) / Math.sqrt(3);
export const resistance = (p: Parameters) =>
  p.model !== "ideal" && p.useR
    ? p.rs * (p.useTemp ? 1 + 0.00393 * (p.temperature - 20) : 1)
    : 0;
export const omega = (p: Parameters, n: number) => (n * p.poles * Math.PI) / 30;
export function cell(axis: number[], value: number) {
  let a = 0,
    b = axis.length - 1;
  while (b - a > 1) {
    const k = (a + b) >> 1;
    if (value < axis[k]) b = k;
    else a = k;
  }
  return a;
}
export function flux(
  p: Parameters,
  d: number,
  q: number,
): [number, number] | null {
  if (p.model !== "map") return [p.psi + (p.ld * d) / 1000, (p.lq * q) / 1000];
  const m = p.map;
  if (!m || d < m.d[0] || d > m.d.at(-1)! || q < m.q[0] || q > m.q.at(-1)!)
    return null;
  const i = cell(m.d, d),
    j = cell(m.q, q),
    x = (d - m.d[i]) / (m.d[i + 1] - m.d[i]),
    y = (q - m.q[j]) / (m.q[j + 1] - m.q[j]);
  const lerp = (v: number[][]) =>
    (1 - x) * ((1 - y) * v[i][j] + y * v[i][j + 1]) +
    x * ((1 - y) * v[i + 1][j] + y * v[i + 1][j + 1]);
  return [lerp(m.fd), lerp(m.fq)];
}
export function point(p: Parameters, n: number, d: number, q: number) {
  const f = flux(p, d, q);
  if (!f) return null;
  const w = omega(p, n),
    r = resistance(p),
    ed = -w * f[1],
    eq = w * f[0],
    ud = r * d + ed,
    uq = r * q + eq;
  const current = Math.hypot(d, q),
    voltage = Math.hypot(ud, uq),
    torque = 1.5 * p.poles * (f[0] * q - f[1] * d);
  return {
    d,
    q,
    ud,
    uq,
    ed,
    eq,
    rd: r * d,
    rq: r * q,
    current,
    voltage,
    torque,
    im: p.imax - current,
    vm: limit(p) - voltage,
  };
}
export type Point = NonNullable<ReturnType<typeof point>>;
export type Status =
  | "ok"
  | "over"
  | "unreachable"
  | "outside"
  | "coverage"
  | "empty"
  | "unresolved";
export interface Result {
  point: Point | null;
  status: Status;
  method: string;
}
const eps = 1e-8;
const feasible = (p: Parameters, x: Point) =>
  x.im >= -eps * (1 + p.imax) && x.vm >= -eps * (1 + limit(p));
function quadratic(a: number, b: number, c: number): number[] {
  if (Math.abs(a) < 1e-16) return Math.abs(b) < 1e-16 ? [] : [-c / b];
  const disc = b * b - 4 * a * c;
  if (disc < -1e-13 * (b * b + Math.abs(4 * a * c) + 1)) return [];
  const v = -0.5 * (b + (b >= 0 ? 1 : -1) * Math.sqrt(Math.max(0, disc)));
  return v === 0 ? [0] : [v / a, c / v];
}
// Isolate all real roots of a low-degree polynomial on a bounded interval.
// Derivative roots partition it into monotone intervals and expose tangent roots.
function roots(coeff: number[], lo = -1, hi = 1): number[] {
  const scale = Math.max(...coeff.map(Math.abs));
  if (!scale) return [];
  const c = coeff.map((v) => v / scale);
  while (c.length > 1 && Math.abs(c.at(-1)!) < 1e-15) c.pop();
  if (c.length < 2) return [];
  if (c.length === 2) {
    const x = -c[0] / c[1];
    return x >= lo - eps && x <= hi + eps
      ? [Math.min(hi, Math.max(lo, x))]
      : [];
  }
  const f = (x: number) => c.reduceRight((v, k) => v * x + k, 0);
  const nodes = [
    lo,
    ...roots(
      c.slice(1).map((k, i) => k * (i + 1)),
      lo,
      hi,
    ),
    hi,
  ];
  const out = nodes.filter((x) => Math.abs(f(x)) < 1e-12);
  for (let i = 1; i < nodes.length; i++) {
    let l = nodes[i - 1],
      h = nodes[i],
      fl = f(l);
    if (fl * f(h) >= 0) continue;
    for (let j = 0; j < 54; j++) {
      const m = (l + h) / 2;
      if (fl * f(m) <= 0) h = m;
      else {
        l = m;
        fl = f(m);
      }
    }
    out.push((l + h) / 2);
  }
  return out;
}
function multiply(a: number[], b: number[]) {
  const out = Array(a.length + b.length - 1).fill(0);
  a.forEach((v, i) => b.forEach((w, j) => (out[i + j] += v * w)));
  return out;
}
function analytic(p: Parameters, o: Operation): Point | null {
  const I = p.imax,
    a = p.psi,
    b = ((p.ld - p.lq) * I) / 1000,
    t = o.torque / (1.5 * p.poles * I),
    w = omega(p, o.rpm);
  const D = (p.ld * I) / 1000,
    Q = (p.lq * I) / 1000,
    V = limit(p);
  const check: Point[] = [];
  function add(d: number, q: number) {
    const x = point(p, o.rpm, d * I, q * I);
    if (
      x &&
      feasible(p, x) &&
      Math.abs(x.torque - o.torque) < 1e-6 * (1 + Math.abs(o.torque))
    )
      check.push(x);
  }
  if (t === 0) {
    add(0, 0);
    if (w !== 0) {
      for (const s of [-1, 1]) add(((s * V) / Math.abs(w) - a) / D, 0);
    }
    if (b !== 0) add(-a / b, 0);
  } else {
    const square = multiply([a, b], [a, b]);
    const stationary = multiply([0, 1], multiply(square, [a, b]));
    stationary[0] -= b * t * t;
    const current = multiply([-1, 0, 1], square);
    current[0] += t * t;
    const voltage = multiply(
      [w * w * a * a - V * V, 2 * w * w * a * D, w * w * D * D],
      square,
    );
    voltage[0] += (w * Q * t) ** 2;
    for (const x of [
      0,
      -1,
      1,
      ...roots(stationary),
      ...roots(current),
      ...roots(voltage),
    ])
      if (a + b * x !== 0) add(x, t / (a + b * x));
  }
  return check.sort((x, y) => x.current - y.current)[0] ?? null;
}
interface Slice {
  best: Point | null;
  edge: Point | null;
}
// At fixed id, each bilinear flux cell is affine in iq. Torque and
// squared voltage are quadratic, so each vertical section is solved exactly.
function section(
  p: Parameters,
  o: Operation,
  d: number,
  needEdge: boolean,
): Slice {
  const span = Math.sqrt(Math.max(0, (p.imax - d) * (p.imax + d))),
    m = p.model === "map" ? p.map : null;
  const lo = Math.max(-span, m?.q[0] ?? -Infinity),
    hi = Math.min(span, m?.q.at(-1) ?? Infinity);
  let bestQ = NaN,
    edgeQ = NaN,
    edgeTorque = -Infinity;
  if (lo > hi) return { best: null, edge: null };
  const k = 1.5 * p.poles,
    w = omega(p, o.rpm),
    r = resistance(p),
    V = limit(p),
    dir = o.torque < 0 ? -1 : 1;
  const start = m ? cell(m.q, lo) : 0,
    end = m ? cell(m.q, hi) : 0;
  const i = m ? cell(m.d, d) : 0,
    x = m ? (d - m.d[i]) / (m.d[i + 1] - m.d[i]) : 0;
  for (let j = start; j <= end; j++) {
    let l = m ? Math.max(lo, m.q[j]) : lo,
      h = m ? Math.min(hi, m.q[j + 1]) : hi;
    let ad = p.psi + (p.ld * d) / 1000,
      bd = 0,
      aq = 0,
      bq = p.lq / 1000;
    if (m) {
      const dy = m.q[j + 1] - m.q[j];
      const v = (f: number[][], s: number) =>
        (1 - x) * f[i][s] + x * f[i + 1][s];
      bd = (v(m.fd, j + 1) - v(m.fd, j)) / dy;
      bq = (v(m.fq, j + 1) - v(m.fq, j)) / dy;
      ad = v(m.fd, j) - bd * m.q[j];
      aq = v(m.fq, j) - bq * m.q[j];
    }
    const a = k * bd,
      b = k * (ad - bq * d),
      c = -k * aq * d;
    if (!needEdge) {
      const left = (a * l + b) * l + c,
        right = (a * h + b) * h + c;
      const vertex = a !== 0 ? -b / (2 * a) : NaN;
      const middle =
        vertex > l && vertex < h ? (a * vertex + b) * vertex + c : left;
      if (
        o.torque < Math.min(left, right, middle) - eps ||
        o.torque > Math.max(left, right, middle) + eps
      )
        continue;
    }
    const ud0 = r * d - w * aq,
      ud1 = -w * bq,
      uq0 = w * ad,
      uq1 = r + w * bd;
    const A = ud1 * ud1 + uq1 * uq1,
      B = 2 * (ud0 * ud1 + uq0 * uq1),
      C = ud0 * ud0 + uq0 * uq0 - V * V;
    if (A > 1e-24) {
      const z = quadratic(A, B, C).sort((a, b) => a - b);
      if (!z.length) continue;
      l = Math.max(l, z[0]);
      h = Math.min(h, z.at(-1)!);
    } else if (C > eps) continue;
    if (l > h + eps) continue;
    const z = quadratic(a, b, c - o.torque);
    if (Math.abs(a) + Math.abs(b) < 1e-14 && Math.abs(c - o.torque) < eps)
      z.push(Math.min(h, Math.max(l, 0)));
    for (const q of z) {
      if (q < l - eps || q > h + eps) continue;
      if (!Number.isFinite(bestQ) || Math.abs(q) < Math.abs(bestQ))
        bestQ = Math.max(lo, Math.min(hi, q));
    }
    if (!needEdge) continue;
    for (const q of [l, h, ...(a !== 0 ? [-b / (2 * a)] : [])]) {
      if (q < l - eps || q > h + eps) continue;
      const t = dir * ((a * q + b) * q + c);
      if (t > edgeTorque) {
        edgeTorque = t;
        edgeQ = Math.max(lo, Math.min(hi, q));
      }
    }
  }
  const best = Number.isFinite(bestQ) ? point(p, o.rpm, d, bestQ) : null,
    edge = Number.isFinite(edgeQ) ? point(p, o.rpm, d, edgeQ) : null;
  return {
    best:
      best &&
      feasible(p, best) &&
      Math.abs(best.torque - o.torque) < 1e-6 * (1 + Math.abs(o.torque))
        ? best
        : null,
    edge: edge && feasible(p, edge) ? edge : null,
  };
}
// Minimizing squared voltage over the current disk supplies a feasible section
// even when the voltage ellipse only touches the disk between two grid nodes.
function minimumVoltageD(p: Parameters, rpm: number) {
  const w = omega(p, rpm),
    r = resistance(p),
    D = (w * p.ld) / 1000,
    Q = (w * p.lq) / 1000,
    e = w * p.psi;
  if (w === 0) return 0;
  const A = r * r + D * D,
    B = r * (D - Q),
    C = r * r + Q * Q;
  function candidate(lambda: number) {
    const det = (r * r + D * Q) ** 2 + lambda * (A + C + lambda);
    return {
      d: (-(C + lambda) * D * e + B * r * e) / det,
      q: (B * D * e - (A + lambda) * r * e) / det,
    };
  }
  const free = candidate(0);
  if (Math.hypot(free.d, free.q) <= p.imax) return free.d;
  let lo = 0,
    hi = Math.max(1, Math.hypot(D * e, r * e) / p.imax);
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2,
      x = candidate(mid);
    if (Math.hypot(x.d, x.q) > p.imax) lo = mid;
    else hi = mid;
  }
  return candidate(hi).d;
}
// Reject a target only when conservative interval bounds exclude it in
// every relevant cell. An exhausted subdivision budget means "unresolved".
function excludedTarget(p: Parameters, o: Operation) {
  const m = p.model === "map" ? p.map : null,
    I = p.imax,
    V = limit(p),
    w = omega(p, o.rpm),
    r = resistance(p),
    k = 1.5 * p.poles;
  const dAxis = m?.d ?? [-I, I],
    qAxis = m?.q ?? [-I, I];
  let budget = 60000;
  const distance = (lo: number, hi: number) => (lo > 0 ? lo : hi < 0 ? -hi : 0);
  function excluded(
    d0: number,
    d1: number,
    q0: number,
    q1: number,
    depth: number,
  ): boolean {
    if (--budget < 0) return false;
    if (Math.hypot(distance(d0, d1), distance(q0, q1)) > I + eps) return true;
    const fd: number[] = [],
      fq: number[] = [],
      ud: number[] = [],
      uq: number[] = [];
    for (const d of [d0, d1])
      for (const q of [q0, q1]) {
        const f = flux(p, d, q);
        if (!f) return false;
        fd.push(f[0]);
        fq.push(f[1]);
        ud.push(r * d - w * f[1]);
        uq.push(r * q + w * f[0]);
      }
    if (
      Math.hypot(
        distance(Math.min(...ud), Math.max(...ud)),
        distance(Math.min(...uq), Math.max(...uq)),
      ) >
      V + eps
    )
      return true;
    const products = (f: number[], lo: number, hi: number) => [
      Math.min(...f) * lo,
      Math.min(...f) * hi,
      Math.max(...f) * lo,
      Math.max(...f) * hi,
    ];
    const a = products(fd, q0, q1),
      b = products(fq, d0, d1),
      lower = k * (Math.min(...a) - Math.max(...b)),
      upper = k * (Math.max(...a) - Math.min(...b));
    if (o.torque < lower - eps || o.torque > upper + eps) return true;
    if (depth >= 16) return false;
    if (d1 - d0 > q1 - q0) {
      const mid = (d0 + d1) / 2;
      return (
        excluded(d0, mid, q0, q1, depth + 1) &&
        excluded(mid, d1, q0, q1, depth + 1)
      );
    }
    const mid = (q0 + q1) / 2;
    return (
      excluded(d0, d1, q0, mid, depth + 1) &&
      excluded(d0, d1, mid, q1, depth + 1)
    );
  }
  for (let i = 1; i < dAxis.length; i++)
    for (let j = 1; j < qAxis.length; j++) {
      const d0 = Math.max(dAxis[i - 1], -I),
        d1 = Math.min(dAxis[i], I),
        q0 = Math.max(qAxis[j - 1], -I),
        q1 = Math.min(qAxis[j], I);
      if (d0 <= d1 && q0 <= q1 && !excluded(d0, d1, q0, q1, 0)) return false;
    }
  return true;
}
function numerical(p: Parameters, o: Operation): Result {
  const m = p.model === "map" ? p.map : null,
    dir = o.torque < 0 ? -1 : 1;
  const low = Math.max(-p.imax, m?.d[0] ?? -Infinity),
    high = Math.min(p.imax, m?.d.at(-1) ?? Infinity);
  let best: Point | null = null,
    edge: Point | null = null;
  let needEdge = false;
  const inspect = (d: number) => {
    const s = section(p, o, d, needEdge);
    if (s.best && (!best || s.best.current < best.current)) best = s.best;
    if (s.edge && (!edge || dir * s.edge.torque > dir * edge.torque))
      edge = s.edge;
    return s;
  };
  const score = (s: Slice, kind: "best" | "edge") =>
    kind === "best"
      ? (s.best?.current ?? Infinity)
      : s.edge
        ? -dir * s.edge.torque
        : Infinity;
  const knots = [low, ...(m?.d ?? []).filter((d) => d > low && d < high), high];
  const xs = new Set<number>();
  if (low <= high)
    for (let j = 1; j < knots.length; j++) {
      const l = knots[j - 1],
        h = knots[j],
        n = Math.max(m ? 4 : 1, Math.ceil(((h - l) / p.imax) * 96));
      for (let i = 0; i < n; i++) xs.add(l + ((h - l) * i) / n);
      xs.add(h);
    }
  if (!m) xs.add(Math.max(low, Math.min(high, minimumVoltageD(p, o.rpm))));
  const grid = Array.from(xs).sort((a, b) => a - b);
  const refine = (l: number, h: number, kind: "best" | "edge") => {
    for (let j = 0; j < 32; j++) {
      const a = (2 * l + h) / 3,
        b = (l + 2 * h) / 3;
      if (score(inspect(a), kind) <= score(inspect(b), kind)) h = b;
      else l = a;
    }
    inspect((l + h) / 2);
  };
  for (const kind of ["best", "edge"] as const) {
    if (kind === "edge" && best) break;
    needEdge = kind === "edge";
    const scores = grid.map((d) => score(inspect(d), kind));
    for (let i = 0; i < grid.length; i++)
      if (Number.isFinite(scores[i])) {
        const left = scores[i - 1] ?? Infinity,
          right = scores[i + 1] ?? Infinity;
        if (
          scores[i] <= left &&
          scores[i] <= right &&
          (scores[i] < left || scores[i] < right)
        )
          refine(
            grid[Math.max(0, i - 1)],
            grid[Math.min(grid.length - 1, i + 1)],
            kind,
          );
        for (const j of [i - 1, i + 1])
          if (j >= 0 && j < grid.length && !Number.isFinite(scores[j])) {
            let a = grid[i],
              b = grid[j];
            for (let k = 0; k < 30; k++) {
              const mid = (a + b) / 2;
              if (Number.isFinite(score(inspect(mid), kind))) a = mid;
              else b = mid;
            }
          }
      }
  }
  const b = best as Point | null,
    e = edge as Point | null;
  const partial =
    m &&
    (m.d[0] > -p.imax ||
      m.q[0] > -p.imax ||
      m.d.at(-1)! < p.imax ||
      m.q.at(-1)! < p.imax);
  if (b) return { point: b, status: "ok", method: "数值法" };
  if (e && Math.abs(e.torque - o.torque) < 1e-7 * (1 + Math.abs(o.torque)))
    return { point: e, status: "ok", method: "数值法" };
  const status = partial
    ? "coverage"
    : e
      ? dir * e.torque < dir * o.torque && excludedTarget(p, o)
        ? "unreachable"
        : "unresolved"
      : m
        ? "unresolved"
        : "empty";
  return { point: e, status, method: "数值法" };
}
export function solve(p: Parameters, o: Operation): Result {
  if (o.mode === "manual") {
    const x = point(p, o.rpm, o.id, o.iq);
    return {
      point: x,
      status: !x ? "outside" : feasible(p, x) ? "ok" : "over",
      method: "直接计算",
    };
  }
  if (p.model === "ideal" && p.solver === "analytic") {
    const x = analytic(p, o);
    if (x) return { point: x, status: "ok", method: "解析法" };
    const r = numerical(p, o);
    return { ...r, method: r.point ? "数值边界" : "数值复核" };
  }
  return numerical(p, o);
}
export const statusText: Record<Status, string> = {
  ok: "可行运行点",
  over: "超出约束",
  unreachable: "目标不可达",
  outside: "超出磁链图",
  coverage: "磁链覆盖不足",
  empty: "无可行运行点",
  unresolved: "数值结果未确定",
};
