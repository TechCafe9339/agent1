"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

/* -------------------------------------------------------------------------- */
/* A real shell in the browser: xterm.js talking to a pty over a WebSocket.   */
/* The matching server is terminal-server/server.js.                          */
/* -------------------------------------------------------------------------- */

export type TerminalHandle = {
  /** Type a command into the shell and press Enter (queued until connected). */
  run: (command: string) => void;
  focus: () => void;
};

type Props = {
  projectId: string;
  /** Whether the panel is visible. The shell starts the first time this is true. */
  open: boolean;
  presets: { label: string; command: string }[];
  onClose: () => void;
};

type Status = "idle" | "connecting" | "connected" | "closed" | "error";

const WS_URL = process.env.NEXT_PUBLIC_TERMINAL_WS ?? "ws://localhost:4001";
const TOKEN = process.env.NEXT_PUBLIC_TERMINAL_TOKEN ?? "";

const THEME = {
  background: "#04060f",
  foreground: "#d6def5",
  cursor: "#7fe3ff",
  cursorAccent: "#04060f",
  selectionBackground: "#7fe3ff33",
  black: "#0b1126",
  red: "#ff8f7a",
  green: "#8dffc4",
  yellow: "#ffc15e",
  blue: "#7fb4ff",
  magenta: "#c9a2ff",
  cyan: "#7fe3ff",
  white: "#d6def5",
  brightBlack: "#4a5a86",
  brightRed: "#ffb3a3",
  brightGreen: "#b5ffd9",
  brightYellow: "#ffd98f",
  brightBlue: "#a8cdff",
  brightMagenta: "#ddc4ff",
  brightCyan: "#b3f0ff",
  brightWhite: "#ffffff",
};

const STATUS_LABEL: Record<Status, string> = {
  idle: "Not started",
  connecting: "Connecting...",
  connected: "Connected",
  closed: "Session ended",
  error: "Server unreachable",
};

const STATUS_DOT: Record<Status, string> = {
  idle: "bg-[#4a5a86]",
  connecting: "animate-pulse bg-[#ffc15e]",
  connected: "bg-[#8dffc4]",
  closed: "bg-[#4a5a86]",
  error: "bg-[#ff8f7a]",
};

