import { describe, it, expect, vi } from "vitest";
import {
  titleForSession,
  isCompleted,
  dropSession,
  pruneIdleSiblings,
  registerSubagent,
} from "../src/session";
import type { PluginState } from "../src/types";

function createMockState(): PluginState {
  return {
    streamSamples: new Map(),
    messageStats: new Map(),
    sessionMeta: new Map(),
    lastKnownTps: new Map(),
    completedSessions: new Set(),
    api: {
      state: { session: { status: vi.fn() } },
    } as unknown as PluginState["api"],
    version: [() => 0, vi.fn()] as unknown as PluginState["version"],
    tick: [() => 0, vi.fn()] as unknown as PluginState["tick"],
    metaVersion: [() => 0, vi.fn()] as unknown as PluginState["metaVersion"],
  };
}

describe("titleForSession", () => {
  it("returns truncated session ID when no meta exists", () => {
    const state = createMockState();
    expect(titleForSession(state, "abcdef123456")).toBe("abcdef12");
  });

  it("returns the stored title when available", () => {
    const state = createMockState();
    state.sessionMeta.set("s1", { title: "My Agent" });
    expect(titleForSession(state, "s1")).toBe("My Agent");
  });

  it("strips subagent suffix from title", () => {
    const state = createMockState();
    state.sessionMeta.set("s1", { title: "Code Reviewer (@claude subagent)" });
    expect(titleForSession(state, "s1")).toBe("Code Reviewer");
  });
});

describe("isCompleted", () => {
  it("returns true for sessions in completedSessions", () => {
    const state = createMockState();
    state.completedSessions.add("done-session");
    expect(isCompleted(state, "done-session")).toBe(true);
  });

  it("returns true for idle sessions", () => {
    const state = createMockState();
    state.api = {
      state: { session: { status: () => ({ type: "idle" as const }) } },
    } as unknown as PluginState["api"];
    expect(isCompleted(state, "idle-session")).toBe(true);
  });

  it("returns false for active sessions", () => {
    const state = createMockState();
    state.api = {
      state: { session: { status: () => ({ type: "active" as const }) } },
    } as unknown as PluginState["api"];
    expect(isCompleted(state, "active-session")).toBe(false);
  });
});

describe("dropSession", () => {
  it("removes a session from all maps", () => {
    const state = createMockState();
    state.sessionMeta.set("s1", {});
    state.streamSamples.set("s1", []);
    state.lastKnownTps.set("s1", 10);
    state.messageStats.set("s1", {} as any);
    state.completedSessions.add("s1");

    dropSession(state, "s1");
    expect(state.sessionMeta.has("s1")).toBe(false);
    expect(state.streamSamples.has("s1")).toBe(false);
    expect(state.lastKnownTps.has("s1")).toBe(false);
    expect(state.messageStats.has("s1")).toBe(false);
    expect(state.completedSessions.has("s1")).toBe(false);
  });
});

describe("pruneIdleSiblings", () => {
  it("removes completed sibling sessions", () => {
    const state = createMockState();
    state.sessionMeta.set("parent", {});
    state.sessionMeta.set("child1", { parentID: "parent" });
    state.sessionMeta.set("child2", { parentID: "parent" });
    state.completedSessions.add("child1");

    const setMetaVersion = vi.fn();
    const setVersion = vi.fn();
    state.metaVersion = [() => 0, setMetaVersion] as typeof state.metaVersion;
    state.version = [() => 0, setVersion] as typeof state.version;

    pruneIdleSiblings(state, "parent", "child2");

    expect(state.sessionMeta.has("child1")).toBe(false);
    expect(state.sessionMeta.has("child2")).toBe(true);
    expect(setMetaVersion).toHaveBeenCalled();
  });
});

describe("registerSubagent", () => {
  it("stores session metadata and bumps version", () => {
    const state = createMockState();
    const setMetaVersion = vi.fn();
    state.metaVersion = [() => 0, setMetaVersion] as typeof state.metaVersion;

    registerSubagent(state, {
      id: "agent1",
      parentID: "parent",
      title: "SubAgent",
    });
    const meta = state.sessionMeta.get("agent1");
    expect(meta?.parentID).toBe("parent");
    expect(meta?.title).toBe("SubAgent");
    expect(setMetaVersion).toHaveBeenCalled();
  });
});
