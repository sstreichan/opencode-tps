import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  estimateTokens,
  formatTps,
  readOutputTokens,
  activeDurationMs,
  singleSampleDuration,
  calcLiveTps,
} from "../src/tps-calc";
import { SINGLE_SAMPLE_MIN_MS } from "../src/constants";
import type { PluginState } from "../src/types";

function createMockState(): PluginState {
  return {
    streamSamples: new Map(),
    messageStats: new Map(),
    sessionMeta: new Map(),
    lastKnownTps: new Map(),
    completedSessions: new Set(),
    api: {
      state: { session: { status: () => ({ type: "active" as const }) } },
    } as unknown as PluginState["api"],
    version: [() => 0, vi.fn()] as unknown as PluginState["version"],
    tick: [() => 0, vi.fn()] as unknown as PluginState["tick"],
    metaVersion: [() => 0, vi.fn()] as unknown as PluginState["metaVersion"],
  };
}

describe("estimateTokens", () => {
  it("returns at least 1 for empty or minimal text", () => {
    expect(estimateTokens("")).toBe(1);
    expect(estimateTokens("a")).toBe(1);
    expect(estimateTokens("ab")).toBe(1);
  });

  it("scales with text length", () => {
    expect(estimateTokens("hello world")).toBeGreaterThan(1);
    const short = estimateTokens("short");
    const long = estimateTokens("a".repeat(100));
    expect(long).toBeGreaterThan(short);
  });

  it("handles unicode characters", () => {
    const result = estimateTokens("🔥");
    expect(result).toBeGreaterThanOrEqual(1);
  });
});

describe("formatTps", () => {
  it("returns '-' for negative values", () => {
    expect(formatTps(-1)).toBe("-");
    expect(formatTps(-100)).toBe("-");
  });

  it("formats small values with 2 decimals", () => {
    expect(formatTps(5.123)).toBe("5.12");
    expect(formatTps(0.1)).toBe("0.10");
  });

  it("formats medium values with 1 decimal", () => {
    expect(formatTps(50)).toBe("50.0");
    expect(formatTps(99.99)).toBe("100.0");
  });

  it("formats large values as integers", () => {
    expect(formatTps(100)).toBe("100");
    expect(formatTps(1234.56)).toBe("1235");
  });
});

describe("readOutputTokens", () => {
  it("returns undefined for non-object input", () => {
    expect(readOutputTokens(null)).toBeUndefined();
    expect(readOutputTokens(undefined)).toBeUndefined();
    expect(readOutputTokens("string")).toBeUndefined();
  });

  it("extracts valid token count from info object", () => {
    const info = { tokens: { output: 42 } };
    expect(readOutputTokens(info)).toBe(42);
  });

  it("returns undefined for non-positive token counts", () => {
    expect(readOutputTokens({ tokens: { output: 0 } })).toBeUndefined();
    expect(readOutputTokens({ tokens: { output: -1 } })).toBeUndefined();
  });
});

describe("singleSampleDuration", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns SINGLE_SAMPLE_MIN_MS for fresh sample", () => {
    const samples = [{ tokens: 1, timestamp: Date.now() }];
    expect(singleSampleDuration(samples)).toBe(SINGLE_SAMPLE_MIN_MS);
  });

  it("caps at SINGLE_SAMPLE_MAX_MS for old sample", () => {
    const samples = [{ tokens: 1, timestamp: Date.now() - 10000 }];
    expect(singleSampleDuration(samples)).toBeLessThanOrEqual(1000);
  });
});

describe("activeDurationMs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns at least SINGLE_SAMPLE_MIN_MS", () => {
    const samples = [{ tokens: 1, timestamp: Date.now() }];
    expect(activeDurationMs(samples)).toBeGreaterThanOrEqual(
      SINGLE_SAMPLE_MIN_MS,
    );
  });

  it("accumulates time between multiple samples", () => {
    const now = Date.now();
    const samples = [
      { tokens: 1, timestamp: now - 500 },
      { tokens: 1, timestamp: now },
    ];
    const duration = activeDurationMs(samples);
    expect(duration).toBeGreaterThanOrEqual(250);
  });
});

describe("calcLiveTps", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns -1 for idle session", () => {
    const state = createMockState();
    state.api = {
      state: { session: { status: () => ({ type: "idle" as const }) } },
    } as unknown as PluginState["api"];
    expect(calcLiveTps(state, "test-session")).toBe(-1);
  });

  it("returns -1 with no samples", () => {
    const state = createMockState();
    expect(calcLiveTps(state, "test-session")).toBe(-1);
  });

  it("computes positive TPS with fresh samples", () => {
    const state = createMockState();
    const now = Date.now();
    state.streamSamples.set("test-session", [
      { tokens: 10, timestamp: now - 200 },
      { tokens: 10, timestamp: now - 100 },
      { tokens: 10, timestamp: now },
    ]);
    const tps = calcLiveTps(state, "test-session");
    expect(tps).toBeGreaterThan(0);
    expect(state.lastKnownTps.get("test-session")).toBe(tps);
  });
});
