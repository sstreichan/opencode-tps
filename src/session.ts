import type {
  SessionResponse,
  ChildrenResponse,
  MessagesResponse,
  PluginState,
} from "./types";

export function titleForSession(state: PluginState, sessionID: string): string {
  const meta = state.sessionMeta.get(sessionID);
  if (!meta?.title) return sessionID.slice(0, 8);
  return (
    meta.title.replace(/\s*\(@\w+ subagent\)\s*$/, "").trim() || meta.title
  );
}

export function isCompleted(state: PluginState, sessionID: string): boolean {
  if (state.completedSessions.has(sessionID)) return true;
  const status = state.api.state.session.status(sessionID);
  return status?.type === "idle";
}

export function dropSession(state: PluginState, sessionID: string) {
  state.sessionMeta.delete(sessionID);
  state.streamSamples.delete(sessionID);
  state.lastKnownTps.delete(sessionID);
  state.messageStats.delete(sessionID);
  state.completedSessions.delete(sessionID);
}

export function pruneIdleSiblings(
  state: PluginState,
  parentID: string,
  exceptID: string,
) {
  let changed = false;
  for (const [sid, meta] of state.sessionMeta) {
    if (sid === exceptID) continue;
    if (meta.parentID !== parentID) continue;
    if (isCompleted(state, sid)) {
      dropSession(state, sid);
      changed = true;
    }
  }
  if (changed) {
    const [, setMetaVersion] = state.metaVersion;
    const [, setVersion] = state.version;
    setMetaVersion((v) => v + 1);
    setVersion((v) => v + 1);
  }
}

export function registerSubagent(
  state: PluginState,
  info: { id: string; parentID?: string; title?: string },
  options?: { prune?: boolean },
) {
  state.sessionMeta.set(info.id, {
    parentID: info.parentID,
    title: info.title,
  });
  if (options?.prune && info.parentID)
    pruneIdleSiblings(state, info.parentID, info.id);
  const [, setMetaVersion] = state.metaVersion;
  setMetaVersion((v) => v + 1);
}

export async function fetchSessionMeta(state: PluginState, sessionID: string) {
  if (state.sessionMeta.has(sessionID)) return;
  state.sessionMeta.set(sessionID, {});
  try {
    const res = (await state.api.client.session.get({
      sessionID,
    })) as unknown as SessionResponse;
    if (res?.data?.id) registerSubagent(state, res.data);
  } catch {
    // ignore; retry on next delta if cleared
  }
}

export async function seedChildren(state: PluginState, parentID: string) {
  try {
    const res = (await state.api.client.session.children({
      sessionID: parentID,
    })) as unknown as ChildrenResponse;
    if (!Array.isArray(res?.data)) return;

    const activeChildren = await Promise.all(
      res.data
        .filter((child) => child?.id)
        .map(async (child) => {
          try {
            const msgs = (await state.api.client.session.messages({
              sessionID: child.id,
            })) as unknown as MessagesResponse;
            const data = msgs?.data ?? [];
            const lastAssistant = [...data]
              .reverse()
              .find((m) => m?.info?.role === "assistant");
            const completed = lastAssistant?.info?.time?.completed;
            if (completed) {
              state.completedSessions.add(child.id);
              return null;
            }
            return child;
          } catch {
            return child;
          }
        }),
    );

    for (const child of activeChildren) {
      if (child) registerSubagent(state, child);
    }
  } catch {
    // ignore
  }
}
