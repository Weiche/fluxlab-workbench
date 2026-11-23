import { solve, type Parameters, type Operation } from "./model.ts";
import { geometry } from "./geometry.ts";
let p: Parameters,
  geomKey = "",
  revision = 0;
self.onmessage = (e) => {
  const m = e.data;
  try {
    if (m.p) {
      p = { ...m.p, map: m.keepMap ? (p?.map ?? null) : m.p.map };
      revision++;
    }
    if (m.type === "batch") {
      self.postMessage({
        id: m.id,
        results: m.ops.map((o: Operation | null) => (o ? solve(p, o) : null)),
      });
      return;
    }
    const o = m.o as Operation,
      r = solve(p, o),
      pt = r.point,
      target = o.mode === "auto" ? o.torque : (pt?.torque ?? 0);
    const extent =
      Math.max(p.imax, Math.abs(pt?.d ?? o.id), Math.abs(pt?.q ?? o.iq)) * 1.26;
    const key = [revision, o.rpm, target, extent, m.ratio, m.preview].join("/");
    const g =
      key === geomKey
        ? null
        : geometry(p, o.rpm, target, extent, m.ratio, m.preview ? 86 : 136);
    geomKey = key;
    const comparison =
      m.compare && p.model === "ideal" && o.mode === "auto"
        ? solve(
            { ...p, solver: p.solver === "analytic" ? "numeric" : "analytic" },
            o,
          )
        : null;
    self.postMessage({ id: m.id, o, r, g, comparison, preview: m.preview });
  } catch (err) {
    self.postMessage({ id: m.id, error: String(err) });
  }
};
