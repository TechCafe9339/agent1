"use client";

/**
 * Real-time updates over Socket.IO.
 *
 * Put this file at  lib/realtime.ts  (next to lib/api.ts).
 * Install:          npm i socket.io-client
 * Server address:   NEXT_PUBLIC_SOCKET_URL (the BACKEND address, not the frontend's).
 *                   If it is not set, the origin of NEXT_PUBLIC_API_URL is used,
 *                   and after that http://127.0.0.1:8000, the same default as lib/api.ts.
 *                   The Django backend serves the sockets on the same address as the API.
 *
 * The page keeps working without a socket: when the server is unreachable the
 * hook reports "offline" and the existing fetch-based refresh still applies.
 */

import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

export type ConnectionState = "connecting" | "live" | "offline";

export type ProjectStatusEvent = { projectId: number; status: string };

export type TaskEvent = {
  projectId: number;
  taskId: number;
  status: string;
  title?: string;
  /** Tasks finished so far, and the total, when the server knows them. */
  completed?: number;
  total?: number;
};

export type ActivityEvent = { projectId: number; message: string; stage?: string; at?: string };

export type FileEvent = {
  projectId: number;
  path: string;
  action: "created" | "updated" | "deleted";
};

/** A chat message was saved on the server (a user message or the assistant's reply). */
export type ChatMessageEvent = {
  projectId: number;
  message: { id: number; role: "user" | "assistant"; content: string; timestamp: string };
};

/** The server started or finished writing a chat reply. */
export type ChatStatusEvent = { projectId: number; generating: boolean };

function resolveUrl(): string | undefined {
  const explicit = process.env.NEXT_PUBLIC_SOCKET_URL;
  if (explicit) return explicit;

  const api = process.env.NEXT_PUBLIC_API_URL ?? process.env.NEXT_PUBLIC_API_BASE_URL;
  if (api) {
    try {
      return new URL(api).origin;
    } catch {
      // A relative API path such as "/api" has no origin, so fall through.
    }
  }

  // The same default address lib/api.ts uses for the Django API.
  return "http://127.0.0.1:8000";
}

let socket: Socket | null = null;

/** One shared connection for the whole app. */
function getSocket(): Socket | null {
  if (typeof window === "undefined") return null;

  if (!socket) {
    const url = resolveUrl();
    if (!url) return null;

    socket = io(url, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelayMax: 5000,
    });
  }
  return socket;
}

/*
 * Several components can follow the same project at once (the project page and
 * its Chat tab, for example). A room is only left when the last one lets go,
 * so closing one component never cuts off another.
 */
const retained = new Map<string, number>();

function retain(key: string) {
  retained.set(key, (retained.get(key) ?? 0) + 1);
}

/** Returns true when nobody else is still using the room. */
function release(key: string): boolean {
  const count = (retained.get(key) ?? 0) - 1;
  if (count <= 0) {
    retained.delete(key);
    return true;
  }
  retained.set(key, count);
  return false;
}

type RealtimeOptions = {
  /** Follow every project (home page). */
  all?: boolean;
  /** Follow a single project (workspace page, chat). */
  projectId?: number | string;
  onStatus?: (event: ProjectStatusEvent) => void;
  onTask?: (event: TaskEvent) => void;
  onActivity?: (event: ActivityEvent) => void;
  onFile?: (event: FileEvent) => void;
  onChatMessage?: (event: ChatMessageEvent) => void;
  onChatStatus?: (event: ChatStatusEvent) => void;
  /** Called after the connection comes back, so the page can re-read anything it missed. */
  onResync?: () => void;
};

export function useRealtime(options: RealtimeOptions): ConnectionState {
  const { all, projectId } = options;
  const [state, setState] = useState<ConnectionState>("connecting");

  // Always call the latest handlers without resubscribing on every render.
  const handlers = useRef(options);
  useEffect(() => {
    handlers.current = options;
  });

  useEffect(() => {
    const client = getSocket();
    if (!client) {
      setState("offline");
      return;
    }

    const numericId = projectId === undefined ? undefined : Number(projectId);
    const followsProject = numericId !== undefined && Number.isInteger(numericId);
    const projectKey = `project:${numericId}`;

    if (all) retain("all");
    if (followsProject) retain(projectKey);

    let connectedBefore = false;

    const subscribe = () => {
      if (all) client.emit("subscribe:all");
      if (followsProject) client.emit("subscribe:project", numericId);
    };

    const handleConnect = () => {
      setState("live");
      subscribe(); // rooms are lost on reconnect, so join again every time
      if (connectedBefore) handlers.current.onResync?.();
      connectedBefore = true;
    };
    const handleDown = () => setState("offline");
    const handleRetry = () => setState("connecting");

    const onStatus = (event: ProjectStatusEvent) => handlers.current.onStatus?.(event);
    const onTask = (event: TaskEvent) => handlers.current.onTask?.(event);
    const onActivity = (event: ActivityEvent) => handlers.current.onActivity?.(event);
    const onFile = (event: FileEvent) => handlers.current.onFile?.(event);
    const onChatMessage = (event: ChatMessageEvent) => handlers.current.onChatMessage?.(event);
    const onChatStatus = (event: ChatStatusEvent) => handlers.current.onChatStatus?.(event);

    client.on("connect", handleConnect);
    client.on("disconnect", handleDown);
    client.on("connect_error", handleDown);
    client.io.on("reconnect_attempt", handleRetry);
    client.on("project:status", onStatus);
    client.on("task:update", onTask);
    client.on("generation:activity", onActivity);
    client.on("file:changed", onFile);
    client.on("chat:message", onChatMessage);
    client.on("chat:status", onChatStatus);

    if (client.connected) handleConnect();
    else setState("connecting");

    return () => {
      client.off("connect", handleConnect);
      client.off("disconnect", handleDown);
      client.off("connect_error", handleDown);
      client.io.off("reconnect_attempt", handleRetry);
      client.off("project:status", onStatus);
      client.off("task:update", onTask);
      client.off("generation:activity", onActivity);
      client.off("file:changed", onFile);
      client.off("chat:message", onChatMessage);
      client.off("chat:status", onChatStatus);

      const leaveAll = all ? release("all") : false;
      const leaveProject = followsProject ? release(projectKey) : false;

      if (client.connected) {
        if (leaveAll) client.emit("unsubscribe:all");
        if (leaveProject) client.emit("unsubscribe:project", numericId);
      }
    };
  }, [all, projectId]);

  return state;
}