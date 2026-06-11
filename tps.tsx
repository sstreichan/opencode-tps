import { createSignal } from "solid-js";
import type { TuiPlugin } from "@opencode-ai/plugin/tui";
import { setupHooks } from "./src/hooks";
import { registerSlots } from "./src/slots";
import { disposeAll } from "./src/cleanup";
import type { PluginState } from "./src/types";

const tui: TuiPlugin = async (api, _options, _meta) => {
  const state: PluginState = {
    streamSamples: new Map(),
    messageStats: new Map(),
    sessionMeta: new Map(),
    lastKnownTps: new Map(),
    completedSessions: new Set(),
    api,
    version: createSignal(0),
    tick: createSignal(0),
    metaVersion: createSignal(0),
  };

  const disposeHooks = setupHooks(state);
  registerSlots(state);

  api.lifecycle.onDispose(() => {
    disposeHooks();
    disposeAll(state);
  });
};

export default {
  id: "opencode-tps",
  tui,
};
