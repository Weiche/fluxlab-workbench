import {
  flux,
  hasFeasibleCurrent,
  limit,
  omega,
  torqueExtremum,
  type Parameters,
} from "./model.ts";
import { bounds } from "./files.ts";
import { math, mathCanvasLayout } from "./notation.ts";

export interface TorqueSample {
  rpm: number;
  upper: number | null;
  lower: number | null;
}

export interface TorqueEnvelope {
  samples: TorqueSample[];
  partial: boolean;
}

export interface SpeedRangeEstimate {
  span: number;
  edges: number[];
  foundLimit: boolean;
  forwardLimit: number | null;
}

export const speedAxis = { left: 58, right: 34 };
export const envelopeColor = "#267d9b";
const rpmLimit = bounds.rpm[1];

export function speedSpan(p: Parameters, rpm: number, requested?: number) {
  const noLoadFlux = flux(p, 0, 0);
  const emfPerRpm =
    Math.abs(omega(p, 1)) *
    ((noLoadFlux && Math.hypot(...noLoadFlux)) || p.psi);
  const suggested =
    requested ??
    (emfPerRpm > 0
      ? (2.5 * limit(p)) / emfPerRpm
      : Math.max(1000, 2 * Math.abs(rpm)));
  const extent = Math.max(1, suggested, Math.abs(rpm));
  const step = Math.max(1, 10 ** (Math.floor(Math.log10(extent)) - 1));
  return Math.min(
    rpmLimit,
    extent === requested ? requested : Math.ceil(extent / step) * step,
  );
}

export function estimateSpeedRange(p: Parameters): SpeedRangeEstimate {
  const seed = speedSpan(p, 0);
  const mapped = p.model === "map";
  // With zero flux achievable inside the current disk, the constant-parameter
  // model has no finite electrical speed ceiling.
  if ((!mapped && p.psi <= (p.ld * p.imax) / 1000) || !hasFeasibleCurrent(p, 0))
    return { span: seed, edges: [], foundLimit: false, forwardLimit: null };

  function edge(direction: number): number | null {
    let low = 0;
    let high = seed;
    while (hasFeasibleCurrent(p, direction * high)) {
      if (high === rpmLimit) return null;
      low = high;
      high = Math.min(rpmLimit, 2 * high);
    }
    while (high - low > 1) {
      const mid = (low + high) / 2;
      if (hasFeasibleCurrent(p, direction * mid)) low = mid;
      else high = mid;
    }
    return low;
  }

  const forward = edge(1);
  const reverse = mapped ? edge(-1) : forward;
  const foundLimit = forward !== null && reverse !== null;
  const edges = [
    ...(reverse === null ? [] : [-reverse]),
    ...(forward === null ? [] : [forward]),
  ];
  const end = 1.05 * Math.max(...edges.map(Math.abs), 0);
  const span = speedSpan(p, Math.max(end, foundLimit ? 0 : seed), 1);
  return { span, edges, foundLimit, forwardLimit: forward };
}

export function torqueEnvelope(
  p: Parameters,
  span: number,
  edges: number[] = [],
): TorqueEnvelope {
  const samples: TorqueSample[] = [];
  let partial = false;
  const count = 40;
  const speeds = new Set(edges.filter((rpm) => Math.abs(rpm) <= span));
  for (let i = -count; i <= count; i++)
    speeds.add(Math.sign(i) * span * (i / count) ** 2);
  for (const rpm of [...speeds].sort((a, b) => a - b)) {
    const upper = torqueExtremum(p, rpm, 1);
    const lower = torqueExtremum(p, rpm, -1);
    partial ||= upper.status === "coverage" || lower.status === "coverage";
    samples.push({
      rpm,
      upper: upper.point?.torque ?? null,
      lower: lower.point?.torque ?? null,
    });
  }
  return { samples, partial };
}

const speedBackgrounds = new WeakMap<
  HTMLCanvasElement,
  {
    layer: HTMLCanvasElement;
    key: string;
    envelope: TorqueEnvelope | null;
    rpm?: number;
    torque?: number;
  }
>();

