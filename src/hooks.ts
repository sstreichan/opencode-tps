import { WARMUP_MS } from "./constants";
import { calcLiveTps, estimateTokens, readOutputTokens } from "./tps-calc";
import { clearLiveSamples, pushSample, pruneStaleSamples } from "./sampling";
import { fetchSessionMeta, registerSubagent } from "./session";
import type { PluginState, PartDeltaEvent } from "./types";

export function setupHooks(state: PluginState): () => void {
  const unsubDelta = state.api.event.on(
    "message.part.delta",
    (raw: unknown) => {
      const evt = raw as PartDeltaEvent;
      const sessionID = evt.properties.sessionID;
      if (!sessionID) return;
      if (state.api.state.session.status(sessionID)?.type === "idle") return;
      if (evt.properties.field !== "text") return;

      const parts = state.api.state.part(evt.properties.messageID);
      const hasTextOrReasoning = parts?.some(
        (p) => p.type === "text" || p.type === "reasoning",
      );
      if (!hasTextOrReasoning) return;

      const deltaText = evt.properties.delta;
      if (!deltaText || typeof deltaText !== "string") return;

      const tokens = estimateTokens(deltaText);
      pushSample(state, sessionID, tokens);

      const [, setVersion] = state.version;
      let stats = state.messageStats.get(sessionID);
      if (!stats || stats.frozen) {
        stats = {
          firstDeltaTs: Date.now(),
          totalEstTokens: 0,
          maxLiveTps: -Infinity,
          minLiveTps: Infinity,
        };
        state.messageStats.set(sessionID, stats);
      }
      stats.totalEstTokens += tokens;

      if (!state.sessionMeta.has(sessionID)) fetchSessionMeta(state, sessionID);
      setVersion((v) => v + 1);
    },
  );

  const unsubUpdated = state.api.event.on("message.updated", (raw: unknown) => {
    const evt = raw as {
      properties: {
        info: {
          role: string;
          sessionID: string;
          time?: { completed?: number };
          tokens?: { output?: number };
        };
      };
    };
    const info = evt.properties.info;
    if (info.role !== "assistant") return;

    const sessionID = info.sessionID;
    const [, setVersion] = state.version;

    if (info.time?.completed) {
      const stats = state.messageStats.get(sessionID);
      if (stats && !stats.frozen) {
        const durationMs = Math.max(
          1,
          info.time.completed - stats.firstDeltaTs,
        );
        const realTokens = readOutputTokens(info);
        const tokensForAvg =
          realTokens !== undefined ? realTokens : stats.totalEstTokens;
        const avg = (tokensForAvg / durationMs) * 1000;

        let max = stats.maxLiveTps;
        let min = stats.minLiveTps;
        if (!isFinite(max) || !isFinite(min)) {
          max = avg;
          min = avg;
        } else if (realTokens !== undefined && stats.totalEstTokens > 0) {
          const scale = realTokens / stats.totalEstTokens;
          max = max * scale;
          min = min * scale;
        }

        stats.frozen = { avg, max, min };
      }
      state.streamSamples.delete(sessionID);
      state.completedSessions.add(sessionID);
      setVersion((v) => v + 1);
    }
  });

  const unsubPartUpdated = state.api.event.on(
    "message.part.updated",
    (raw: unknown) => {
      const evt = raw as {
        properties: {
          part: { type: string; sessionID: string; state: { status: string } };
        };
      };
      const part = evt.properties.part;
      if (part.type !== "tool") return;

      const sessionID = part.sessionID;
      const pState = part.state;
      if (
        pState.status === "running" ||
        pState.status === "completed" ||
        pState.status === "error"
      ) {
        clearLiveSamples(state, sessionID);
      }
    },
  );

  const unsubSessionCreated = state.api.event.on(
    "session.created",
    (raw: unknown) => {
      const evt = raw as {
        properties: { info: { id: string; parentID?: string; title?: string } };
      };
      const info = evt.properties?.info;
      if (!info?.id) return;
      registerSubagent(state, info, { prune: true });
    },
  );

  const unsubSessionUpdated = state.api.event.on(
    "session.updated",
    (raw: unknown) => {
      const evt = raw as {
        properties: { info: { id: string; parentID?: string; title?: string } };
      };
      const info = evt.properties?.info;
      if (!info?.id) return;
      registerSubagent(state, info);
    },
  );

  const interval = setInterval(() => {
    pruneStaleSamples(state);
    const now = Date.now();
    for (const [sessionID, stats] of state.messageStats) {
      if (stats.frozen) continue;
      if (now - stats.firstDeltaTs < WARMUP_MS) continue;
      const liveTps = calcLiveTps(state, sessionID);
      if (liveTps <= 0) continue;
      if (liveTps > stats.maxLiveTps) stats.maxLiveTps = liveTps;
      if (liveTps < stats.minLiveTps) stats.minLiveTps = liveTps;
    }
    const [, setTick] = state.tick;
    setTick((t) => t + 1);
  }, 1000);

  return () => {
    unsubDelta();
    unsubUpdated();
    unsubPartUpdated();
    unsubSessionCreated();
    unsubSessionUpdated();
    clearInterval(interval);
  };
}
