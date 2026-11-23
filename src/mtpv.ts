import { limit, omega, point, resistance, type Parameters } from "./model.ts";

interface Current {
  d: number;
  q: number;
}

export interface Mtpv {
  positive: Current[];
  negative: Current[];
  atLimit: { positive: Current; negative: Current };
}

const directions = Array.from({ length: 48 }, (_, index) => {
  const angle = index * (Math.PI / 24);
  return { angle, d: Math.cos(angle), q: Math.sin(angle) };
});

// The inverse of the steady-state voltage equations maps each voltage circle
// to an ellipse in the current plane. The constant-parameter torque has no
// strict interior maximum or minimum, so both optima lie on the ellipse.
function voltageOptimum(p: Parameters, rpm: number) {
  const w = omega(p, rpm);
  const r = resistance(p);
  const dReactance = (w * p.ld) / 1000;
  const qReactance = (w * p.lq) / 1000;
  const backEmf = w * p.psi;
  const determinant = r * r + dReactance * qReactance;
  const saliency = (p.ld - p.lq) / 1000;
  const currentAt = (vd: number, vq: number): Current => ({
    d: (r * vd + qReactance * (vq - backEmf)) / determinant,
    q: (-dReactance * vd + r * (vq - backEmf)) / determinant,
  });

  return (voltage: number) => {
    const score = (vd: number, vq: number) => {
      const { d, q } = currentAt(voltage * vd, voltage * vq);
      return q * (p.psi + saliency * d);
    };
    const samples = directions.map(({ d, q }) => score(d, q));
    const step = Math.PI / 24;
    const scoreAt = (angle: number) => score(Math.cos(angle), Math.sin(angle));

    function extremum(sign: 1 | -1) {
      let best = -Infinity;
      let bestAngle = 0;
      for (const [index, value] of samples.entries()) {
        const left = samples[(index + samples.length - 1) % samples.length];
        const right = samples[(index + 1) % samples.length];
        if (
          sign * value < Math.max(sign * left, sign * right) ||
          (value === left && value === right)
        )
          continue;
        let lo = directions[index].angle - step;
        let hi = directions[index].angle + step;
        for (let step = 0; step < 32; step++) {
          const a = (2 * lo + hi) / 3;
          const b = (lo + 2 * hi) / 3;
          if (sign * scoreAt(a) < sign * scoreAt(b)) lo = a;
          else hi = b;
        }
        const angle = (lo + hi) / 2;
        const valueAtAngle = sign * scoreAt(angle);
        if (valueAtAngle > best) {
          best = valueAtAngle;
          bestAngle = angle;
        }
      }
      return currentAt(
        voltage * Math.cos(bestAngle),
        voltage * Math.sin(bestAngle),
      );
    }

    return { positive: extremum(1), negative: extremum(-1) };
  };
}

export function mtpvTrajectory(
  p: Parameters,
  rpm: number,
  dExtent: number,
  qExtent: number,
): Mtpv | null {
  if (p.model === "map" || rpm === 0) return null;
  const optimum = voltageOptimum(p, rpm);
  const voltageLimit = limit(p);
  // An affine voltage vector has its largest norm on the chart rectangle at a corner.
  const voltageExtent = Math.max(
    voltageLimit,
    ...[-dExtent, dExtent].flatMap((d) =>
      [-qExtent, qExtent].map((q) => point(p, rpm, d, q)!.voltage),
    ),
  );
  const positive: Current[] = [];
  const negative: Current[] = [];
  const steps = 96;
  const radii = Array.from(
    { length: steps + 1 },
    (_, i) => (voltageExtent * i) / steps,
  );
  radii.push(voltageLimit);
  radii.sort((a, b) => a - b);
  for (const radius of radii) {
    const pair = optimum(radius);
    positive.push(pair.positive);
    negative.push(pair.negative);
  }
  const boundary = optimum(voltageLimit);
  return {
    positive,
    negative,
    atLimit: boundary,
  };
}