export function drawSpeedChart(
  canvas: HTMLCanvasElement,
  span: number,
  rpm: number,
  torque: number | undefined,
  envelope: TorqueEnvelope | null,
  showNegative: boolean,
) {
  const width = canvas.clientWidth,
    height = canvas.clientHeight;
  if (width < 100 || height < 60) return;
  const dpr = devicePixelRatio || 1;
  const pixelWidth = Math.round(width * dpr),
    pixelHeight = Math.round(height * dpr);
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  const left = speedAxis.left,
    right = width - speedAxis.right;
  const top = 25,
    bottom = height - 25;
  const samples = envelope?.samples ?? [];
  const limitTorque = Math.max(
    1,
    showNegative ? Math.abs(torque ?? 0) : (torque ?? 0),
    ...samples.map(({ upper, lower }) =>
      showNegative ? Math.max(upper ?? 0, -(lower ?? 0)) : (upper ?? 0),
    ),
  );
  const tickCount = showNegative ? 2 : 4;
  const precision = 10 ** Math.floor(Math.log10(limitTorque / tickCount));
  const torqueStep =
    ([1, 2, 2.5, 5, 10].find((v) => v * precision >= limitTorque / tickCount) ??
      10) * precision;
  const torqueMax = (tickCount + 0.2) * torqueStep;
  const torqueMin = showNegative ? -torqueMax : 0;
  const X = (speed: number) => left + ((speed / span + 1) / 2) * (right - left);
  const Y = (t: number) =>
    top + ((torqueMax - t) / (torqueMax - torqueMin)) * (bottom - top);
  const key = [width, height, dpr, span, torqueStep, showNegative].join("/");
  let background = speedBackgrounds.get(canvas);
  if (
    background?.key === key &&
    background.envelope === envelope &&
    background.rpm === rpm &&
    background.torque === torque
  )
    return;
  const foreground = canvas.getContext("2d")!;
  foreground.setTransform(dpr, 0, 0, dpr, 0, 0);
  let ctx = foreground;

  const labelFont = '"Segoe UI","Microsoft YaHei",sans-serif';
  function line(x1: number, y1: number, x2: number, y2: number, color: string) {
    ctx.strokeStyle = color;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  }
  if (background?.key !== key || background.envelope !== envelope) {
    const layer = background?.layer ?? document.createElement("canvas");
    layer.width = pixelWidth;
    layer.height = pixelHeight;
    background = { layer, key, envelope };
    speedBackgrounds.set(canvas, background);
    ctx = layer.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = "11px " + labelFont;
    ctx.fillStyle = "#62748a";
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    ctx.lineWidth = 1;
    for (let i = showNegative ? -tickCount : 0; i <= tickCount; i++) {
      const t = i * torqueStep;
      line(left, Y(t), right, Y(t), i === 0 ? "#a9b8c9" : "#e2e8ef");
      ctx.fillText(String(+t.toPrecision(5)), left - 7, Y(t));
    }
    const halfTicks = width < 510 ? 1 : 2;
    ctx.textAlign = "center";
    for (let i = -halfTicks; i <= halfTicks; i++) {
      const speed = (span * i) / halfTicks;
      line(X(speed), top, X(speed), bottom, "#e2e8ef");
      ctx.fillText(
        speed.toLocaleString("en-US", { maximumFractionDigits: 1 }),
        X(speed),
        bottom + 11,
      );
    }
    line(left, top, left, bottom, "#a9b8c9");
    line(left, bottom, right, bottom, "#a9b8c9");
    ctx.textAlign = "left";
    for (const run of mathCanvasLayout(ctx, [...math.te, " (N·m)"], labelFont, 11)
      .runs) {
      ctx.font = run.fontSpec;
      ctx.fillText(run.text, left + run.x, 11 + run.y);
    }
    ctx.font = "11px " + labelFont;
    ctx.textAlign = "right";
    ctx.fillText("n (rpm)", right, 11);

    ctx.save();
    ctx.beginPath();
    ctx.rect(left, top, right - left, bottom - top);
    ctx.clip();
    ctx.beginPath();
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1],
        b = samples[i];
      if (
        a.upper === null ||
        a.lower === null ||
        b.upper === null ||
        b.lower === null
      )
        continue;
      ctx.moveTo(X(a.rpm), Y(a.upper));
      ctx.lineTo(X(b.rpm), Y(b.upper));
      ctx.lineTo(X(b.rpm), Y(b.lower));
      ctx.lineTo(X(a.rpm), Y(a.lower));
      ctx.closePath();
    }
    ctx.fillStyle = "rgba(38, 125, 155, 0.12)";
    ctx.fill();
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = envelopeColor;
    if (envelope?.partial) ctx.setLineDash([4, 3]);
    for (const bound of ["upper", "lower"] as const) {
      ctx.beginPath();
      let connected = false;
      for (const sample of samples) {
        const torque = sample[bound];
        if (torque === null) {
          connected = false;
        } else if (connected) {
          ctx.lineTo(X(sample.rpm), Y(torque));
        } else {
          ctx.moveTo(X(sample.rpm), Y(torque));
          connected = true;
        }
      }
      ctx.stroke();
    }
    ctx.restore();
  }
  background.rpm = rpm;
  background.torque = torque;
  ctx = foreground;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, pixelWidth, pixelHeight);
  ctx.drawImage(background.layer, 0, 0);
  ctx.restore();
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 3]);
  line(X(rpm), top, X(rpm), bottom, "#16796b");
  ctx.setLineDash([]);
  if (torque !== undefined && (showNegative || torque >= 0)) {
    ctx.beginPath();
    ctx.arc(X(rpm), Y(torque), 4.3, 0, 2 * Math.PI);
    ctx.fillStyle = "#16796b";
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.stroke();
  }
}
