/** @jsxImportSource @opentui/solid */
import { createMemo } from "solid-js";
import { displayTps } from "./tps-calc";
import { formatTps } from "./tps-calc";
import { titleForSession, fetchSessionMeta, seedChildren } from "./session";
import type { PluginState } from "./types";

export function registerSlots(state: PluginState) {
  state.api.slots.register({
    order: 350,
    slots: {
      session_prompt_right(ctx, props) {
        const sessionID = props.session_id;
        const [getVersion] = state.version;
        const [getTick] = state.tick;

        const display = createMemo(() => {
          getVersion();
          getTick();

          const stats = state.messageStats.get(sessionID);
          if (stats?.frozen) {
            const { avg, max, min } = stats.frozen;
            return `tok/s ${formatTps(avg)} avg · ↑${formatTps(max)} ↓${formatTps(min)}`;
          }

          const live = displayTps(state, sessionID);
          if (live >= 0) return `tok/s ${formatTps(live)}`;
          return "tok/s -";
        });

        const textMuted = ctx.theme.current.textMuted;
        return <text fg={textMuted}>{display as any}</text>;
      },

      sidebar_content(ctx, props) {
        const parentID = props.session_id;
        if (!state.sessionMeta.has(parentID)) fetchSessionMeta(state, parentID);
        seedChildren(state, parentID);

        const [getVersion] = state.version;
        const [getTick] = state.tick;
        const [getMetaVersion] = state.metaVersion;

        const theme = ctx.theme.current;

        return (
          <box>
            {
              (() => {
                getVersion();
                getTick();
                getMetaVersion();

                const parentTps = displayTps(state, parentID);
                const parentTitle = titleForSession(state, parentID) || "Main";

                const children: {
                  sessionID: string;
                  label: string;
                  tps: number;
                }[] = [];
                for (const [sid, meta] of state.sessionMeta) {
                  if (sid === parentID) continue;
                  if (meta.parentID !== parentID) continue;
                  children.push({
                    sessionID: sid,
                    label: titleForSession(state, sid),
                    tps: displayTps(state, sid),
                  });
                }
                children.sort((a, b) => a.label.localeCompare(b.label));

                if (children.length === 0) return null;

                const rows = [
                  {
                    sessionID: parentID,
                    label: parentTitle,
                    tps: parentTps,
                  },
                  ...children,
                ];
                const live = rows.map((r) => r.tps).filter((t) => t >= 0);
                const avg =
                  live.length > 0
                    ? live.reduce((a, b) => a + b, 0) / live.length
                    : -1;

                return (
                  <>
                    <box flexDirection="row" justifyContent="space-between">
                      <text fg={theme.text}>
                        <b>TPS</b>
                      </text>
                      <text fg={theme.textMuted}>avg {formatTps(avg)}</text>
                    </box>
                    {rows.map((row) => (
                      <box flexDirection="row" justifyContent="space-between">
                        <text fg={theme.textMuted}>{row.label}</text>
                        <text fg={theme.textMuted}>{formatTps(row.tps)}</text>
                      </box>
                    ))}
                  </>
                );
              }) as any
            }
          </box>
        );
      },
    },
  });
}