const TerminalPanel = forwardRef<TerminalHandle, Props>(function TerminalPanel(
  { projectId, open, presets, onClose },
  ref
) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const pending = useRef<string[]>([]);
  const statusRef = useRef<Status>("idle");

  const [status, setStatusState] = useState<Status>("idle");
  const [started, setStarted] = useState(false);
  const [session, setSession] = useState(0);
  const [tall, setTall] = useState(false);

  function setStatus(next: Status) {
    statusRef.current = next;
    setStatusState(next);
  }

  // Start the shell the first time the panel is opened, not before.
  useEffect(() => {
    if (open && !started) setStarted(true);
  }, [open, started]);

  // One effect owns the whole terminal lifecycle. Bumping `session` starts a fresh shell.
  useEffect(() => {
    if (!started) return;

    let disposed = false;
    let cleanup = () => {};

    (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([
        import("@xterm/xterm"),
        import("@xterm/addon-fit"),
      ]);
      if (disposed || !hostRef.current) return;

      const term = new Terminal({
        fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize: 13,
        cursorBlink: true,
        scrollback: 5000,
        theme: THEME,
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(hostRef.current);
      termRef.current = term;

      const safeFit = () => {
        try {
          fit.fit();
        } catch {
          /* hidden or zero-sized: fit again when it becomes visible */
        }
      };
      safeFit();

      setStatus("connecting");
      const params = new URLSearchParams({ project: projectId });
      if (TOKEN) params.set("token", TOKEN);

      const ws = new WebSocket(`${WS_URL}/?${params.toString()}`);
      wsRef.current = ws;

      const send = (message: unknown) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
      };

      ws.onopen = () => {
        setStatus("connected");
        safeFit();
        send({ type: "resize", cols: term.cols, rows: term.rows });
        for (const command of pending.current.splice(0)) send({ type: "input", data: `${command}\r` });
      };
      ws.onmessage = (event) => {
        if (typeof event.data === "string") term.write(event.data);
      };
      ws.onerror = () => {
        setStatus("error");
        term.write(`\r\n\x1b[31mCould not reach the terminal server at ${WS_URL}.\x1b[0m\r\n`);
      };
      ws.onclose = () => {
        if (statusRef.current !== "error") setStatus("closed");
        term.write("\r\n\x1b[90m[session ended — use New to start another]\x1b[0m\r\n");
      };

      const dataSub = term.onData((data) => send({ type: "input", data }));
      const resizeSub = term.onResize(({ cols, rows }) => send({ type: "resize", cols, rows }));
      const observer = new ResizeObserver(safeFit);
      observer.observe(hostRef.current);

      cleanup = () => {
        observer.disconnect();
        dataSub.dispose();
        resizeSub.dispose();
        ws.onclose = null;
        ws.onerror = null;
        ws.close();
        term.dispose();
        termRef.current = null;
        wsRef.current = null;
      };
    })();

    return () => {
      disposed = true;
      cleanup();
    };
  }, [started, session, projectId]);

  // Give the shell the keyboard whenever the panel opens.
  useEffect(() => {
    if (open && status === "connected") termRef.current?.focus();
  }, [open, status]);

  function runCommand(command: string) {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "input", data: `${command}\r` }));
    } else {
      pending.current.push(command);
      // A dead session can't take commands: start a new one, which flushes the queue.
      if (statusRef.current === "closed" || statusRef.current === "error") setSession((s) => s + 1);
    }
    termRef.current?.focus();
  }

  // The parent only needs stable entry points; they always call the latest runCommand.
  const runRef = useRef(runCommand);
  runRef.current = runCommand;

  useImperativeHandle(
    ref,
    () => ({
      run: (command: string) => runRef.current(command),
      focus: () => termRef.current?.focus(),
    }),
    []
  );

  return (
    <div className={`flex ${tall ? "h-96" : "h-60"} shrink-0 flex-col border-t border-[#7fe3ff]/30 bg-[#04060f]`}>
      <div className="flex items-center justify-between border-b border-[#1a2347] px-3 py-1">
        <div className="flex items-center gap-2 text-xs font-medium text-[#8a9bc4]">
          Terminal
          <span className="flex items-center gap-1.5 font-mono text-[11px] font-normal text-[#4a5a86]">
            <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[status]}`} />
            {STATUS_LABEL[status]}
          </span>
        </div>
        <div className="flex items-center gap-1 text-[11px]">
          <button
            type="button"
            onClick={() => {
              pending.current = [];
              setSession((s) => s + 1);
            }}
            className="px-2 py-0.5 text-[#6f7fa8] hover:text-[#7fe3ff]"
            title="Kill this shell and start a new one"
          >
            New
          </button>
          <button
            type="button"
            onClick={() => termRef.current?.clear()}
            className="px-2 py-0.5 text-[#6f7fa8] hover:text-[#7fe3ff]"
          >
            Clear
          </button>
          <button
            type="button"
            onClick={() => setTall((t) => !t)}
            className="px-2 py-0.5 text-[#6f7fa8] hover:text-[#7fe3ff]"
          >
            {tall ? "Smaller" : "Larger"}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Hide terminal"
            title="Hide (the shell keeps running)"
            className="p-1 text-[#6f7fa8] hover:text-white"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      </div>

      {presets.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b border-[#1a2347] px-3 py-1.5">
          {presets.map((preset) => (
            <button
              key={preset.command}
              type="button"
              onClick={() => runCommand(preset.command)}
              className="border border-[#1a2347] px-2 py-0.5 text-[11px] text-[#8a9bc4] transition hover:border-[#7fe3ff]/60 hover:text-[#7fe3ff]"
            >
              {preset.label}
            </button>
          ))}
        </div>
      )}

      <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden px-2 py-1" onClick={() => termRef.current?.focus()} />
    </div>
  );
});

export default TerminalPanel;