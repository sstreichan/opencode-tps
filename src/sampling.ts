import { SAMPLE_WINDOW_MS } from "./constants";
import type { PluginState, StreamSample } from "./types";

export function clearLiveSamples(state: PluginState, sessionID: string) {
  if (state.streamSamples.has(sessionID)) {
    state.streamSamples.delete(sessionID);
    const [, setVersion] = state.version;
    setVersion((v) => v + 1);
  }
}

export function pruneStaleSamples(state: PluginState) {
  const now = Date.now();
  const cutoff = now - SAMPLE_WINDOW_MS;
  for (const [sessionID, samples] of state.streamSamples) {
    const pruned = samples.filter((s) => s.timestamp >= cutoff);
    if (pruned.length !== samples.length) {
      state.streamSamples.set(sessionID, pruned);
    }
  }
}

export function pushSample(
  state: PluginState,
  sessionID: string,
  tokens: number,
) {
  let samples = state.streamSamples.get(sessionID);
  if (!samples) {
    samples = [];
    state.streamSamples.set(sessionID, samples);
  }
  samples.push({ tokens, timestamp: Date.now() });
}
