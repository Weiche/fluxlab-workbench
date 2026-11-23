import test from "node:test";
import assert from "node:assert/strict";
import {
  defaults,
  initial,
  solve,
  point,
  limit,
  resistance,
  omega,
} from "../src/model.ts";
import { readMap, readBatch, readProject } from "../src/files.ts";
import { voltageComponents } from "../src/voltage.ts";
const close = (a, b, e = 1e-5) =>
  assert.ok(Math.abs(a - b) <= e, `${a} != ${b}`);
const run = (p = {}, op = {}) =>
  solve({ ...defaults, ...p }, { ...initial, ...op });
test("surface PMSM uses iq = T / (1.5 p ψ), id = 0 at base speed", () => {
  const r = run({ ld: 0.9 }, { rpm: 450 });
  assert.equal(r.status, "ok");
  close(r.point.d, 0);
  close(r.point.q, 48 / (6 * 0.09));
});
test("independent solvers agree over saliency, speed sign, field weakening and regeneration", () => {
  for (const rpm of [-5000, -3000, 0, 3000, 5000])
    for (const torque of [-36, 0, 36])
      for (const ld of [0.45, 0.9, 1.2]) {
        const a = run({ ld }, { rpm, torque }),
          b = run({ ld, solver: "numeric" }, { rpm, torque });
        assert.equal(b.status, a.status);
        if (a.status === "ok") {
          close(a.point.current, b.point.current, 0.12);
          close(a.point.torque, torque, 0.001);
          close(b.point.torque, torque, 0.001);
        }
      }
});
test("zero torque at high speed needs negative d current", () => {
  const r = run({}, { rpm: 6000, torque: 0 });
  assert.equal(r.status, "ok");
  assert.ok(r.point.d < -1);
  close(r.point.q, 0);
  close(r.point.vm, 0, 0.00001);
});
test("capacity boundary retains feasible point at both active constraints", () => {
  const r = run({}, { rpm: 5000, torque: 1000 });
  assert.equal(r.status, "unreachable");
  close(r.point.im, 0, 0.001);
  close(r.point.vm, 0, 0.001);
  assert.ok(r.point.torque < 1000);
  const edge = run({}, { rpm: 5000, torque: r.point.torque });
  assert.equal(edge.status, "ok");
});
test("zero speed, zero target gives origin; impossible high-speed section is empty", () => {
  close(run({}, { rpm: 0, torque: 0 }).point.current, 0);
  assert.equal(run({ imax: 10 }, { rpm: 8000, torque: 1 }).status, "empty");
});
test("manual overshoots stay intact and engineering corrections are consistent", () => {
  const p = { ...defaults, model: "engineering", useTemp: true, useK: true };
  const x = run(p, { mode: "manual", id: -20, iq: 165 }).point;
  assert.equal(x.q, 165);
  assert.ok(x.im < 0);
  close(x.ud, x.rd + x.ed);
  close(x.uq, x.rq + x.eq);
  close(x.ed, (-omega(p, 3000) * p.lq * x.q) / 1000);
  close(resistance(p), p.rs * (1 + 0.00393 * 60));
  close(limit(p), (260 * 0.95) / Math.sqrt(3));
  close(limit({ ...p, direct: true, vmax: 80 }), 80);
});
const mapText = (axis = [-140, -75, 0, 65, 140]) =>
  "id_A,iq_A,psi_d_Wb,psi_q_Wb\n" +
  axis
    .flatMap((d) =>
      axis.map((q) => [d, q, 0.09 + 0.00045 * d, 0.0009 * q].join(",")),
    )
    .join("\n");
test("non-uniform map reproduces constant machine, no extrapolation", () => {
  const p = { model: "map", map: readMap(mapText()), useR: false };
  for (const rpm of [-3400, 0, 4900]) {
    const r = run(p, { rpm }),
      a = run({}, { rpm });
    assert.equal(r.status, a.status);
    close(r.point.current, a.point.current, 0.12);
    close(r.point.voltage, a.point.voltage, 0.02);
  }
  assert.equal(run(p, { mode: "manual", id: 150 }).status, "outside");
  assert.equal(
    run({ ...p, map: readMap(mapText([-15, 0, 15])) }).status,
    "coverage",
  );
});
test("partial map does not invent flux", () =>
  assert.equal(point({ ...defaults, model: "map", map: null }, 0, 0, 0), null));
