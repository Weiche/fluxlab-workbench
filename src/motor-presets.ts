import {
  copperTemperatureCoefficient,
  type Operation,
  type Parameters,
} from "./model.ts";

interface CatalogSource {
  label: string;
  url: string;
}
type MotorParameters = Pick<
  Parameters,
  "poles" | "rs" | "ld" | "lq" | "psi" | "vdc" | "imax"
>;
type Winding =
  | { lineResistance: number; lineInductance: number; lineEmfRmsPerKrpm: number }
  | { phaseResistance: number; ld: number; lq: number; flux: number };

interface CatalogMotor {
  id: string;
  name: string;
  voltageClass: "low" | "high";
  sources: [CatalogSource, ...CatalogSource[]];
  poles: number;
  busVoltage: number;
  currentRms: number;
  currentBasis: string;
  resistanceTemperature: number;
  winding: Winding;
  note?: string;
  operation: Pick<Operation, "rpm" | "torque">;
}

export interface MotorPreset {
  id: string;
  name: string;
  voltageClass: CatalogMotor["voltageClass"];
  sources: CatalogMotor["sources"];
  parameters: MotorParameters;
  note: string;
  operation: CatalogMotor["operation"];
  torqueRange: number;
}

const beckhoffTerms = {
  label: "Beckhoff 电气量定义",
  url: "https://infosys.beckhoff.com/content/1033/am8000_am8500_ba/7944624395.html",
};

const catalog: CatalogMotor[] = [
  {
    id: "linmot-ec02-40-70",
    name: "LinMot EC02-40/70",
    voltageClass: "low",
    sources: [{
      label: "LinMot EC02-40 目录，第 1112–1113 页",
      url: "https://shop.linmot.com/data/import/Dokumente/0185-1137-E_1V0_DS_Servomotors_EC02-40.pdf",
    }],
    poles: 4,
    busVoltage: 24,
    currentRms: 1.4,
    currentBasis: "目录额定电流",
    resistanceTemperature: 20,
    winding: { lineResistance: 6.8, lineInductance: 2.6, lineEmfRmsPerKrpm: 7.4 },
    note: "母线取目录转矩–转速图的 24 V DC 曲线。",
    operation: { rpm: 1000, torque: 0.12 },
  },
  {
    id: "beckhoff-am8121-f",
    name: "Beckhoff AM8121-wFyz",
    voltageClass: "low",
    sources: [
      {
        label: "Beckhoff AM812x 技术数据",
        url: "https://infosys.beckhoff.com/content/1033/am8100/1333897355.html",
      },
      beckhoffTerms,
    ],
    poles: 3,
    busVoltage: 48,
    currentRms: 4,
    currentBasis: "48 V DC 额定电流",
    resistanceTemperature: 20,
    winding: { lineResistance: 1.6, lineInductance: 2.8, lineEmfRmsPerKrpm: 8 },
    note: "采用 21F 绕组的电机栏。搭配 EL7201 时，目录另列 2.8 A RMS。",
    operation: { rpm: 2000, torque: 0.35 },
  },
  {
    id: "kollmorgen-akm42g",
    name: "Kollmorgen AKM42G",
    voltageClass: "high",
    sources: [{
      label: "Kollmorgen AKM 选型指南 Rev F，第 28–29 页",
      url: "https://www.kollmorgen.com/sites/default/files/2025-04/AKM-KM_SG_000077_RevF_EN.pdf",
    }],
    poles: 5,
    busVoltage: 320,
    currentRms: 4.8,
    currentBasis: "目录连续堵转电流",
    resistanceTemperature: 25,
    winding: { lineResistance: 2.51, lineInductance: 9.2, lineEmfRmsPerKrpm: 47.5 },
    note: "采用 320 V DC 性能栏。连续堵转电流对应绕组温升 100 °C。",
    operation: { rpm: 2000, torque: 2 },
  },
  {
    id: "beckhoff-am8042-f",
    name: "Beckhoff AM8042-F",
    voltageClass: "high",
    sources: [
      {
        label: "Beckhoff AM804x 技术数据",
        url: "https://infosys.beckhoff.com/content/1033/am8000_am8500_ba/8010674955.html",
      },
      {
        label: "Beckhoff AX5000 母线说明",
        url: "https://infosys.beckhoff.com/content/1033/ax5000_function_doku_hw2/19981666699.html",
      },
      beckhoffTerms,
    ],
    poles: 4,
    busVoltage: 560,
    currentRms: 3.8,
    currentBasis: "400 V AC 额定工况电流",
    resistanceTemperature: 20,
    winding: { lineResistance: 3.7, lineInductance: 17.4, lineEmfRmsPerKrpm: 68 },
    note: "采用 42F 栏。560 V DC 来自 AX5000 接入 400 V AC 时的母线定义。",
    operation: { rpm: 2500, torque: 2.5 },
  },
  {
    id: "emrax-228-hv-lc",
    name: "EMRAX 228 HV 液冷",
    voltageClass: "high",
    sources: [{
      label: "EMRAX 228 数据表 V1.7，第 2 页",
      url: "https://emrax.com/wp-content/uploads/2026/08/EMRAX_228_datasheet_v1.7.pdf",
    }],
    poles: 10,
    busVoltage: 830,
    currentRms: 120,
    currentBasis: "液冷连续电流",
    resistanceTemperature: 25,
    winding: { phaseResistance: 0.01609, ld: 0.175, lq: 0.180, flux: 0.06411 },
    note: "采用标准三相 UVW 的单相 Ld、Lq 和目录 PM 磁链。同表 Ke 与按该磁链推算的反电动势有差异。830 V DC 为目录峰值功率工况的母线。",
    operation: { rpm: 3000, torque: 80 },
  },
];

function toPreset(motor: CatalogMotor): MotorPreset {
  const w = motor.winding;
  const equivalent = "lineResistance" in w;
  const rsReference = equivalent ? w.lineResistance / 2 : w.phaseResistance;
  const rs =
    rsReference / (1 + copperTemperatureCoefficient * (motor.resistanceTemperature - 20));
  const psi = equivalent
    ? Math.sqrt(2 / 3) * w.lineEmfRmsPerKrpm / (motor.poles * Math.PI * 1000 / 30)
    : w.flux;
  const imax = motor.currentRms * Math.SQRT2;
  const parameters = {
    poles: motor.poles,
    rs: +rs.toPrecision(6),
    ld: equivalent ? w.lineInductance / 2 : w.ld,
    lq: equivalent ? w.lineInductance / 2 : w.lq,
    psi: +psi.toPrecision(6),
    vdc: motor.busVoltage,
    imax: +imax.toFixed(3),
  };
  const torqueScale = 1.5 * motor.poles * psi * imax;
  const tick = 10 ** Math.floor(Math.log10(torqueScale));
  const torqueRange = +(Math.ceil(1.1 * torqueScale / tick) * tick).toPrecision(3);
  const inductionNote = equivalent
    ? "目录等效近似，Ld = Lq = 线间电感的一半。"
    : "";
  return {
    id: motor.id,
    name: motor.name,
    voltageClass: motor.voltageClass,
    sources: motor.sources,
    parameters,
    operation: motor.operation,
    torqueRange,
    note: `${motor.currentBasis} ${motor.currentRms} A RMS 换算为相峰值。${inductionNote}${motor.note ?? ""}`,
  };
}

export const motorPresets = catalog.map(toPreset);
export const findMotorPreset = (id?: string) =>
  motorPresets.find((preset) => preset.id === id);
