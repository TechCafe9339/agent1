"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiGet, apiPost } from "../../../lib/api";

export type PreviewStatus = "stopped" | "starting" | "running" | "failed";

export type PreviewController = {
  status: PreviewStatus;
  url: string | null;
  logs: string[];
  error: string | null;
  busy: boolean;
  startedAt: number | null;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  restart: () => Promise<void>;
  refresh: () => Promise<void>;
  clearLogs: () => void;
};

type PreviewResponse = {
  status?: string;
  url?: string | null;
  preview_url?: string | null;
  frontend_url?: string | null;
  backend_url?: string | null;
  logs?: string[] | string | null;
  error?: string | null;
  message?: string | null;
  services?: Record<string, string>;
};

const API = {
  state: (id: string) => `/projects/${id}/preview/`,
  start: (id: string) => `/projects/${id}/preview/start/`,
  stop: (id: string) => `/projects/${id}/preview/stop/`,
};

const MAX_LOG_LINES = 500;

function toStatus(raw?: string): PreviewStatus {
  const value = (raw ?? "").toLowerCase().trim();

  if (["failed", "error", "crashed", "terminated"].includes(value)) return "failed";
  if (["stopped", "idle", "not_running"].includes(value)) return "stopped";
  if (["starting", "installing", "building", "queued", "pending"].includes(value)) return "starting";
  if (["running", "ready", "live", "online"].includes(value)) return "running";

  return "stopped";
}

function toLogs(raw: PreviewResponse["logs"]): string[] {
  const lines = Array.isArray(raw)
    ? raw.map(String)
    : typeof raw === "string"
      ? raw.split(/\r?\n/)
      : [];
  return lines.filter(Boolean).slice(-MAX_LOG_LINES);
}

function getPreviewUrl(data: PreviewResponse): string | null {
  return data.url ?? data.preview_url ?? data.frontend_url ?? null;
}

function messageFrom(data: unknown, fallback: string): string {
  if (data instanceof Error && data.message) return data.message;
  if (typeof data === "string" && data.trim()) return data;
  return fallback;
}

export function usePreview(projectId: string): PreviewController {
  const [status, setStatus] = useState<PreviewStatus>("stopped");
  const [url, setUrl] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [tick, setTick] = useState(0);

  const mounted = useRef(false);
  const busyRef = useRef(false);
  const requestId = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      requestId.current += 1;
    };
  }, []);

  const apply = useCallback((data: PreviewResponse) => {
    const nextStatus = toStatus(data.status);
    const nextUrl = getPreviewUrl(data);

    setStatus(nextStatus);
    setUrl(nextStatus === "running" || nextStatus === "starting" ? nextUrl : null);

    if (data.logs != null) setLogs(toLogs(data.logs));

    if (nextStatus === "failed") {
      setError(data.error ?? data.message ?? "Project startup failed. Check service logs.");
    } else {
      setError(null);
    }

    if (nextStatus === "stopped") setStartedAt(null);
  }, []);

  const refresh = useCallback(async () => {
    const id = ++requestId.current;
    try {
      const data = await apiGet<PreviewResponse>(API.state(projectId));
      if (!mounted.current || id !== requestId.current) return;
      apply(data ?? {});
    } catch (err) {
      if (!mounted.current || id !== requestId.current) return;
      // Preserve last known state, but surface a connection problem if no state is known.
      setError((current) => current ?? messageFrom(err, "Could not contact the preview API."));
    } finally {
      if (mounted.current) setTick((value) => value + 1);
    }
  }, [projectId, apply]);

  useEffect(() => {
    setStatus("stopped");
    setUrl(null);
    setLogs([]);
    setError(null);
    setStartedAt(null);
    void refresh();
  }, [projectId, refresh]);

  useEffect(() => {
    if (status !== "starting" && status !== "running") return;
    const timer = window.setTimeout(() => void refresh(), status === "starting" ? 1500 : 5000);
    return () => window.clearTimeout(timer);
  }, [status, tick, refresh]);

  const start = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const operationId = ++requestId.current;

    setStatus("starting");
    setUrl(null);
    setError(null);
    setLogs([]);
    setStartedAt(Date.now());

    try {
      const data = await apiPost<PreviewResponse>(API.start(projectId), {});
      if (!mounted.current || operationId !== requestId.current) return;
      apply({ ...data, status: data?.status ?? "starting" });
      setTick((value) => value + 1);
    } catch (err) {
      if (!mounted.current || operationId !== requestId.current) return;
      const message = messageFrom(err, "Could not start the project.");
      setStatus("failed");
      setUrl(null);
      setError(message);
      setLogs((current) => [...current, `[preview] ${message}`].slice(-MAX_LOG_LINES));
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [projectId, apply]);

  const stop = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const operationId = ++requestId.current;
    try {
      await apiPost(API.stop(projectId), {});
      if (!mounted.current || operationId !== requestId.current) return;
      setStatus("stopped");
      setUrl(null);
      setStartedAt(null);
      setError(null);
      setLogs((current) => [...current, "Project stopped."].slice(-MAX_LOG_LINES));
    } catch (err) {
      if (!mounted.current || operationId !== requestId.current) return;
      const message = messageFrom(err, "Could not stop the project.");
      setError(message);
      setLogs((current) => [...current, `[preview] ${message}`].slice(-MAX_LOG_LINES));
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [projectId]);

  const restart = useCallback(async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const operationId = ++requestId.current;

    setStatus("starting");
    setUrl(null);
    setError(null);
    setStartedAt(Date.now());

    try {
      await apiPost(API.stop(projectId), {});
      if (!mounted.current || operationId !== requestId.current) return;
      setLogs(["Previous preview stopped. Restarting services..."]);

      const data = await apiPost<PreviewResponse>(API.start(projectId), {});
      if (!mounted.current || operationId !== requestId.current) return;
      apply({ ...data, status: data?.status ?? "starting" });
      setTick((value) => value + 1);
    } catch (err) {
      if (!mounted.current || operationId !== requestId.current) return;
      const message = messageFrom(err, "Could not restart the project.");
      setStatus("failed");
      setUrl(null);
      setError(message);
      setLogs((current) => [...current, `[preview] ${message}`].slice(-MAX_LOG_LINES));
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }, [projectId, apply]);

  const clearLogs = useCallback(() => setLogs([]), []);

  return { status, url, logs, error, busy, startedAt, start, stop, restart, refresh, clearLogs };
}
