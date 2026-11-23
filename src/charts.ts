import {
  limit,
  type Parameters,
  type Operation,
  type Result,
} from "./model.ts";
import type { Geometry } from "./geometry.ts";
export interface Frame {
  p: Parameters;
  o: Operation;
  r: Result;
  g: Geometry;
}
const blue = "#2963d9",
  teal = "#10988b",
  orange = "#ce8740",
  purple = "#9670ba",
  ink = "#23344a";
const font = '"Inter","Segoe UI","Noto Sans CJK SC",sans-serif';
const grid = "#e5eaf0",
  axis = "#9daaba",
  mono = '"Consolas","Liberation Mono",monospace';
export function chart(
  canvas: HTMLCanvasElement,
  kind: "current" | "voltage",
  frame: Frame,
) {
  const { p, o, r, g } = frame,
    pt = r.point;
  const W = canvas.clientWidth,
    H = canvas.clientHeight;
  if (W < 10 || H < 10) return;
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(W * dpr)) canvas.width = Math.round(W * dpr);
  if (canvas.height !== Math.round(H * dpr))
    canvas.height = Math.round(H * dpr);
  const c = canvas.getContext("2d")!;
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.fillStyle = "#fff";
  c.fillRect(0, 0, W, H);
  const current = kind === "current",
    ext = current
      ? g.extent
      : Math.max(
          limit(p),
          pt?.voltage ?? 0,
          Math.hypot(pt?.rd ?? 0, pt?.rq ?? 0),
        ) * 1.28;
  const cx = W / 2,
    cy = H / 2 + 2,
    s = Math.min((W - 60) / (2 * ext), (H - 35) / (2 * ext));
  const left = 23,
    right = W - 19,
    top = 10,
    bottom = H - 16;
  const X = (x: number) => cx + x * s,
    Y = (y: number) => cy - y * s;
  function path(coords: number[], color: string, lw = 1, dash: number[] = []) {
    c.beginPath();
    c.strokeStyle = color;
    c.lineWidth = lw;
    c.setLineDash(dash);
    c.moveTo(coords[0], coords[1]);
    for (let i = 2; i < coords.length; i += 2)
      c.lineTo(coords[i], coords[i + 1]);
    c.stroke();
    c.setLineDash([]);
  }
  function text(
    t: string,
    x: number,
    y: number,
    color = ink,
    size = 11,
    align: CanvasTextAlign = "left",
    f = font,
  ) {
    c.font = size + "px " + f;
    c.fillStyle = color;
    c.textAlign = align;
    c.textBaseline = "middle";
    c.fillText(t, x, y);
  }
  function circle(
    x: number,
    y: number,
    rad: number,
    color: string,
    lw = 1,
    dash: number[] = [],
  ) {
    c.beginPath();
    c.setLineDash(dash);
    c.strokeStyle = color;
    c.lineWidth = lw;
    c.arc(x, y, rad, 0, 2 * Math.PI);
    c.stroke();
    c.setLineDash([]);
  }
  const labels: { x: number; y: number; w: number; h: number }[] = [];
  function label(
    t: string,
    x: number,
    y: number,
    color: string,
    dx: number,
    dy: number,
    solid = false,
  ) {
    c.font = "11px " + font;
    const w = c.measureText(t).width + 11,
      h = 19;
    let u = Math.max(3, Math.min(W - w - 3, x + dx)),
      v = Math.max(3, Math.min(H - h - 3, y + dy));
    const base = v;
    for (const offset of [0, -21, 21, -42, 42, -63, 63]) {
      v = Math.max(3, Math.min(H - h - 3, base + offset));
      if (
        !labels.some(
          (b) =>
            u < b.x + b.w + 2 &&
            u + w + 2 > b.x &&
            v < b.y + b.h + 2 &&
            v + h + 2 > b.y,
        )
      )
        break;
    }
    labels.push({ x: u, y: v, w, h });
    const ex = Math.max(u, Math.min(u + w, x)),
      ey = Math.max(v, Math.min(v + h, y));
    path([x, y, ex, ey], color, 0.8);
    c.fillStyle = solid ? color : "rgba(255,255,255,.95)";
    c.beginPath();
    c.roundRect(u, v, w, h, 3);
    c.fill();
    text(t, u + 5.5, v + h / 2, solid ? "#fff" : color);
  }
  c.save();
  c.beginPath();
  c.rect(left, top, right - left, bottom - top);
  c.clip();
  if (current) {
    const tmp = document.createElement("canvas");
    tmp.width = g.width;
    tmp.height = g.height;
    const sc = tmp.getContext("2d")!,
      im = sc.createImageData(g.width, g.height);
    g.mask.forEach((v, i) => {
      if (v) {
        const k = 4 * i;
        im.data[k] = v === 1 ? 219 : 239;
        im.data[k + 1] = v === 1 ? 241 : 240;
        im.data[k + 2] = v === 1 ? 235 : 242;
        im.data[k + 3] = 255;
      }
    });
    sc.putImageData(im, 0, 0);
    c.drawImage(
      tmp,
      X(-g.xExtent),
      Y(g.extent),
      g.xExtent * s * 2,
      g.extent * s * 2,
    );
  } else {
    c.fillStyle = "#f4f8fe";
    c.beginPath();
    c.arc(cx, cy, limit(p) * s, 0, Math.PI * 2);
    c.fill();
  }
  const raw = ext / 3.4,
    ten = 10 ** Math.floor(Math.log10(raw)),
    tick = ([1, 2, 2.5, 5, 10].find((v) => v * ten >= raw) ?? 10) * ten;
  for (
    let x = Math.ceil((left - cx) / s / tick) * tick;
    X(x) <= right;
    x += tick
  ) {
    path([X(x), top, X(x), bottom], grid);
    if (Math.abs(x) > tick / 100)
      text(
        String(+x.toPrecision(4)),
        X(x),
        cy + 12,
        "#7b899d",
        10,
        "center",
        mono,
      );
  }
  for (
    let y = Math.ceil((cy - bottom) / s / tick) * tick;
    Y(y) >= top;
    y += tick
  ) {
    path([left, Y(y), right, Y(y)], grid);
    if (Math.abs(y) > tick / 100)
      text(
        String(+y.toPrecision(4)),
        cx - 6,
        Y(y) - 4,
        "#7b899d",
        10,
        "right",
        mono,
      );
  }
  path([left, cy, right, cy], axis);
  path([cx, bottom, cx, top], axis);
  path([right - 4, cy - 2, right, cy, right - 4, cy + 2], axis);
  path([cx - 2, top + 4, cx, top, cx + 2, top + 4], axis);
  text("0", cx - 5, cy + 11, "#77879a", 10, "right", mono);
  const vlim = limit(p);
  if (current) {
    circle(cx, cy, p.imax * s, blue, 1.7);
    const segments = (arr: number[], color: string, dash: boolean) => {
      c.strokeStyle = color;
      c.lineWidth = dash ? 1.55 : 2;
      c.beginPath();
      for (let i = 0; i < arr.length; i += 4) {
        if (dash && (i / 4) % 5 >= 3) continue;
        c.moveTo(X(arr[i]), Y(arr[i + 1]));
        c.lineTo(X(arr[i + 2]), Y(arr[i + 3]));
      }
      c.stroke();
    };
    segments(g.voltage, orange, false);
    segments(g.torque, purple, true);
    if (p.model !== "map") {
      const delta = (p.ld - p.lq) / 1000,
        coords: number[] = [];
      for (let i = -100; i <= 100; i++) {
        const q = (p.imax * i) / 100,
          d =
            (2 * delta * q * q) /
            (p.psi + Math.sqrt(p.psi * p.psi + 4 * delta * delta * q * q));
        if (Math.hypot(d, q) <= p.imax) coords.push(X(d), Y(q));
      }
      if (coords.length) path(coords, teal, 1.5, [5, 4]);
    }
  } else circle(cx, cy, vlim * s, orange, 1.65, [6, 4]);
  if (pt) {
    function arrow(
      x: number,
      y: number,
      u: number,
      v: number,
      color: string,
      lw: number,
    ) {
      if (Math.hypot(u - x, v - y) < 2) return;
      path([x, y, u, v], color, lw);
      const a = Math.atan2(v - y, u - x),
        len = 8;
      c.fillStyle = color;
      c.beginPath();
      c.moveTo(u, v);
      c.lineTo(u - len * Math.cos(a - 0.43), v - len * Math.sin(a - 0.43));
      c.lineTo(u - len * Math.cos(a + 0.43), v - len * Math.sin(a + 0.43));
      c.fill();
    }
    if (current) {
      path([X(pt.d), cy, X(pt.d), Y(pt.q), cx, Y(pt.q)], "#7397b9", 1, [3, 4]);
      c.fillStyle = "#fff";
      c.beginPath();
      c.arc(X(pt.d), Y(pt.q), 5.8, 0, 2 * Math.PI);
      c.fill();
      circle(X(pt.d), Y(pt.q), 5.5, teal, 2);
      c.beginPath();
      c.fillStyle = teal;
      c.arc(X(pt.d), Y(pt.q), 2.4, 0, 2 * Math.PI);
      c.fill();
    } else {
      path(
        [X(pt.ud), cy, X(pt.ud), Y(pt.uq), cx, Y(pt.uq)],
        "#99abc4",
        1,
        [3, 4],
      );
      arrow(cx, cy, X(pt.ud), cy, purple, 2);
      arrow(X(pt.ud), cy, X(pt.ud), Y(pt.uq), teal, 2);
      arrow(cx, cy, X(pt.rd), Y(pt.rq), orange, 2.5);
      if (Math.hypot(pt.rd, pt.rq) * s > 1)
        arrow(X(pt.rd), Y(pt.rq), X(pt.ud), Y(pt.uq), teal, 2);
      arrow(cx, cy, X(pt.ud), Y(pt.uq), blue, 2.7);
      c.fillStyle = ink;
      c.beginPath();
      c.arc(cx, cy, 3, 0, 2 * Math.PI);
      c.fill();
    }
  }
  c.restore();
  text(current ? "i_d (A)" : "u_d (V)", right, cy - 10, ink, 11, "right", mono);
  text(current ? "i_q (A)" : "u_q (V)", cx + 9, top + 2, ink, 11, "left", mono);
  const boundary =
    r.status === "unreachable" ||
    r.status === "coverage" ||
    r.status === "unresolved";
  if (current) {
    if (pt)
      label(
        (boundary ? "边界点" : "运行点") + " P",
        X(pt.d),
        Y(pt.q),
        teal,
        -65,
        -26,
        true,
      );
    label(
      "Imax " + p.imax.toFixed(0) + " A",
      X(p.imax * 0.707),
      Y(-p.imax * 0.707),
      blue,
      7,
      4,
    );
    if (g.voltage.length) {
      let k = 0,
        best = Infinity;
      for (let i = 0; i < g.voltage.length; i += 4) {
        const v = Math.hypot(
          g.voltage[i] - 0.33 * ext,
          g.voltage[i + 1] - 0.45 * ext,
        );
        if (v < best) {
          best = v;
          k = i;
        }
      }
      label("电压边界", X(g.voltage[k]), Y(g.voltage[k + 1]), orange, 8, -24);
    }
    if (g.torque.length) {
      let k = 0,
        best = Infinity;
      for (let i = 0; i < g.torque.length; i += 4) {
        const v = Math.hypot(
          g.torque[i] + 0.73 * ext,
          g.torque[i + 1] - 0.42 * ext,
        );
        if (v < best) {
          best = v;
          k = i;
        }
      }
      label(
        "Tₑ " +
          (o.mode === "auto" ? o.torque : (pt?.torque ?? 0)).toFixed(1) +
          " N·m",
        X(g.torque[k]),
        Y(g.torque[k + 1]),
        purple,
        -65,
        8,
      );
    }
    if (!pt && o.mode === "manual") {
      circle(X(o.id), Y(o.iq), 5, orange, 2);
      label("给定 P · 无数据", X(o.id), Y(o.iq), orange, 7, -24, true);
    }
    const inside =
      g.mask[
        Math.min(
          g.height - 1,
          Math.floor(((1 + (p.imax * 0.2) / g.extent) * g.height) / 2),
        ) *
          g.width +
          Math.max(
            0,
            Math.floor(((1 - (p.imax * 0.55) / g.xExtent) * g.width) / 2),
          )
      ];
    if (inside === 1)
      text(
        "可行域",
        X(-p.imax * 0.55),
        Y(-p.imax * 0.2),
        "#328674",
        11,
        "center",
      );
    if (p.model !== "map") {
      const q = -p.imax * 0.52,
        delta = (p.ld - p.lq) / 1000,
        d =
          (2 * delta * q * q) /
          (p.psi + Math.sqrt(p.psi * p.psi + 4 * delta * delta * q * q));
      label("MTPA", X(d), Y(q), teal, -40, 7);
    }
    if (pt && r.status === "over")
      label(
        [
          pt.im < 0 ? "ΔI " + pt.im.toFixed(1) + " A" : "",
          pt.vm < 0 ? "ΔU " + pt.vm.toFixed(1) + " V" : "",
        ]
          .filter(Boolean)
          .join("  "),
        X(pt.d),
        Y(pt.q),
        orange,
        10,
        8,
      );
  } else {
    if (pt) {
      label(
        "|u| " + pt.voltage.toFixed(1) + " V",
        X(pt.ud),
        Y(pt.uq),
        blue,
        -70,
        -22,
        true,
      );
      if (Math.hypot(pt.rd, pt.rq) > 1e-7) {
        label(
          "Rₛ i " + Math.hypot(pt.rd, pt.rq).toFixed(1) + " V",
          X(pt.rd),
          Y(pt.rq),
          orange,
          10,
          13,
        );
        label(
          "ωₑψ " + Math.hypot(pt.ed, pt.eq).toFixed(1) + " V",
          X(pt.rd + pt.ed * 0.55),
          Y(pt.rq + pt.eq * 0.55),
          teal,
          9,
          -10,
        );
      }
      label("ud " + pt.ud.toFixed(1), X(pt.ud / 2), cy, purple, -28, 9);
      label("uq " + pt.uq.toFixed(1), X(pt.ud), Y(pt.uq / 2), teal, -58, -2);
    }
    label(
      "Umax " + vlim.toFixed(1) + " V",
      X(vlim * 0.707),
      Y(-vlim * 0.707),
      orange,
      2,
      5,
    );
  }
}
