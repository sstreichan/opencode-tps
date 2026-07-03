/** @jsxImportSource @opentui/solid */
import { createSignal, createMemo, For, Show } from "solid-js"
import type { TuiPlugin } from "@opencode-ai/plugin/tui"

interface StreamSample {
  tokens: number
  timestamp: number
}

interface MessageStats {
  firstDeltaTs: number
  totalEstTokens: number
  maxLiveTps: number
  minLiveTps: number
  frozen?: { avg: number; max: number; min: number }
}

interface SessionMeta {
  parentID?: string
  title?: string
}

interface PartDeltaEvent {
  type: "message.part.delta"
  properties: {
    sessionID: string
    messageID: string
    partID: string
    field: string
    delta: string
  }
}

const tui: TuiPlugin = async (api, _options, _meta) => {
  const streamSamples = new Map<string, StreamSample[]>()
  const messageStats = new Map<string, MessageStats>()
  const sessionMeta = new Map<string, SessionMeta>()
  const lastKnownTps = new Map<string, number>()
  const completedStats = new Map<string, NonNullable<MessageStats["frozen"]>>()
  const completedSessions = new Set<string>()

  const KV_KEY = "opencode-tps:completed-stats"
  // ponytail: KV grows unbounded (~60 bytes/session), cap at N entries if monitoring shows bloat
  try {
    const persisted = api.kv.get<Record<string, { avg: number; max: number; min: number }>>(KV_KEY, {})
    for (const [sid, stats] of Object.entries(persisted)) {
      if (stats && typeof stats === "object" && "avg" in stats && "max" in stats && "min" in stats) {
        completedStats.set(sid, stats as { avg: number; max: number; min: number })
      }
    }
  } catch { /* kv not available */ }

  const [version, setVersion] = createSignal(0)
  const [tick, setTick] = createSignal(0)
  const [metaVersion, setMetaVersion] = createSignal(0)

  const LIVE_STALE_MS = 1500
  const SAMPLE_WINDOW_MS = 5000
  const SINGLE_SAMPLE_MIN_MS = 250
  const SINGLE_SAMPLE_MAX_MS = 1000
  const WARMUP_MS = 3000
  const BYTES_PER_TOKEN_ESTIMATE = 5.5

  function estimateTokens(text: string): number {
    const byteLen = new TextEncoder().encode(text).length
    return Math.max(1, Math.ceil(byteLen / BYTES_PER_TOKEN_ESTIMATE))
  }

  function readOutputTokens(info: unknown): number | undefined {
    if (!info || typeof info !== "object") return undefined
    const tokens = (info as { tokens?: { output?: unknown } }).tokens
    const output = tokens?.output
    if (typeof output === "number" && isFinite(output) && output > 0) return output
    return undefined
  }

  function formatTps(value: number): string {
    if (value < 0) return "-"
    if (value < 10) return value.toFixed(2)
    if (value < 100) return value.toFixed(1)
    return Math.round(value).toString()
  }

  function clearLiveSamples(sessionID: string) {
    if (streamSamples.has(sessionID)) {
      streamSamples.delete(sessionID)
      setVersion((v) => v + 1)
    }
  }

  function singleSampleDuration(samples: StreamSample[]): number {
    const elapsed = Date.now() - samples[0].timestamp
    return Math.max(SINGLE_SAMPLE_MIN_MS, Math.min(elapsed, SINGLE_SAMPLE_MAX_MS))
  }

  function activeDurationMs(samples: StreamSample[]): number {
    if (samples.length < 2) {
      return singleSampleDuration(samples)
    }
    let total = 0
    for (let i = 1; i < samples.length; i++) {
      total += Math.max(0, samples[i].timestamp - samples[i - 1].timestamp)
    }
    const now = Date.now()
    const tail = now - samples[samples.length - 1].timestamp
    total += Math.min(tail, 1000)
    return Math.max(total, SINGLE_SAMPLE_MIN_MS)
  }

  function calcLiveTps(sessionID: string): number {
    if (api.state.session.status(sessionID)?.type === "idle") return -1

    const samples = streamSamples.get(sessionID) ?? []
    const now = Date.now()
    const cutoff = now - SAMPLE_WINDOW_MS
    const active = samples.filter((s) => s.timestamp >= cutoff)

    if (active.length === 0) return -1

    const last = active[active.length - 1]
    if (now - last.timestamp > LIVE_STALE_MS) return -1

    const totalTokens = active.reduce((sum, s) => sum + s.tokens, 0)
    const durationMs = activeDurationMs(active)
    if (durationMs <= 0) return -1

    const value = (totalTokens / durationMs) * 1000
    lastKnownTps.set(sessionID, value)
    return value
  }

  function displayTps(sessionID: string): number {
    const live = calcLiveTps(sessionID)
    if (live >= 0) return live
    return lastKnownTps.get(sessionID) ?? -1
  }

  function titleForSession(sessionID: string): string {
    const meta = sessionMeta.get(sessionID)
    if (!meta?.title) return sessionID.slice(0, 8)
    return meta.title.replace(/\s*\(@\w+ subagent\)\s*$/, "").trim() || meta.title
  }

  function isCompleted(sessionID: string): boolean {
    if (completedSessions.has(sessionID)) return true
    const status = api.state.session.status(sessionID)
    return status?.type === "idle"
  }

  function dropSession(sessionID: string) {
    sessionMeta.delete(sessionID)
    streamSamples.delete(sessionID)
    lastKnownTps.delete(sessionID)
    messageStats.delete(sessionID)
    completedStats.delete(sessionID)
    completedSessions.delete(sessionID)
    // note: KV still holds the entry; on reload it reappears (conscious trade-off)
  }

  function pruneIdleSiblings(parentID: string, exceptID: string) {
    let changed = false
    for (const [sid, meta] of sessionMeta) {
      if (sid === exceptID) continue
      if (meta.parentID !== parentID) continue
      if (isCompleted(sid)) {
        dropSession(sid)
        changed = true
      }
    }
    if (changed) {
      setMetaVersion((v) => v + 1)
      setVersion((v) => v + 1)
    }
  }

  function registerSubagent(info: { id: string; parentID?: string; title?: string }, options?: { prune?: boolean }) {
    sessionMeta.set(info.id, { parentID: info.parentID, title: info.title })
    if (options?.prune && info.parentID) pruneIdleSiblings(info.parentID, info.id)
    setMetaVersion((v) => v + 1)
  }

  async function fetchSessionMeta(sessionID: string) {
    if (sessionMeta.has(sessionID)) return
    sessionMeta.set(sessionID, {})
    try {
      const res = await api.client.session.get({ sessionID })
      const info = (res as any)?.data
      if (info?.id) registerSubagent(info)
    } catch {
      // ignore; retry on next delta if cleared
    }
  }

  async function seedChildren(parentID: string) {
    try {
      const res = await api.client.session.children({ sessionID: parentID })
      const list = (res as any)?.data
      if (!Array.isArray(list)) return

      const activeChildren = await Promise.all(
        list
          .filter((child: any) => child?.id)
          .map(async (child: any) => {
            try {
              const msgs = await api.client.session.messages({ sessionID: child.id })
              const data = (msgs as any)?.data ?? []
              const lastAssistant = [...data].reverse().find((m: any) => m?.info?.role === "assistant")
              const completed = lastAssistant?.info?.time?.completed
              if (completed) {
                completedSessions.add(child.id)
                return null
              }
              return child
            } catch {
              return child
            }
          }),
      )

      for (const child of activeChildren) {
        if (child) registerSubagent(child)
      }
    } catch {
      // ignore
    }
  }

  const unsubDelta = api.event.on("message.part.delta" as unknown as "message.part.delta", (evt: PartDeltaEvent) => {
    const sessionID = evt.properties.sessionID
    if (!sessionID) return
    if (api.state.session.status(sessionID)?.type === "idle") return

    if (evt.properties.field !== "text") return

    const parts = api.state.part(evt.properties.messageID)
    const hasTextOrReasoning = parts?.some((p) => p.type === "text" || p.type === "reasoning")
    if (!hasTextOrReasoning) return

    const deltaText = evt.properties.delta
    if (!deltaText || typeof deltaText !== "string") return

    const tokens = estimateTokens(deltaText)
    const now = Date.now()

    let samples = streamSamples.get(sessionID)
    if (!samples) {
      samples = []
      streamSamples.set(sessionID, samples)
    }
    samples.push({ tokens, timestamp: now })

    let stats = messageStats.get(sessionID)
    if (!stats || stats.frozen) {
      stats = {
        firstDeltaTs: now,
        totalEstTokens: 0,
        maxLiveTps: -Infinity,
        minLiveTps: Infinity,
      }
      messageStats.set(sessionID, stats)
    }
    stats.totalEstTokens += tokens

    if (!sessionMeta.has(sessionID)) fetchSessionMeta(sessionID)

    setVersion((v) => v + 1)
  })

  const unsubUpdated = api.event.on("message.updated", (evt) => {
    const info = evt.properties.info
    if (info.role !== "assistant") return

    const sessionID = info.sessionID

    if (info.time.completed) {
      const stats = messageStats.get(sessionID)
      if (stats && !stats.frozen) {
        const durationMs = Math.max(1, (info.time.completed as number) - stats.firstDeltaTs)

        const realTokens = readOutputTokens(info)
        const tokensForAvg = realTokens !== undefined ? realTokens : stats.totalEstTokens
        const avg = (tokensForAvg / durationMs) * 1000

        let max = stats.maxLiveTps
        let min = stats.minLiveTps
        if (!isFinite(max) || !isFinite(min)) {
          max = avg
          min = avg
        } else if (realTokens !== undefined && stats.totalEstTokens > 0) {
          const scale = realTokens / stats.totalEstTokens
          max = max * scale
          min = min * scale
        }

        stats.frozen = { avg, max, min }
        completedStats.set(sessionID, { avg, max, min })
        try { api.kv.set(KV_KEY, Object.fromEntries(completedStats)) } catch { /* ignore */ }
      }
      streamSamples.delete(sessionID)
      completedSessions.add(sessionID)
      setVersion((v) => v + 1)
    }
  })

  const unsubPartUpdated = api.event.on("message.part.updated", (evt) => {
    const part = evt.properties.part
    if (part.type !== "tool") return

    const sessionID = part.sessionID
    const state = part.state

    if (state.status === "running" || state.status === "completed" || state.status === "error") {
      clearLiveSamples(sessionID)
    }
  })

  const unsubSessionCreated = api.event.on("session.created" as any, (evt: any) => {
    const info = evt.properties?.info
    if (!info?.id) return
    registerSubagent(info, { prune: true })
  })

  const unsubSessionUpdated = api.event.on("session.updated" as any, (evt: any) => {
    const info = evt.properties?.info
    if (!info?.id) return
    registerSubagent(info)
  })

  const interval = setInterval(() => {
    const now = Date.now()
    const cutoff = now - SAMPLE_WINDOW_MS
    for (const [sessionID, samples] of streamSamples) {
      const pruned = samples.filter((s) => s.timestamp >= cutoff)
      if (pruned.length !== samples.length) {
        streamSamples.set(sessionID, pruned)
      }
    }
    for (const [sessionID, stats] of messageStats) {
      if (stats.frozen) continue
      if (now - stats.firstDeltaTs < WARMUP_MS) continue
      const liveTps = calcLiveTps(sessionID)
      if (liveTps <= 0) continue
      if (liveTps > stats.maxLiveTps) stats.maxLiveTps = liveTps
      if (liveTps < stats.minLiveTps) stats.minLiveTps = liveTps
    }
    setTick((t) => t + 1)
  }, 1000)

  api.lifecycle.onDispose(() => {
    unsubDelta()
    unsubUpdated()
    unsubPartUpdated()
    unsubSessionCreated()
    unsubSessionUpdated()
    clearInterval(interval)
    messageStats.clear()
    sessionMeta.clear()
    lastKnownTps.clear()
    streamSamples.clear()
    completedStats.clear()
    completedSessions.clear()
  })

  api.slots.register({
    order: 350,
    slots: {
      session_prompt_right(ctx, props) {
        const sessionID = props.session_id

        const display = createMemo(() => {
          version()
          tick()

          const stats = messageStats.get(sessionID)
          if (stats?.frozen) {
            const { avg, max, min } = stats.frozen
            return `tok/s ${formatTps(avg)} avg · ↑${formatTps(max)} ↓${formatTps(min)}`
          }

          const live = displayTps(sessionID)
          if (live >= 0) {
            const prev = completedStats.get(sessionID)
            if (prev) return `tok/s ${formatTps(live)} · avg ${formatTps(prev.avg)}`
            return `tok/s ${formatTps(live)}`
          }

          const prev = completedStats.get(sessionID)
          if (prev) {
            const { avg, max, min } = prev
            return `tok/s ${formatTps(avg)} avg · ↑${formatTps(max)} ↓${formatTps(min)}`
          }
          return "tok/s -"
        })

        const textMuted = ctx.theme.current.textMuted

        return (
          <text fg={textMuted}>
            {display()}
          </text>
        )
      },

      sidebar_content(ctx, props) {
        const parentID = props.session_id
        if (!sessionMeta.has(parentID)) fetchSessionMeta(parentID)
        seedChildren(parentID)

        const entries = createMemo(() => {
          version()
          tick()
          metaVersion()

          const parentTps = displayTps(parentID)
          const parentTitle = titleForSession(parentID) || "Main"

          const children: { sessionID: string; label: string; tps: number }[] = []
          for (const [sid, meta] of sessionMeta) {
            if (sid === parentID) continue
            if (meta.parentID !== parentID) continue
            children.push({
              sessionID: sid,
              label: titleForSession(sid),
              tps: displayTps(sid),
            })
          }
          children.sort((a, b) => a.label.localeCompare(b.label))

          if (children.length === 0) return null

          const rows = [
            { sessionID: parentID, label: parentTitle, tps: parentTps },
            ...children,
          ]

          const live = rows.map((r) => r.tps).filter((t) => t >= 0)
          const avg = live.length > 0 ? live.reduce((a, b) => a + b, 0) / live.length : -1

          return { rows, avg }
        })

        const theme = () => ctx.theme.current

        return (
          <Show when={entries()}>
            {(data: NonNullable<ReturnType<typeof entries>>) => (
              <box>
                <box flexDirection="row" justifyContent="space-between">
                  <text fg={theme().text}>
                    <b>TPS</b>
                  </text>
                  <text fg={theme().textMuted}>avg {formatTps(data.avg)}</text>
                </box>
                <For each={data.rows}>
                  {(row) => (
                    <box flexDirection="row" justifyContent="space-between">
                      <text fg={theme().textMuted}>{row.label}</text>
                      <text fg={theme().textMuted}>{formatTps(row.tps)}</text>
                    </box>
                  )}
                </For>
              </box>
            )}
          </Show>
        )
      },
    },
  })
}

export default {
  id: "opencode-tps",
  tui,
}
