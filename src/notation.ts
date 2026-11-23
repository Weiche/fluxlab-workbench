export type MathRun = string | { subscript: string };
export type MathText = string | readonly MathRun[];

const sub = (subscript: string) => ({ subscript });
export const math = {
  id: ["i", sub("d")],
  iq: ["i", sub("q")],
  vd: ["V", sub("d")],
  vq: ["V", sub("q")],
  vl: ["V", sub("L")],
  vdc: ["V", sub("dc")],
  vmax: ["V", sub("max")],
  imax: ["I", sub("max")],
  te: ["T", sub("e")],
  rs: ["R", sub("s")],
  omega: ["ω", sub("e")],
  ld: ["L", sub("d")],
  lq: ["L", sub("q")],
  psiD: ["ψ", sub("d")],
  psiQ: ["ψ", sub("q")],
  psiF: ["ψ", sub("f")],
  voltageUse: ["k", sub("v")],
} as const;

export function mathHtml(expression: MathText): string {
  if (typeof expression === "string") return expression;
  return expression
    .map((run) =>
      typeof run === "string" ? run : `<sub>${run.subscript}</sub>`,
    )
    .join("");
}

export function mathCanvasLayout(
  ctx: CanvasRenderingContext2D,
  expression: readonly MathRun[],
  font: string,
  size: number,
) {
  let width = 0;
  const runs = expression.map((run) => {
    const isSubscript = typeof run !== "string";
    const text = isSubscript ? run.subscript : run;
    const fontSize = isSubscript ? size * 0.78 : size;
    const fontSpec = fontSize + "px " + font;
    const x = width;
    ctx.font = fontSpec;
    width += ctx.measureText(text).width;
    return { text, fontSpec, x, y: isSubscript ? size * 0.26 : 0 };
  });
  return { width, runs };
}
