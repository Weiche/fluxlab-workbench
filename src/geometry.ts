import { flux, resistance, omega, limit, type Parameters } from "./model.ts";
import { mtpvTrajectory, type Mtpv } from "./mtpv.ts";
export interface Geometry {
  extent: number;
  xExtent: number;
  width: number;
  height: number;
  mask: Uint8Array;
  voltage: number[];
  torque: number[];
  mtpv: Mtpv | null;
}
function contour(
  field: Float64Array,
  level: number,
  width: number,
  height: number,
  xExtent: number,
  extent: number,
) {
  const lines: number[] = [],
    stride = width + 1,
    dx = (2 * xExtent) / width,
    dy = (2 * extent) / height;
  for (let j = 0; j < height; j++)
    for (let i = 0; i < width; i++) {
      const k = j * stride + i,
        a = field[k] - level,
        b = field[k + 1] - level,
        c = field[k + stride + 1] - level,
        d = field[k + stride] - level;
      if (
        !Number.isFinite(a + b + c + d) ||
        Math.min(a, b, c, d) > 0 ||
        Math.max(a, b, c, d) < 0
      )
        continue;
      const x = i * dx - xExtent,
        y = extent - j * dy;
      if (a >= 0 !== b >= 0) lines.push(x + (dx * a) / (a - b), y);
      if (b >= 0 !== c >= 0) lines.push(x + dx, y - (dy * b) / (b - c));
      if (c >= 0 !== d >= 0) lines.push(x + dx - (dx * c) / (c - d), y - dy);
      if (d >= 0 !== a >= 0) lines.push(x, y - dy + (dy * d) / (d - a));
    }
  return lines;
}
function fields(p: Parameters, extent: number, ratio: number, height: number) {
  const width = Math.ceil(height * ratio),
    xExtent = extent * ratio,
    count = (width + 1) * (height + 1);
  const torque = new Float64Array(count),
    fd = new Float64Array(count),
    fq = new Float64Array(count);
  for (let j = 0; j <= height; j++)
    for (let i = 0; i <= width; i++) {
      const d = xExtent * ((2 * i) / width - 1),
        q = extent * (1 - (2 * j) / height),
        k = j * (width + 1) + i,
        f = flux(p, d, q);
      fd[k] = f?.[0] ?? NaN;
      fq[k] = f?.[1] ?? NaN;
      torque[k] = 1.5 * p.poles * (fd[k] * q - fq[k] * d);
    }
  return {
    p,
    extent,
    ratio,
    height,
    width,
    xExtent,
    torque,
    fd,
    fq,
    rpm: NaN,
    resistance: NaN,
    voltageLimit: NaN,
    currentLimit: NaN,
    voltageField: new Float64Array(count),
    voltage: [] as number[],
    mtpv: null as Mtpv | null,
    mask: new Uint8Array(height * width),
  };
}
let cached: ReturnType<typeof fields> | undefined;
export function geometry(
  p: Parameters,
  rpm: number,
  target: number,
  extent: number,
  ratio = 1,
  resolution = 136,
): Geometry {
  if (
    !cached ||
    cached.p.model !== p.model ||
    cached.p.map !== p.map ||
    cached.p.poles !== p.poles ||
    cached.p.ld !== p.ld ||
    cached.p.lq !== p.lq ||
    cached.p.psi !== p.psi ||
    cached.extent !== extent ||
    cached.ratio !== ratio ||
    cached.height !== resolution
  )
    cached = fields(p, extent, ratio, resolution);
  const g = cached,
    { width, height, xExtent } = g;
  const r = resistance(p);
  const V = limit(p);
  if (
    g.rpm !== rpm ||
    g.resistance !== r ||
    g.voltageLimit !== V ||
    g.currentLimit !== p.imax
  ) {
    const voltage = g.voltageField;
    const w = omega(p, rpm);
    for (let j = 0; j <= height; j++)
      for (let i = 0; i <= width; i++) {
        const k = j * (width + 1) + i,
          d = xExtent * ((2 * i) / width - 1),
          q = extent * (1 - (2 * j) / height);
        voltage[k] = V - Math.hypot(r * d - w * g.fq[k], r * q + w * g.fd[k]);
      }
    for (let j = 0; j < height; j++)
      for (let i = 0; i < width; i++) {
        const k = j * (width + 1) + i,
          d = xExtent * ((2 * i + 1) / width - 1),
          q = extent * (1 - (2 * j + 1) / height);
        const mean =
          (voltage[k] +
            voltage[k + 1] +
            voltage[k + width + 1] +
            voltage[k + width + 2]) /
          4;
        g.mask[j * width + i] = !Number.isFinite(mean)
          ? 2
          : mean >= 0 && d * d + q * q <= p.imax * p.imax
            ? 1
            : 0;
      }
    g.voltage = contour(voltage, 0, width, height, xExtent, extent);
    g.mtpv = mtpvTrajectory(p, rpm, xExtent, extent);
    g.rpm = rpm;
    g.resistance = r;
    g.voltageLimit = V;
    g.currentLimit = p.imax;
  }
  return {
    extent,
    xExtent,
    width,
    height,
    mask: g.mask,
    voltage: g.voltage,
    mtpv: g.mtpv,
    torque: contour(g.torque, target, width, height, xExtent, extent),
  };
}
