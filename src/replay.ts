import { isMaxOutput, type Operation, type Point } from "./model.ts";

export interface ReplaySettings {
  mode: "step" | "smooth";
  keepMaxOutput: boolean;
}

export const defaultReplay: ReplaySettings = {
  mode: "step",
  keepMaxOutput: false,
};

export type ReplayTransition = [Operation, Operation];
type Current = Pick<Point, "d" | "q">;

export function commandType(op: Operation) {
  return isMaxOutput(op) ? "max-output" : op.mode;
}

export function replayOperation(op: Operation | null, keepMaxOutput: boolean) {
  return op && keepMaxOutput
    ? { ...op, mode: "auto" as const, maxOutput: true }
    : op;
}

export function replayTransition(
  from: Operation,
  to: Operation,
  fromPoint: Current | null,
  toPoint: Current | null,
): ReplayTransition | null {
  if (commandType(from) === commandType(to)) return [from, to];

  const current = (op: Operation, point: Current | null): Operation | null =>
    op.mode === "manual"
      ? op
      : point && { ...op, mode: "manual", id: point.d, iq: point.q };
  const start = current(from, fromPoint);
  const end = current(to, toPoint);
  return start && end ? [start, end] : null;
}

export function interpolateCommand(
  [from, to]: ReplayTransition,
  progress: number,
): Operation {
  const eased = progress * progress * (3 - 2 * progress);
  const mix = (a: number, b: number) => a + (b - a) * eased;
  const op = { ...from, rpm: mix(from.rpm, to.rpm) };
  if (op.mode === "manual") {
    op.id = mix(from.id, to.id);
    op.iq = mix(from.iq, to.iq);
  } else if (!isMaxOutput(op)) {
    op.torque = mix(from.torque, to.torque);
  }
  return op;
}
