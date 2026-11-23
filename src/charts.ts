import {
  limit,
  type Parameters,
  type Operation,
  type Result,
} from "./model.ts";
import type { Geometry } from "./geometry.ts";
import { inverterHexagonAtZero, voltageComponents } from "./voltage.ts";
import { math, mathCanvasLayout, type MathText } from "./notation.ts";
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
export const mtpvColor = "#a43b65";
export const inverterBoundaryColor = "#7255a5";
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
  const current = kind === "current";
  const hexagon = current ? [] : inverterHexagonAtZero(p.vdc);
  const zeroVertex = hexagon[0];
  const voltageSegments = [];
  let voltageExtent = Math.max(limit(p), pt?.voltage ?? 0, zeroVertex?.d ?? 0);
  if (!current && pt) {
    let d = 0,
      q = 0;
    for (const term of voltageComponents(p, o.rpm, pt)) {
      const endD = d + (term.ud ?? 0),
        endQ = q + (term.uq ?? 0);
      voltageSegments.push({ term, d, q, endD, endQ });
      voltageExtent = Math.max(voltageExtent, Math.hypot(endD, endQ));
      d = endD;
      q = endQ;
    }
  }
  const ext = current ? g.extent : voltageExtent * 1.28;
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
    t: MathText,
    x: number,
    y: number,
    color = ink,
    size = 11,
    align: CanvasTextAlign = "left",
    f = font,
  ) {
    c.fillStyle = color;
    c.textBaseline = "middle";
    if (typeof t === "string") {
      c.font = size + "px " + f;
      c.textAlign = align;
      c.fillText(t, x, y);
      return;
    }
    const { width, runs } = mathCanvasLayout(c, t, f, size);
    const start =
      align === "right" ? x - width : align === "center" ? x - width / 2 : x;
    c.textAlign = "left";
    for (const run of runs) {
      c.font = run.fontSpec;
      c.fillText(run.text, start + run.x, y + run.y);
    }
  }
  function captionWidth(t: MathText) {
    if (typeof t !== "string") return mathCanvasLayout(c, t, font, 11).width;
    c.font = "11px " + font;
    return c.measureText(t).width;
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
    t: MathText,
    x: number,
    y: number,
    color: string,
    dx: number,
    dy: number,
    solid = false,
  ) {
    const w = captionWidth(t) + 11,
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
    if (g.mtpv) {
      for (const branch of [g.mtpv.positive, g.mtpv.negative]) {
        let coords: number[] = [];
        for (const { d, q } of branch) {
          const x = X(d),
            y = Y(q);
          const px = coords.at(-2),
            py = coords.at(-1);
          if (
            px !== undefined &&
            py !== undefined &&
            Math.hypot(x - px, y - py) > 0.35 * Math.min(W, H)
          ) {
            if (coords.length > 2) path(coords, mtpvColor, 1.8, [7, 3, 2, 3]);
            coords = [];
          }
          coords.push(x, y);
        }
        if (coords.length > 2) path(coords, mtpvColor, 1.8, [7, 3, 2, 3]);
      }
      for (const { d, q } of Object.values(g.mtpv.atLimit)) {
        c.fillStyle = "#fff";
        c.beginPath();
        c.arc(X(d), Y(q), 3.8, 0, 2 * Math.PI);
        c.fill();
        circle(X(d), Y(q), 3.8, mtpvColor, 1.8);
      }
    }
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
  } else if (zeroVertex) {
    path(
      [...hexagon, zeroVertex].flatMap(({ d, q }) => [X(d), Y(q)]),
      inverterBoundaryColor,
      1.9,
    );
    circle(cx, cy, vlim * s, orange, 1.65, [6, 4]);
    circle(X(zeroVertex.d), cy, 2.5, inverterBoundaryColor, 1.5);
  }
  if (pt) {
    function arrow(
      x: number,
      y: number,
      u: number,
      v: number,
      color: string,
      lw: number,
    ) {
      const length = Math.hypot(u - x, v - y);
      if (length < 2) return;
      path([x, y, u, v], color, lw);
      const a = Math.atan2(v - y, u - x),
        len = Math.min(8, length * 0.75);
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
      arrow(cx, cy, X(pt.ud), Y(pt.uq), blue, 3.8);
      circle(X(pt.ud), Y(pt.uq), 3.5, blue, 1.5);
      c.fillStyle = ink;
      c.beginPath();
      c.arc(cx, cy, 2.5, 0, 2 * Math.PI);
      c.fill();
      for (const { term, d, q, endD, endQ } of voltageSegments) {
        arrow(X(d), Y(q), X(endD), Y(endQ), term.color, 2.2);
      }
    }
  }
  c.restore();
  const unit = current ? " (A)" : " (V)";
  text(
    [...(current ? math.id : math.vd), unit],
    right,
    cy - 10,
    ink,
    11,
    "right",
  );
  text([...(current ? math.iq : math.vq), unit], cx + 9, top + 2);
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
      [...math.imax, " " + p.imax.toFixed(0) + " A"],
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
        [
          ...math.te,
          " " +
            (o.mode === "auto" ? o.torque : (pt?.torque ?? 0)).toFixed(1) +
            " N·m",
        ],
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
    if (g.mtpv) {
      const negative = (pt?.torque ?? o.torque) < 0;
      const branch = negative ? g.mtpv.negative : g.mtpv.positive;
      const marker = negative
        ? g.mtpv.atLimit.negative
        : g.mtpv.atLimit.positive;
      const visible = ({ d, q }: { d: number; q: number }) =>
        X(d) > left + 8 &&
        X(d) < right - 8 &&
        Y(q) > top + 8 &&
        Y(q) < bottom - 8;
      const anchor =
        visible(marker)
          ? marker
          : (branch.slice().reverse().find(visible) ??
            g.mtpv.positive.find(visible) ??
            g.mtpv.negative.find(visible));
      if (anchor) label("MTPV", X(anchor.d), Y(anchor.q), mtpvColor, 9, -24);
      else text("MTPV 在当前视窗外", left + 4, bottom - 12, mtpvColor);
    }
    if (pt && r.status === "over")
      label(
        [
          pt.im < 0 ? "ΔI " + pt.im.toFixed(1) + " A" : "",
          pt.vm < 0 ? "ΔV " + pt.vm.toFixed(1) + " V" : "",
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
        "|V| " + pt.voltage.toFixed(1) + " V",
        X(pt.ud),
        Y(pt.uq),
        blue,
        -70,
        -22,
        true,
      );
      for (const [
        index,
        { term, d, q, endD, endQ },
      ] of voltageSegments.entries()) {
        const ud = term.ud ?? 0,
          uq = term.uq ?? 0;
        if (Math.hypot(ud, uq) < 1e-7) continue;
        const value =
          term.axis === "dq" ? Math.hypot(ud, uq) : term.axis === "d" ? ud : uq;
        const x = X((d + endD) / 2),
          y = Y((q + endQ) / 2);
        const reading = " " + value.toFixed(1) + " V";
        const caption =
          term.axis === "dq"
            ? ["|", ...term.symbol, "|" + reading]
            : [...term.symbol, reading];
        // Keep the final two-axis term's label away from the resultant shaft.
        if (term.axis === "dq" && index === voltageSegments.length - 1) {
          label(
            caption,
            x,
            y,
            term.color,
            x < cx ? -captionWidth(caption) - 24 : 14,
            12,
          );
          continue;
        }
        const offset =
          term.axis === "dq"
            ? 12
            : term.axis === "d"
              ? -38
              : uq > 0
                ? 10
                : -captionWidth(caption) - 16;
        label(caption, x, y, term.color, offset, term.axis === "d" ? -24 : 6);
      }
    }
    if (zeroVertex)
      label(
        "0° · " + zeroVertex.d.toFixed(1) + " V",
        X(zeroVertex.d),
        cy,
        inverterBoundaryColor,
        10,
        16,
      );
    label(
      [...math.vmax, " " + vlim.toFixed(1) + " V"],
      X(vlim * 0.707),
      Y(-vlim * 0.707),
      orange,
      2,
      5,
    );
  }
}
