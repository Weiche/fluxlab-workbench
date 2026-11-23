import {
  estimateSpeedRange,
  speedSpan,
  torqueEnvelope,
  type SpeedRangeEstimate,
  type TorqueEnvelope,
} from "./tn.ts";
import type { Parameters } from "./model.ts";

interface SpeedRequest {
  parameters: Parameters;
  rpm: number;
  requested?: number;
  estimate?: SpeedRangeEstimate;
}
export interface SpeedResponse {
  span: number;
  estimate: SpeedRangeEstimate;
  envelope: TorqueEnvelope;
}

self.onmessage = ({
  data: {
    parameters,
    rpm,
    requested,
    estimate = estimateSpeedRange(parameters),
  },
}: MessageEvent<SpeedRequest>) => {
  const span = speedSpan(parameters, rpm, requested ?? estimate.span);
  self.postMessage({
    span,
    estimate,
    envelope: torqueEnvelope(parameters, span, estimate.edges),
  } satisfies SpeedResponse);
};
