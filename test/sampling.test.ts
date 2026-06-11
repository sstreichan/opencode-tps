import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  clearLiveSamples,
  pruneStaleSamples,
  pushSample,
} from "../src/sampling";
import type { PluginState } from "../src/types";

function createMockState(): PluginState {
  return {
    streamSamples: new Map(),
    messageStats: new Map(),
    sessionMeta: new Map(),
    lastKnownTps: new Map(),
    completedSessions: new Set(),
    api: {} as unknown as PluginState["api"],
    version: [() => 0, vi.fn()] as unknown as PluginState["version"],
    tick: [() => 0, vi.fn()] as unknown as PluginState["tick"],
    metaVersion: [() => 0, vi.fn()] as unknown as PluginState["metaVersion"],
  };
}

describe("clearLiveSamples", () => {
  it("removes samples and bumps version", () => {
    const state = createMockState();
    state.streamSamples.set("s1", [{ tokens: 1, timestamp: 100 }]);
    const setVersion = vi.fn();

    const origVersion = state.version;
    state.version = [origVersion[0], setVersion] as typeof state.version;

    clearLiveSamples(state, "s1");
    expect(state.streamSamples.has("s1")).toBe(false);
    expect(setVersion).toHaveBeenCalled();
  });

  it("does nothing if session has no samples", () => {
    const state = createMockState();
    const setVersion = vi.fn();
    state.version = [state.version[0], setVersion] as typeof state.version;

    clearLiveSamples(state, "nonexistent");
    expect(setVersion).not.toHaveBeenCalled();
  });
});

describe("pruneStaleSamples", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("removes samples older than SAMPLE_WINDOW_MS", () => {
    const state = createMockState();
    const now = Date.now();
    state.streamSamples.set("s1", [
      { tokens: 1, timestamp: now - 10000 },
      { tokens: 2, timestamp: now - 1000 },
    ]);
    pruneStaleSamples(state);
    const remaining = state.streamSamples.get("s1");
    expect(remaining).toHaveLength(1);
    expect(remaining![0].tokens).toBe(2);
  });

  it("keeps all samples if none are stale", () => {
    const state = createMockState();
    const now = Date.now();
    state.streamSamples.set("s1", [
      { tokens: 1, timestamp: now - 1000 },
      { tokens: 2, timestamp: now },
    ]);
    pruneStaleSamples(state);
    expect(state.streamSamples.get("s1")).toHaveLength(2);
  });
});

describe("pushSample", () => {
  it("creates a new sample array for unknown session", () => {
    const state = createMockState();
    pushSample(state, "new-session", 42);
    const samples = state.streamSamples.get("new-session");
    expect(samples).toHaveLength(1);
    expect(samples![0].tokens).toBe(42);
    expect(samples![0].timestamp).toBeGreaterThan(0);
  });

  it("appends to existing samples", () => {
    const state = createMockState();
    state.streamSamples.set("s1", [{ tokens: 1, timestamp: 100 }]);
    pushSample(state, "s1", 99);
    expect(state.streamSamples.get("s1")).toHaveLength(2);
    expect(state.streamSamples.get("s1")![1].tokens).toBe(99);
  });
});
