"use client";

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import type { PreviewController, PreviewStatus } from "./Usepreview";

/* -------------------------------------------------------------------------- */
/* Types & constants                                                          */
/* -------------------------------------------------------------------------- */

type Device = "desktop" | "tablet" | "mobile";

type Props = {
  preview: PreviewController;
  /** Files with unsaved edits in the editor (not part of the running project). */
  dirtyCount: number;
  onOpenFiles: () => void;
};

const DEVICES: { key: Device; label: string; width: string }[] = [
  { key: "desktop", label: "Desktop", width: "100%" },
  { key: "tablet", label: "Tablet", width: "768px" },
  { key: "mobile", label: "Mobile", width: "390px" },
];

const STATUS_META: Record<PreviewStatus, { label: string; dot: string; text: string }> = {
  stopped: { label: "Stopped", dot: "bg-slate-500", text: "text-slate-400" },
  starting: { label: "Starting", dot: "bg-amber-400 animate-pulse", text: "text-amber-300" },
  running: { label: "Running", dot: "bg-emerald-400", text: "text-emerald-300" },
  failed: { label: "Failed", dot: "bg-red-400", text: "text-red-300" },
};

/* -------------------------------------------------------------------------- */
/* Small pieces                                                               */
/* -------------------------------------------------------------------------- */

function Icon({ name, className = "h-4 w-4" }: { name: string; className?: string }) {
  const common = {
    className,
    fill: "none",
    viewBox: "0 0 24 24",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  switch (name) {
    case "play":
      return (
        <svg {...common} fill="currentColor" stroke="none">
          <path d="M7 4.5v15a1 1 0 001.5.86l12-7.5a1 1 0 000-1.72l-12-7.5A1 1 0 007 4.5z" />
        </svg>
      );
    case "stop":
      return (
        <svg {...common} fill="currentColor" stroke="none">
          <rect x="6" y="6" width="12" height="12" rx="2" />
        </svg>
      );
    case "refresh":
      return (
        <svg {...common}>
          <path d="M20 11a8 8 0 10-2.3 5.7" />
          <path d="M20 4v7h-7" />
        </svg>
      );
    case "copy":
      return (
        <svg {...common}>
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15V6a2 2 0 012-2h9" />
        </svg>
      );
    case "check":
      return (
        <svg {...common}>
          <path d="M5 13l4 4L19 7" />
        </svg>
      );
    case "external":
      return (
        <svg {...common}>
          <path d="M14 4h6v6M20 4l-9 9" />
          <path d="M18 14v4a2 2 0 01-2 2H6a2 2 0 01-2-2V8a2 2 0 012-2h4" />
        </svg>
      );
    case "terminal":
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M7 9l3 3-3 3M13 15h4" />
        </svg>
      );
    case "globe":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9S14.5 18.3 12 21c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" />
        </svg>
      );
    case "desktop":
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="12" rx="2" />
          <path d="M8 20h8M12 16v4" />
        </svg>
      );
    case "tablet":
      return (
        <svg {...common}>
          <rect x="5" y="3" width="14" height="18" rx="2" />
          <path d="M11 18h2" />
        </svg>
      );
    case "mobile":
      return (
        <svg {...common}>
          <rect x="7" y="3" width="10" height="18" rx="2" />
          <path d="M11 18h2" />
        </svg>
      );
    case "alert":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 8v5M12 16.5v.01" />
        </svg>
      );
    case "close":
      return (
        <svg {...common}>
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      );
    default:
      return null;
  }
}

function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" className="opacity-25" />
      <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function ToolButton({
  label,
  onClick,
  disabled,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`rounded-md p-1.5 transition disabled:opacity-40 ${active
        ? "bg-slate-800 text-white"
        : "text-slate-400 hover:bg-slate-800 hover:text-white disabled:hover:bg-transparent disabled:hover:text-slate-400"
        }`}
    >
      {children}
    </button>
  );
}

function logTone(line: string) {
  if (/(error|err!|failed|exception|cannot find)/i.test(line)) return "text-red-300";
  if (/warn/i.test(line)) return "text-amber-300";
  return "text-slate-300";
}

