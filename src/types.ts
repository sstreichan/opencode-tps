import type { TuiPluginApi } from "@opencode-ai/plugin/tui";
import type { Signal } from "solid-js";

export interface StreamSample {
  tokens: number;
  timestamp: number;
}

export interface MessageStats {
  firstDeltaTs: number;
  totalEstTokens: number;
  maxLiveTps: number;
  minLiveTps: number;
  frozen?: { avg: number; max: number; min: number };
}

export interface SessionMeta {
  parentID?: string;
  title?: string;
}

export interface PartDeltaEvent {
  type: "message.part.delta";
  properties: {
    sessionID: string;
    messageID: string;
    partID: string;
    field: string;
    delta: string;
  };
}

export interface SessionCreatedEvent {
  type: "session.created";
  properties: {
    info: { id: string; parentID?: string; title?: string };
  };
}

export interface SessionUpdatedEvent {
  type: "session.updated";
  properties: {
    info: { id: string; parentID?: string; title?: string };
  };
}

export interface MessageUpdatedInfo {
  role: string;
  sessionID: string;
  time?: { completed?: number };
  tokens?: { output?: number };
}

export interface SessionResponse {
  data?: { id: string; parentID?: string; title?: string };
}

export interface ChildrenResponse {
  data?: Array<{ id: string; parentID?: string; title?: string }>;
}

export interface MessagesResponse {
  data?: Array<{ info?: { role?: string; time?: { completed?: number } } }>;
}

export interface PluginState {
  streamSamples: Map<string, StreamSample[]>;
  messageStats: Map<string, MessageStats>;
  sessionMeta: Map<string, SessionMeta>;
  lastKnownTps: Map<string, number>;
  completedSessions: Set<string>;
  api: TuiPluginApi;
  version: Signal<number>;
  tick: Signal<number>;
  metaVersion: Signal<number>;
}
