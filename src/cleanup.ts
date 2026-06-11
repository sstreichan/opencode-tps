import type { PluginState } from "./types";

export function disposeAll(state: PluginState) {
  state.messageStats.clear();
  state.sessionMeta.clear();
  state.lastKnownTps.clear();
  state.streamSamples.clear();
  state.completedSessions.clear();
}
