import test from "node:test";
import assert from "node:assert/strict";
import { readProject } from "../src/files.ts";
import { defaults, initial, limit, omega, resistance, solve } from "../src/model.ts";
import { findMotorPreset, motorPresets } from "../src/motor-presets.ts";

const close = (actual, expected, tolerance = 1e-5) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} != ${expected}`);

test("catalog motors load a feasible example at each documented DC bus voltage", () => {
  assert.deepEqual(motorPresets.map((preset) => preset.parameters.vdc), [24, 24, 48, 320, 560, 830]);
  for (const { parameters, operation, name } of motorPresets) {
    const p = { ...defaults, ...parameters };
    const result = solve(p, { ...initial, ...operation });
    assert.equal(result.status, "ok", name);
    close(result.point.torque, operation.torque);
    assert.ok(result.point.current <= p.imax && result.point.voltage <= limit(p), name);
  }
});
test("Anaheim keeps the FOC phase-peak current and the independently identified flux", () => {
  const { parameters, note } = findMotorPreset("anaheim-bly172s-24v-4000");
  assert.equal(parameters.poles, 4);
  close(parameters.imax, 3.5);
  close(parameters.rs, 0.4);
  close(parameters.ld, 0.6);
  close(parameters.lq, 0.6);
  close(parameters.psi, 0.00572);
  assert.match(note, /3\.5 A（相峰值）/);
});
test("catalog conversions retain the line RMS convention and the published separate dq values", () => {
  const low = findMotorPreset("linmot-ec02-40-70");
  const ratedSpeed = 1000;
  close(low.parameters.rs, 6.8 / 2);
  close(low.parameters.ld, 2.6 / 2);
  close(low.parameters.lq, low.parameters.ld);
  close(low.parameters.imax, 1.4 * Math.SQRT2, 0.0005);
  close(
    omega(low.parameters, ratedSpeed) * low.parameters.psi * Math.sqrt(3 / 2),
    7.4,
    0.0001,
  );
  const high = findMotorPreset("emrax-228-hv-lc");
  close(high.parameters.ld, 0.175);
  close(high.parameters.lq, 0.180);
  close(high.parameters.psi, 0.06411);
  close(
    resistance({ ...defaults, ...high.parameters, useTemp: true, temperature: 25 }),
    0.01609,
    1e-7,
  );
});
test("project files preserve catalog provenance and support existing projects", () => {
  const project = {
    version: 1,
    name: "目录预设",
    p: defaults,
    o: initial,
    rows: [],
    mapName: "",
  };
  assert.equal(readProject(JSON.stringify(project)).motorPresetId, undefined);
  const motorPresetId = "linmot-ec02-40-70";
  assert.equal(
    readProject(JSON.stringify({ ...project, motorPresetId })).motorPresetId,
    motorPresetId,
  );
});
