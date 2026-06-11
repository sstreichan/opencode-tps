import {
  BYTES_PER_TOKEN_ESTIMATE,
  LIVE_STALE_MS,
  SAMPLE_WINDOW_MS,
  SINGLE_SAMPLE_MAX_MS,
  SINGLE_SAMPLE_MIN_MS,
} from "./constants";
import type { PluginState, StreamSample } from "./types";

export function estimateTokens(text: string): number {
  const byteLen = new TextEncoder().encode(text).length;
  return Math.max(1, Math.ceil(byteLen / BYTES_PER_TOKEN_ESTIMATE));
}

export function readOutputTokens(info: unknown): number | undefined {
  if (!info || typeof info !== "object") return undefined;
  const tokens = (info as { tokens?: { output?: unknown } }).tokens;
  const output = tokens?.output;
  if (typeof output === "number" && isFinite(output) && output > 0)
    return output;
  return undefined;
}

export function formatTps(value: number): string {
  if (value < 0) return "-";
  if (value < 10) return value.toFixed(2);
  if (value < 100) return value.toFixed(1);
  return Math.round(value).toString();
}

export function singleSampleDuration(samples: StreamSample[]): number {
  const elapsed = Date.now() - samples[0].timestamp;
  return Math.max(
    SINGLE_SAMPLE_MIN_MS,
    Math.min(elapsed, SINGLE_SAMPLE_MAX_MS),
  );
}

export function activeDurationMs(samples: StreamSample[]): number {
  if (samples.length < 2) {
    return singleSampleDuration(samples);
  }
  let total = 0;
  for (let i = 1; i < samples.length; i++) {
    total += Math.max(0, samples[i].timestamp - samples[i - 1].timestamp);
  }
  const now = Date.now();
  const tail = now - samples[samples.length - 1].timestamp;
  total += Math.min(tail, 1000);
  return Math.max(total, SINGLE_SAMPLE_MIN_MS);
}

export function calcLiveTps(state: PluginState, sessionID: string): number {
  if (state.api.state.session.status(sessionID)?.type === "idle") return -1;

  const samples = state.streamSamples.get(sessionID) ?? [];
  const now = Date.now();
  const cutoff = now - SAMPLE_WINDOW_MS;
  const active = samples.filter((s) => s.timestamp >= cutoff);

  if (active.length === 0) return -1;

  const last = active[active.length - 1];
  if (now - last.timestamp > LIVE_STALE_MS) return -1;

  const totalTokens = active.reduce((sum, s) => sum + s.tokens, 0);
  const durationMs = activeDurationMs(active);
  if (durationMs <= 0) return -1;

  const value = (totalTokens / durationMs) * 1000;
  state.lastKnownTps.set(sessionID, value);
  return value;
}

export function displayTps(state: PluginState, sessionID: string): number {
  const live = calcLiveTps(state, sessionID);
  if (live >= 0) return live;
  return state.lastKnownTps.get(sessionID) ?? -1;
}