test("import rejects duplicate cells, missing nodes, NaN and malformed header", () => {
  for (const text of [
    mapText() + "\n0,0,1,1",
    mapText().replace("0,0,0.09,0\n", ""),
    mapText().replace("0.09,0", "NaN,0"),
    "x,y\n1,2",
  ])
    assert.throws(() => readMap(text));
});
test("batch preserves rows and invalid entries", () => {
  const r = readBatch(
    "mode,rpm,torque_Nm,id_A,iq_A\nauto,3000,48,,\nmanual,0,,0,-30\nauto,1500,,,\nauto,-2000,-20,,",
  );
  assert.equal(r.length, 4);
  assert.equal(r[2].op, null);
  assert.match(r[2].error, /torque_Nm/);
  assert.equal(r[3].line, 5);
  assert.equal(r[3].op.torque, -20);
});
test("project round trip validates stored model, settings and imported map", () => {
  const v = {
    version: 1,
    name: "试验",
    p: { ...defaults, map: readMap(mapText()), model: "map" },
    o: initial,
    rows: [],
    mapName: "磁链.csv",
  };
  assert.deepEqual(readProject(JSON.stringify(v)).p, v.p);
  assert.throws(() =>
    readProject(JSON.stringify({ ...v, p: { ...v.p, poles: 0 } })),
  );
});
test("nonlinear flux data changes the voltage contour and matches requested torque", () => {
  const axis = [-150, -75, 0, 75, 150];
  const map = readMap(
    "id_A,iq_A,psi_d_Wb,psi_q_Wb\n" +
      axis
        .flatMap((d) =>
          axis.map((q) =>
            [
              d,
              q,
              0.09 + (0.00045 * d) / (1 + (q * q) / 2e5),
              (0.0009 * q) / (1 + (q * q) / 8e4 + (d * d) / 3e5),
            ].join(","),
          ),
        )
        .join("\n"),
  );
  const p = { ...defaults, map, model: "map", useR: false },
    x = run(p, { torque: 40 });
  assert.equal(x.status, "ok");
  close(x.point.torque, 40);
  const ref = point(defaults, 3200, -75, 75),
    sat = point(p, 3200, -75, 75);
  assert.ok(Math.abs(ref.voltage - sat.voltage) > 1);
  assert.equal(run(p, { torque: 500 }).status, "unreachable");
});

test("constant-parameter voltage vectors sum with signed speed and current", () => {
  for (const model of ["ideal", "engineering"]) {
    const p = { ...defaults, model, useTemp: true };
    for (const rpm of [3000, 0, -3000]) {
      const x = point(p, rpm, -40, 70);
      const [drop, magnet, qCurrent, dCurrent] = voltageComponents(p, rpm, x);
      const w = omega(p, rpm);
      close(drop.ud, resistance(p) * x.d);
      close(drop.uq, resistance(p) * x.q);
      close(magnet.uq, w * p.psi);
      close(qCurrent.ud, (-w * p.lq * x.q) / 1000);
      close(dCurrent.uq, (w * p.ld * x.d) / 1000);
      close(drop.ud + qCurrent.ud, x.ud);
      close(drop.uq + magnet.uq + dCurrent.uq, x.uq);
    }
  }
});

test("flux-map voltage decomposition uses both total flux axes", () => {
  const p = {
    ...defaults,
    model: "map",
    map: readMap(
      "id_A,iq_A,psi_d_Wb,psi_q_Wb\n4,-8,0.14,-0.025\n4,8,0.12,0.018\n20,-8,0.16,-0.028\n20,8,0.15,0.020",
    ),
  };
  const rpm = -2400,
    x = point(p, rpm, 10, -5);
  const [drop, qFlux, dFlux] = voltageComponents(p, rpm, x);
  assert.equal(qFlux.symbol, "−ωₑψq");
  assert.equal(dFlux.symbol, "ωₑψd");
  close(drop.ud + qFlux.ud, x.ud);
  close(drop.uq + dFlux.uq, x.uq);
  assert.ok(
    voltageComponents(p, rpm, null).every(
      ({ ud, uq }) => ud === undefined && uq === undefined,
    ),
  );
});
