import { omega, type Parameters, type Point } from "./model.ts";
import { math, type MathRun } from "./notation.ts";

export interface VoltageComponent {
  label: string;
  symbol: readonly MathRun[];
  color: string;
  axis: "d" | "q" | "dq";
  ud: number | undefined;
  uq: number | undefined;
}

export function voltageComponents(
  p: Parameters,
  rpm: number,
  point: Point | null,
): VoltageComponent[] {
  const w = omega(p, rpm);
  const resistanceDrop: VoltageComponent = {
    label: "电阻压降",
    symbol: [...math.rs, "i"],
    color: "#586879",
    axis: "dq",
    ud: point?.rd,
    uq: point?.rq,
  };
  if (p.model === "map") {
    return [
      resistanceDrop,
      {
        label: "q 轴磁链项",
        symbol: ["−", ...math.omega, ...math.psiQ],
        color: "#117c70",
        axis: "d",
        ud: point?.ed,
        uq: point ? 0 : undefined,
      },
      {
        label: "d 轴磁链项",
        symbol: [...math.omega, ...math.psiD],
        color: "#8953a8",
        axis: "q",
        ud: point ? 0 : undefined,
        uq: point?.eq,
      },
    ];
  }

  return [
    resistanceDrop,
    {
      label: "永磁反电动势",
      symbol: [...math.omega, ...math.psiF],
      color: "#a55919",
      axis: "q",
      ud: point ? 0 : undefined,
      uq: point ? w * p.psi : undefined,
    },
    {
      label: "电感电压",
      symbol: math.vl,
      color: "#117c70",
      axis: "dq",
      ud: point ? -w * ((p.lq * point.q) / 1000) : undefined,
      uq: point ? w * ((p.ld * point.d) / 1000) : undefined,
    },
  ];
}