/* -------------------------------------------------------------------------- */
/* Preview                                                                    */
/* -------------------------------------------------------------------------- */

export default function ProjectPreview({ preview, dirtyCount, onOpenFiles }: Props) {
  const { status, url, logs, error, busy, startedAt } = preview;

  const [device, setDevice] = useState<Device>("desktop");
  const [nonce, setNonce] = useState(0);
  const [frameLoading, setFrameLoading] = useState(true);
  const [logsOpen, setLogsOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  const logEndRef = useRef<HTMLDivElement | null>(null);

  const meta = STATUS_META[status];
  const live = status === "running" && !!url;
  const starting = status === "starting";
  const working = busy || starting;
  const frameWidth = DEVICES.find((d) => d.key === device)?.width ?? "100%";

  // Show the loading overlay again whenever the frame reloads.
  useEffect(() => {
    setFrameLoading(true);
  }, [url, nonce]);

  // Open the logs automatically when something goes wrong.
  useEffect(() => {
    if (status === "failed") setLogsOpen(true);
  }, [status]);

  // Elapsed-time counter while starting.
  useEffect(() => {
    if (!starting || !startedAt) {
      setElapsed(0);
      return;
    }
    const update = () => setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [starting, startedAt]);

  // Keep the newest log line in view.
  useEffect(() => {
    if (logsOpen) logEndRef.current?.scrollIntoView({ block: "end" });
  }, [logs, logsOpen]);

  async function copyLink() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard can be unavailable in insecure contexts */
    }
  }

  const mixedContent =
    live &&
    typeof window !== "undefined" &&
    window.location.protocol === "https:" &&
    (url ?? "").startsWith("http:");

  const lastLine = [...logs].reverse().find((line) => line.trim());
  console.log("[Preview Debug]", {
    status,
    url,
    live,
    frameLoading,
  });

  
  return (
    <div className="flex h-[calc(100dvh-6rem)] min-h-[480px] flex-col bg-slate-950">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-800 bg-slate-900/60 px-3 py-2">
        <div
          className={`flex shrink-0 items-center gap-2 rounded-full bg-slate-950 px-3 py-1 text-xs font-medium ring-1 ring-inset ring-slate-800 ${meta.text}`}
          role="status"
        >
          <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
          {meta.label}
        </div>

        {/* Address bar */}
        <div className="flex min-w-[12rem] flex-1 items-center gap-2 rounded-lg border border-slate-800 bg-slate-950 px-3 py-1.5">
          <Icon name="globe" className="h-3.5 w-3.5 shrink-0 text-slate-500" />
          <span
            className={`min-w-0 flex-1 truncate font-mono text-xs ${url ? "text-slate-200" : "text-slate-600"}`}
            title={url ?? undefined}
          >
            {url ?? "Run the project to get a preview link"}
          </span>
          <button
            type="button"
            onClick={copyLink}
            disabled={!url}
            aria-label="Copy link"
            title="Copy link"
            className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-slate-400 transition hover:bg-slate-800 hover:text-white disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <Icon name={copied ? "check" : "copy"} className="h-3.5 w-3.5" />
            {copied ? "Copied" : "Copy"}
          </button>
          {url ? (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Open in a new tab"
              title="Open in a new tab"
              className="shrink-0 rounded p-1 text-slate-400 transition hover:bg-slate-800 hover:text-white"
            >
              <Icon name="external" className="h-3.5 w-3.5" />
            </a>
          ) : (
            <span className="shrink-0 rounded p-1 text-slate-700">
              <Icon name="external" className="h-3.5 w-3.5" />
            </span>
          )}
        </div>

        {/* Devices */}
        <div className="hidden items-center rounded-lg border border-slate-800 bg-slate-950 p-0.5 md:flex" role="group" aria-label="Device size">
          {DEVICES.map((d) => (
            <button
              key={d.key}
              type="button"
              onClick={() => setDevice(d.key)}
              title={d.label}
              aria-label={d.label}
              aria-pressed={device === d.key}
              className={`rounded-md p-1.5 transition ${device === d.key ? "bg-slate-800 text-white" : "text-slate-500 hover:text-slate-200"
                }`}
            >
              <Icon name={d.key} className="h-4 w-4" />
            </button>
          ))}
        </div>

        <ToolButton label="Reload preview" onClick={() => setNonce((n) => n + 1)} disabled={!live}>
          <Icon name="refresh" />
        </ToolButton>

        <ToolButton label="Toggle logs" onClick={() => setLogsOpen((o) => !o)} active={logsOpen}>
          <Icon name="terminal" />
        </ToolButton>

        <div className="hidden h-5 w-px bg-slate-800 sm:block" />

        {status === "running" || starting ? (
          <>
            <button
              type="button"
              onClick={() => preview.restart()}
              disabled={working}
              className="flex items-center gap-1.5 rounded-md border border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-200 transition hover:bg-slate-800 disabled:opacity-50"
            >
              <Icon name="refresh" className="h-3.5 w-3.5" />
              Restart
            </button>
            <button
              type="button"
              onClick={() => preview.stop()}
              disabled={busy}
              className="flex items-center gap-1.5 rounded-md bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-500 disabled:opacity-50"
            >
              <Icon name="stop" className="h-3 w-3" />
              Stop
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => preview.start()}
            disabled={working}
            className="flex items-center gap-1.5 rounded-md bg-emerald-600 px-3.5 py-1.5 text-xs font-semibold text-white transition hover:bg-emerald-500 disabled:opacity-50"
          >
            {working ? <Spinner className="h-3.5 w-3.5" /> : <Icon name="play" className="h-3 w-3" />}
            {status === "failed" ? "Try again" : "Run project"}
          </button>
        )}
      </div>

      {/* Stage */}
      <div className="relative min-h-0 flex-1 bg-[radial-gradient(ellipse_at_top,_rgba(99,102,241,0.07),_transparent_60%)]">
        {live ? (
          <div className="flex h-full flex-col">
            {dirtyCount > 0 && (
              <div className="flex items-center justify-between gap-3 border-b border-amber-900/40 bg-amber-950/30 px-4 py-1.5 text-xs text-amber-200">
                <span>
                  {dirtyCount} unsaved file{dirtyCount > 1 ? "s are" : " is"} not included in this preview.
                  Save {dirtyCount > 1 ? "them" : "it"}, then restart.
                </span>
                <button
                  type="button"
                  onClick={onOpenFiles}
                  className="shrink-0 font-medium text-amber-100 underline-offset-2 hover:underline"
                >
                  Go to Files
                </button>
              </div>
            )}

            <div
              className={`flex min-h-0 flex-1 justify-center overflow-auto ${device === "desktop" ? "" : "bg-slate-900/40 p-4"
                }`}
            >
              <div
                style={{ width: frameWidth, maxWidth: "100%" }}
                className={`relative h-full min-h-0 overflow-hidden bg-white ${device === "desktop"
                  ? ""
                  : "rounded-2xl border border-slate-700 shadow-2xl shadow-black/50"
                  }`}
              >
                {frameLoading && (
                  <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 bg-slate-950 text-sm text-slate-400">
                    <Spinner />
                    Loading preview...
                  </div>
                )}

                <iframe
                  key={`${url}-${nonce}`}
                  src={url ?? undefined}
                  title="Project preview"
                  onLoad={() => setFrameLoading(false)}
                  onError={() => setFrameLoading(false)}
                  className="absolute inset-0 h-full w-full border-0 bg-white"
                />
              </div>
            </div>

            {mixedContent && (
              <p className="border-t border-slate-800 bg-slate-900/60 px-4 py-1.5 text-[11px] text-slate-500">
                Preview blank? Browsers can block http content inside an https page. Use &quot;Open in a new tab&quot;
                instead.
              </p>
            )}
          </div>
        ) : starting ? (
          <div className="flex h-full items-center justify-center p-6">
            <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/70 p-8 text-center ring-1 ring-white/5">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-indigo-500/10 text-indigo-300">
                <Spinner className="h-6 w-6" />
              </div>
              <h2 className="mt-5 text-lg font-semibold text-white">Starting your project</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">
                Installing dependencies and starting the frontend and backend. This can take a minute or two.
              </p>
              {startedAt && <p className="mt-3 font-mono text-xs text-slate-500">{elapsed}s elapsed</p>}
              {lastLine && (
                <p className="mt-4 truncate rounded-lg bg-slate-950 px-3 py-2 text-left font-mono text-[11px] text-slate-400">
                  {lastLine}
                </p>
              )}
            </div>
          </div>
        ) : status === "failed" ? (
          <div className="flex h-full items-center justify-center p-6">
            <div
              role="alert"
              className="w-full max-w-lg rounded-2xl border border-red-900/60 bg-red-950/20 p-8 text-center"
            >
              <Icon name="alert" className="mx-auto h-9 w-9 text-red-400" />
              <h2 className="mt-4 text-lg font-semibold text-white">The project could not start</h2>
              <p className="mt-2 break-words text-sm leading-relaxed text-red-200/90">
                {error ?? "Check the logs for details."}
              </p>
              <div className="mt-6 flex justify-center gap-3">
                <button
                  type="button"
                  onClick={() => preview.start()}
                  disabled={working}
                  className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:opacity-50"
                >
                  Try again
                </button>
                <button
                  type="button"
                  onClick={() => setLogsOpen(true)}
                  className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-300 transition hover:bg-slate-800"
                >
                  View logs
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center p-6">
            <div className="max-w-md text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-xl shadow-emerald-900/30">
                <Icon name="play" className="h-6 w-6" />
              </div>
              <h2 className="mt-5 text-xl font-semibold tracking-tight text-white">Run your project</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">
                Start the whole app, frontend and backend, and see it here with a shareable link. You can also
                press Run in the Files tab.
              </p>

              {dirtyCount > 0 && (
                <p className="mt-4 rounded-lg border border-amber-900/50 bg-amber-950/30 px-3 py-2 text-xs text-amber-200">
                  {dirtyCount} file{dirtyCount > 1 ? "s have" : " has"} unsaved edits. Run from the Files tab to
                  save {dirtyCount > 1 ? "them" : "it"} first.
                </p>
              )}

              <div className="mt-6 flex justify-center gap-3">
                <button
                  type="button"
                  onClick={() => preview.start()}
                  disabled={working}
                  className="flex items-center gap-2 rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-500 disabled:opacity-50"
                >
                  <Icon name="play" className="h-3.5 w-3.5" />
                  Run project
                </button>
                <button
                  type="button"
                  onClick={onOpenFiles}
                  className="rounded-lg border border-slate-700 px-4 py-2.5 text-sm font-medium text-slate-300 transition hover:bg-slate-800"
                >
                  Open Files
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Logs */}
      {logsOpen && (
        <div className="flex h-52 shrink-0 flex-col border-t border-slate-800 bg-slate-950">
          <div className="flex items-center justify-between border-b border-slate-800/70 px-3 py-1">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
              Logs <span className="ml-1 font-normal normal-case text-slate-600">{logs.length} lines</span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => preview.clearLogs()}
                className="rounded px-2 py-0.5 text-[11px] text-slate-500 hover:bg-slate-800 hover:text-slate-200"
              >
                Clear
              </button>
              <ToolButton label="Close logs" onClick={() => setLogsOpen(false)}>
                <Icon name="close" className="h-3.5 w-3.5" />
              </ToolButton>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 font-mono text-xs leading-relaxed">
            {logs.length === 0 ? (
              <p className="text-slate-600">No output yet. Logs appear here while the project runs.</p>
            ) : (
              logs.map((line, index) => (
                <pre key={index} className={`whitespace-pre-wrap break-words ${logTone(line)}`}>
                  {line}
                </pre>
              ))
            )}
            <div ref={logEndRef} />
          </div>
        </div>
      )}
    </div>
  );
}