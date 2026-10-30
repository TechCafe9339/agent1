"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { FormEvent, KeyboardEvent, ReactNode } from "react";

import { apiGet, apiPost } from "../../../lib/api";
import { useRealtime } from "../../../lib/realtime";

/* -------------------------------------------------------------------------- */
/* Types & constants                                                          */
/* -------------------------------------------------------------------------- */

type Message = {
  id: number;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
};

/** A message in the UI. `status` is only set on messages that have no server id yet. */
type ChatMessage = Message & { status?: "sending" | "failed" | "stopped" };

type ChatResponse = {
  conversation_id: number;
  messages: Message[];
};

type SendMessageResponse = {
  user_message: Message;
  assistant_message: Message;
};

type RegenerateResponse = {
  assistant_message: Message;
};

type Props = {
  projectId: string;
};

/**
 * Every backend call the chat makes lives here.
 *
 *  - chat        GET  -> { conversation_id, messages }
 *                POST { content } -> { user_message, assistant_message }       (existing)
 *  - regenerate  POST { message_id } -> { assistant_message }
 *                Re-runs the reply for an existing user message. The server should
 *                delete every message after that user message first.            (new)
 *  - edit        POST { content } -> { user_message, assistant_message }
 *                Updates the user message, deletes every message after it and
 *                generates a fresh reply.                                       (new)
 */
const API = {
  chat: (id: string) => `/projects/${id}/chat/`,
  regenerate: (id: string) => `/projects/${id}/chat/regenerate/`,
  edit: (id: string, messageId: number) => `/projects/${id}/chat/messages/${messageId}/edit/`,
};

const SUGGESTIONS = [
  {
    title: "Explain the structure",
    hint: "Get an overview of how the page is built",
    prompt: "Explain the structure of this page.",
  },
  {
    title: "Add dark mode",
    hint: "Request a visual change to the page",
    prompt: "Add a dark mode to this page.",
  },
  {
    title: "Find missing sections",
    hint: "Review the page and list what is still missing",
    prompt: "What sections or features are still missing from this page?",
  },
];

const MAX_LENGTH = 4000;

/** How often to check the server for a reply that may still be generating (a fallback when the socket is down). */
const POLL_MS = 4000;
/** How long after a message we keep waiting for its reply before offering Resend. */
const WAIT_MS = 3 * 60 * 1000;

const GRADIENT = "bg-gradient-to-r from-violet-500 via-fuchsia-500 to-orange-400";

/* -------------------------------------------------------------------------- */
/* Chat store                                                                 */
/*                                                                            */
/* Lives outside React on purpose. A request started here keeps running when  */
/* the Chat tab unmounts (switching to Files, Preview, another page...), and  */
/* the tab picks the result up again when it is reopened.                     */
/* -------------------------------------------------------------------------- */

type ProjectState = {
  messages: ChatMessage[];
  loaded: boolean;
  loading: boolean;
  loadError: string | null;
  /** A request from this browser is in flight. */
  running: boolean;
  runError: string | null;
  /** The server may still be generating a reply we are polling for. */
  waiting: boolean;
  /** The server told us over the socket that it is writing a reply. */
  serverBusy: boolean;
};

type Patch = Partial<ProjectState> | ((state: ProjectState) => Partial<ProjectState>);

const EMPTY_STATE: ProjectState = {
  messages: [],
  loaded: false,
  loading: false,
  loadError: null,
  running: false,
  runError: null,
  waiting: false,
  serverBusy: false,
};

const states = new Map<string, ProjectState>();
const listeners = new Set<() => void>();
const pollers = new Map<string, ReturnType<typeof setTimeout>>();
const watched = new Set<string>(); // projects whose Chat tab is currently open
let tempSeq = 0;

function getState(projectId: string): ProjectState {
  return states.get(projectId) ?? EMPTY_STATE;
}

function setState(projectId: string, patch: Patch) {
  const current = getState(projectId);
  const changes = typeof patch === "function" ? patch(current) : patch;
  states.set(projectId, { ...current, ...changes });
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function errorText(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback;
}

/* Stopping: each request in flight has a control, so the Stop button can cancel the wait. */

class StoppedError extends Error {
  constructor() {
    super("Stopped.");
    this.name = "StoppedError";
  }
}

type StopControl = { stopped: boolean; stop: () => void; whenStopped: Promise<never> };

const controls = new Map<string, StopControl>();

function createControl(): StopControl {
  let trigger: () => void = () => {};
  const whenStopped = new Promise<never>((_, reject) => {
    trigger = () => reject(new StoppedError());
  });
  // Marks the promise as handled, so stopping never causes an unhandled rejection.
  whenStopped.catch(() => {});

  const control: StopControl = {
    stopped: false,
    whenStopped,
    stop() {
      if (control.stopped) return;
      control.stopped = true;
      trigger();
    },
  };
  return control;
}

function stopChat(projectId: string) {
  controls.get(projectId)?.stop();
}

function startControl(projectId: string): StopControl {
  const control = createControl();
  controls.set(projectId, control);
  return control;
}

function endControl(projectId: string, control: StopControl) {
  if (controls.get(projectId) === control) controls.delete(projectId);
}

/** Keep messages that failed to send (or were stopped) unless the server turns out to have them. */
function reconcile(server: ChatMessage[], local: ChatMessage[]): ChatMessage[] {
  const kept = local.filter((m) => m.id < 0 && (m.status === "failed" || m.status === "stopped"));
  if (kept.length === 0) return server;

  const keep = kept.filter((f) => {
    const sentAt = Date.parse(f.timestamp) - 60_000;
    return !server.some(
      (m) => m.role === "user" && m.content === f.content && Date.parse(m.timestamp) >= sentAt
    );
  });
  return [...server, ...keep];
}

/** The last message is a recent user message with no reply yet. */
function isAwaitingReply(state: ProjectState) {
  if (!state.loaded || state.running) return false;
  const last = state.messages[state.messages.length - 1];
  if (!last || last.role !== "user" || last.id < 0 || last.status) return false;

  const age = Date.now() - Date.parse(last.timestamp);
  return age > -60_000 && age < WAIT_MS;
}

function stopPolling(projectId: string) {
  const timer = pollers.get(projectId);
  if (timer) clearTimeout(timer);
  pollers.delete(projectId);
}

function schedulePoll(projectId: string) {
  if (pollers.has(projectId) || !watched.has(projectId)) return;

  pollers.set(
    projectId,
    setTimeout(() => {
      pollers.delete(projectId);
      void loadMessages(projectId);
    }, POLL_MS)
  );
}

/** Decide whether to show "still working" and keep polling while the server may be busy. */
function refreshWaiting(projectId: string) {
  const state = getState(projectId);
  const waiting = isAwaitingReply(state);
  if (state.waiting !== waiting) setState(projectId, { waiting });
  if (waiting) schedulePoll(projectId);
}

async function loadMessages(projectId: string) {
  const initial = !getState(projectId).loaded;
  if (initial) setState(projectId, { loading: true, loadError: null });

  try {
    const result = await apiGet<ChatResponse>(API.chat(projectId));

    if (getState(projectId).running) {
      // A request in flight owns the list; don't overwrite its optimistic state.
      setState(projectId, { loading: false });
    } else {
      const server = result.messages ?? [];
      setState(projectId, (s) => ({
        messages: reconcile(server, s.messages),
        loaded: true,
        loading: false,
        loadError: null,
      }));
    }
  } catch (err) {
    if (initial) {
      setState(projectId, { loading: false, loadError: errorText(err, "Failed to load chat.") });
    }
  }

  refreshWaiting(projectId);
}

/* Live updates pushed by the server over the socket. */

function applyServerMessage(projectId: string, incoming: Message) {
  const current = getState(projectId);
  // Before the first load the list is read from the server anyway.
  // While our own request is running, its response brings the same messages back.
  if (!current.loaded || current.running) return;

  setState(projectId, (s) => {
    const isReply = incoming.role === "assistant";
    if (s.messages.some((m) => m.id === incoming.id)) {
      return { serverBusy: isReply ? false : s.serverBusy };
    }

    // A message we kept after a failed or stopped send is now known to the server.
    const rest =
      incoming.role === "user"
        ? s.messages.filter((m) => !(m.id < 0 && m.status !== "sending" && m.content === incoming.content))
        : s.messages;

    return {
      messages: [...rest, incoming],
      serverBusy: isReply ? false : s.serverBusy,
      runError: null,
    };
  });

  refreshWaiting(projectId);
}

function applyServerBusy(projectId: string, generating: boolean) {
  if (getState(projectId).running) return;
  setState(projectId, { serverBusy: generating });
}

async function sendMessage(projectId: string, content: string) {
  const current = getState(projectId);
  if (current.running || !current.loaded) return;

  const tempId = -(++tempSeq);
  const temp: ChatMessage = {
    id: tempId,
    role: "user",
    content,
    timestamp: new Date().toISOString(),
    status: "sending",
  };

  setState(projectId, {
    messages: [...current.messages, temp],
    running: true,
    waiting: false,
    serverBusy: false,
    runError: null,
  });

  const control = startControl(projectId);

  try {
    const result = await Promise.race([
      apiPost<SendMessageResponse>(API.chat(projectId), { content }),
      control.whenStopped,
    ]);
    setState(projectId, (s) => ({
      messages: [...s.messages.filter((m) => m.id !== tempId), result.user_message, result.assistant_message],
      running: false,
    }));
  } catch (err) {
    if (control.stopped) {
      // Keep the message on screen with a Resend button. The server may still have it.
      setState(projectId, (s) => ({
        messages: s.messages.map((m) => (m.id === tempId ? { ...m, status: "stopped" as const } : m)),
        running: false,
        runError: null,
      }));
    } else {
      // Keep the message on screen with a Resend button instead of throwing it away.
      setState(projectId, (s) => ({
        messages: s.messages.map((m) => (m.id === tempId ? { ...m, status: "failed" as const } : m)),
        running: false,
        runError: errorText(err, "Failed to send message."),
      }));
    }
    // The server may have received it anyway (for example a timeout or a stop); pick that up.
    void loadMessages(projectId);
  } finally {
    endControl(projectId, control);
  }
}

/** Re-run the reply for a message the server already has. */
async function regenerate(projectId: string, userMessageId: number) {
  const current = getState(projectId);
  if (current.running) return;

  const index = current.messages.findIndex((m) => m.id === userMessageId);
  if (index === -1) return;

  const before = current.messages;
  setState(projectId, {
    messages: before.slice(0, index + 1),
    running: true,
    waiting: false,
    serverBusy: false,
    runError: null,
  });

  const control = startControl(projectId);

  try {
    const result = await Promise.race([
      apiPost<RegenerateResponse>(API.regenerate(projectId), { message_id: userMessageId }),
      control.whenStopped,
    ]);
    setState(projectId, (s) => ({
      messages: [...s.messages, result.assistant_message],
      running: false,
    }));
  } catch (err) {
    if (control.stopped) {
      setState(projectId, { running: false, runError: null });
    } else {
      setState(projectId, {
        messages: before,
        running: false,
        runError: errorText(err, "Failed to generate a reply."),
      });
    }
    void loadMessages(projectId);
  } finally {
    endControl(projectId, control);
  }
}

/** Resend: a message that never reached the server is sent again, otherwise its reply is re-run. */
async function resendMessage(projectId: string, messageId: number) {
  const current = getState(projectId);
  if (current.running) return;

  const target = current.messages.find((m) => m.id === messageId);
  if (!target) return;

  if (messageId < 0) {
    setState(projectId, { messages: current.messages.filter((m) => m.id !== messageId) });
    await sendMessage(projectId, target.content);
    return;
  }

  await regenerate(projectId, messageId);
}

/** Edit a user message: everything after it is replaced by a new reply. */
async function editMessage(projectId: string, messageId: number, content: string) {
  const current = getState(projectId);
  if (current.running || messageId < 0) return;

  const index = current.messages.findIndex((m) => m.id === messageId);
  if (index === -1) return;

  const before = current.messages;
  const edited: ChatMessage = { ...before[index], content };

  setState(projectId, {
    messages: [...before.slice(0, index), edited],
    running: true,
    waiting: false,
    serverBusy: false,
    runError: null,
  });

  const control = startControl(projectId);

  try {
    const result = await Promise.race([
      apiPost<SendMessageResponse>(API.edit(projectId, messageId), { content }),
      control.whenStopped,
    ]);
    setState(projectId, (s) => {
      const i = s.messages.findIndex((m) => m.id === messageId);
      const head = i === -1 ? s.messages : s.messages.slice(0, i);
      return {
        messages: [...head, result.user_message, result.assistant_message],
        running: false,
      };
    });
  } catch (err) {
    if (control.stopped) {
      // Show what the server has: the edit may or may not have gone through.
      setState(projectId, { messages: before, running: false, runError: null });
      void loadMessages(projectId);
    } else {
      setState(projectId, {
        messages: before,
        running: false,
        runError: errorText(err, "Failed to edit message."),
      });
    }
  } finally {
    endControl(projectId, control);
  }
}

function dismissError(projectId: string) {
  setState(projectId, { runError: null });
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function formatDay(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/** Renders ``` fenced blocks as code and everything else as plain text. */
function renderContent(content: string): ReactNode {
  const parts = content.split("```");

  return parts.map((part, index) => {
    if (index % 2 === 1) {
      // Drop an optional language tag on the first line of the fence.
      const code = part.replace(/^[\w+#.-]*\n/, "").replace(/\n$/, "");
      return (
        <pre
          key={index}
          className="my-3 overflow-x-auto rounded-xl border border-white/10 bg-black/40 p-3 font-mono text-xs leading-relaxed text-white/85"
        >
          <code>{code}</code>
        </pre>
      );
    }

    const text = part.replace(/^\n+|\n+$/g, "");
    if (!text) return null;

    return (
      <p key={index} className="whitespace-pre-wrap break-words leading-7">
        {text}
      </p>
    );
  });
}

/* -------------------------------------------------------------------------- */
/* Small components                                                           */
/* -------------------------------------------------------------------------- */

function Icon({ name, className = "h-4 w-4" }: { name: string; className?: string }) {
  const common = {
    className,
    fill: "none",
    viewBox: "0 0 24 24",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  switch (name) {
    case "spark":
      return (
        <svg {...common}>
          <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" />
          <path d="M19 16l.7 2.1L22 19l-2.3.9L19 22l-.7-2.1L16 19l2.3-.9L19 16z" />
        </svg>
      );
    case "send":
      return (
        <svg {...common}>
          <path d="M12 19V5" />
          <path d="M5 12l7-7 7 7" />
        </svg>
      );
    case "stop":
      return (
        <svg {...common}>
          <rect x="6.5" y="6.5" width="11" height="11" rx="2.5" fill="currentColor" stroke="none" />
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
    case "edit":
      return (
        <svg {...common}>
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z" />
        </svg>
      );
    case "refresh":
      return (
        <svg {...common}>
          <path d="M20 11a8 8 0 10-2.3 5.7" />
          <path d="M20 4v7h-7" />
        </svg>
      );
    default:
      return null;
  }
}

function AssistantAvatar() {
  return (
    <div
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${GRADIENT} text-white shadow-lg shadow-fuchsia-900/40`}
    >
      <Icon name="spark" className="h-4 w-4" />
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be unavailable (insecure context); ignore */
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="flex items-center gap-1 rounded-full px-2 py-1 text-[11px] text-white/40 transition hover:bg-white/10 hover:text-white"
      aria-label="Copy message"
    >
      <Icon name={copied ? "check" : "copy"} className="h-3.5 w-3.5" />
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

/** Three dots that light up in turn, with a thin gradient sweep beneath. */
function TypingIndicator({ label }: { label: string }) {
  return (
    <div className="flex items-start gap-3" role="status" aria-label="Prompt2Web is thinking">
      <AssistantAvatar />
      <div>
        <div className="relative flex w-fit items-center gap-1.5 overflow-hidden rounded-2xl rounded-tl-md border border-white/10 bg-white/[0.05] px-4 py-3.5">
          {[0, 200, 400].map((delay) => (
            <span
              key={delay}
              className="bp-blink h-2 w-2 rounded-full bg-gradient-to-r from-violet-400 to-fuchsia-400"
              style={{ animationDelay: `${delay}ms` }}
            />
          ))}
          <span className={`bp-sweep absolute bottom-0 left-0 h-px w-1/3 ${GRADIENT}`} />
        </div>
        <p className="mt-1 pl-1 text-[11px] text-white/35">{label}</p>
      </div>
    </div>
  );
}

type BubbleProps = {
  item: ChatMessage;
  /** A reply is being generated or awaited, so editing is paused. */
  busy: boolean;
  /** A request from this browser is in flight, so Resend is paused. */
  running: boolean;
  /** The server may still be generating the reply for this message. */
  waiting: boolean;
  /** This user message has no reply (it failed, was stopped, or the run was interrupted). */
  unanswered: boolean;
  canRegenerate: boolean;
  onResend: () => void;
  onEdit: (content: string) => void;
  onRegenerate: () => void;
};

function MessageBubble({
  item,
  busy,
  running,
  waiting,
  unanswered,
  canRegenerate,
  onResend,
  onEdit,
  onRegenerate,
}: BubbleProps) {
  const isUser = item.role === "user";
  const time = formatTime(item.timestamp);
  const stopped = item.status === "stopped";
  const failed = item.status === "failed" || stopped;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.content);

  const canEdit = isUser && item.id > 0 && !item.status && !busy;

  function startEdit() {
    setDraft(item.content);
    setEditing(true);
  }

  function submitEdit() {
    const next = draft.trim();
    setEditing(false);
    if (!next || next === item.content) return;
    onEdit(next);
  }

  function onEditKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setEditing(false);
    } else if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submitEdit();
    }
  }

  if (isUser) {
    return (
      <div className="group flex justify-end">
        <div className="w-full max-w-[85%] sm:max-w-[75%]">
          {editing ? (
            <div className="rounded-2xl border border-fuchsia-400/50 bg-white/[0.06] p-2">
              <textarea
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value.slice(0, MAX_LENGTH))}
                onKeyDown={onEditKeyDown}
                rows={Math.min(8, Math.max(2, draft.split("\n").length))}
                aria-label="Edit message"
                className="w-full resize-none bg-transparent px-2 py-1.5 text-sm leading-relaxed text-white outline-none"
              />
              <p className="px-2 pb-2 text-[11px] text-white/40">
                Saving replaces every reply after this message with a new one.
              </p>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="rounded-full border border-white/15 px-3 py-1 text-xs text-white/70 transition hover:bg-white/10"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submitEdit}
                  disabled={!draft.trim() || draft.trim() === item.content}
                  className={`rounded-full ${GRADIENT} px-3 py-1 text-xs font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:bg-none disabled:bg-white/10 disabled:text-white/30`}
                >
                  Save &amp; resend
                </button>
              </div>
            </div>
          ) : (
            <div
              className={`rounded-2xl rounded-br-md px-4 py-3 text-sm ${
                failed
                  ? "border border-amber-300/40 bg-amber-400/10 text-amber-50"
                  : `${GRADIENT} text-white shadow-lg shadow-fuchsia-900/30`
              }`}
            >
              <div className="space-y-2">{renderContent(item.content)}</div>
            </div>
          )}

          {!editing && (
            <div className="mt-1 flex items-center justify-end gap-2">
              {canEdit && (
                <span className="opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
                  <button
                    type="button"
                    onClick={startEdit}
                    className="flex items-center gap-1 rounded-full px-2 py-1 text-[11px] text-white/40 transition hover:bg-white/10 hover:text-white"
                    aria-label="Edit message"
                  >
                    <Icon name="edit" className="h-3.5 w-3.5" />
                    Edit
                  </button>
                </span>
              )}
              {time && <span className="text-[11px] text-white/30">{time}</span>}
            </div>
          )}

          {unanswered && !editing && (
            <div className="mt-2 flex flex-wrap items-center justify-end gap-2 text-xs text-amber-300">
              <Icon name="alert" className="h-3.5 w-3.5" />
              <span>
                {stopped
                  ? "Stopped before a reply arrived."
                  : failed
                  ? "Message not sent."
                  : waiting
                  ? "The reply may still be generating."
                  : "No reply was received."}
              </span>
              <button
                type="button"
                onClick={onResend}
                disabled={running}
                className="flex items-center gap-1 rounded-full border border-amber-300/40 px-3 py-0.5 font-semibold transition hover:bg-amber-400/10 disabled:opacity-40"
              >
                <Icon name="refresh" className="h-3 w-3" />
                {waiting ? "Resend anyway" : "Resend"}
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="group flex items-start gap-3">
      <AssistantAvatar />
      <div className="min-w-0 max-w-[90%] sm:max-w-[80%]">
        <div className="rounded-2xl rounded-tl-md border border-white/10 bg-white/[0.05] px-4 py-3 text-sm text-white/85 backdrop-blur">
          <div className="space-y-2">{renderContent(item.content)}</div>
        </div>
        <div className="mt-1 flex items-center gap-2 pl-1">
          {time && <span className="text-[11px] text-white/30">{time}</span>}
          <span className="flex items-center opacity-0 transition group-hover:opacity-100 focus-within:opacity-100">
            <CopyButton text={item.content} />
            {canRegenerate && (
              <button
                type="button"
                onClick={onRegenerate}
                disabled={busy}
                className="flex items-center gap-1 rounded-full px-2 py-1 text-[11px] text-white/40 transition hover:bg-white/10 hover:text-white disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-white/40"
                aria-label="Regenerate reply"
              >
                <Icon name="refresh" className="h-3.5 w-3.5" />
                Regenerate
              </button>
            )}
          </span>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Chat                                                                       */
/* -------------------------------------------------------------------------- */

export default function ProjectChat({ projectId }: Props) {
  const state = useSyncExternalStore(
    subscribe,
    () => getState(projectId),
    () => EMPTY_STATE
  );
  const { messages, loaded, loadError, running, runError, waiting, serverBusy } = state;

  const [message, setMessage] = useState("");

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  /* Load the conversation. Messages already in the store (from a previous visit
     or a request that kept running) show instantly and are refreshed silently. */
  useEffect(() => {
    watched.add(projectId);
    void loadMessages(projectId);

    return () => {
      watched.delete(projectId);
      stopPolling(projectId);
    };
  }, [projectId]);

  const retryLoad = useCallback(() => {
    void loadMessages(projectId);
  }, [projectId]);

  /* Real-time: new messages and "the assistant is writing" arrive over the socket. */
  const numericId = Number(projectId);
  const socketState = useRealtime({
    projectId,
    onChatMessage: (event) => {
      if (event.projectId === numericId) applyServerMessage(projectId, event.message);
    },
    onChatStatus: (event) => {
      if (event.projectId === numericId) applyServerBusy(projectId, event.generating);
    },
    // After a dropped connection, re-read anything that changed while we were away.
    onResync: () => {
      void loadMessages(projectId);
    },
  });

  /* Warn before a reload throws away a reply that is still being generated. */
  useEffect(() => {
    if (!running) return;

    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [running]);

  /* Keep the newest message in view. */
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, running, waiting, serverBusy]);

  /* Auto-grow the textarea up to a maximum height. */
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [message]);

  function submit() {
    const content = message.trim();
    if (!content || running || !loaded) return;

    setMessage("");
    void sendMessage(projectId, content);
    textareaRef.current?.focus();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends, Shift+Enter inserts a new line. Ignore IME composition.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  }

  function applySuggestion(prompt: string) {
    setMessage(prompt);
    textareaRef.current?.focus();
  }

  /* Day separators between messages from different days. */
  function dayLabelBefore(index: number) {
    const current = formatDay(messages[index].timestamp);
    if (!current) return null;
    if (index === 0) return current;
    return formatDay(messages[index - 1].timestamp) !== current ? current : null;
  }

  const busy = running || waiting || serverBusy;
  const last = messages[messages.length - 1];
  const trailingUserId = !running && last && last.role === "user" ? last.id : null;
  const lastAssistantIndex = last && last.role === "assistant" ? messages.length - 1 : -1;

  const liveDot =
    socketState === "live"
      ? "bg-emerald-400 shadow-[0_0_8px_#34d399]"
      : socketState === "connecting"
      ? "animate-pulse bg-amber-400"
      : "bg-slate-500";
  const liveTitle =
    socketState === "live"
      ? "Real-time updates are on"
      : socketState === "connecting"
      ? "Connecting to the real-time server"
      : "Real-time updates are off";

  return (
    <div className="flex h-[calc(100dvh-6rem)] min-h-[480px] flex-col">
      <style>{`
        @keyframes bp-blink { 0%, 100% { opacity: .25; transform: translateY(0); } 50% { opacity: 1; transform: translateY(-3px); } }
        .bp-blink { animation: bp-blink 1.1s ease-in-out infinite; }
        @keyframes bp-sweep { from { transform: translateX(-100%); } to { transform: translateX(300%); } }
        .bp-sweep { animation: bp-sweep 1.6s linear infinite; }
        @media (prefers-reduced-motion: reduce) { .bp-blink, .bp-sweep { animation: none; } }
      `}</style>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-6 sm:px-6">
        <div className="mx-auto max-w-3xl">
          {!loaded && !loadError ? (
            <div className="space-y-6" role="status" aria-label="Loading conversation">
              <div className="flex gap-3">
                <div className="h-8 w-8 animate-pulse rounded-full bg-white/10" />
                <div className="h-16 w-2/3 animate-pulse rounded-2xl bg-white/5" />
              </div>
              <div className="flex justify-end">
                <div className="h-10 w-1/2 animate-pulse rounded-2xl bg-white/5" />
              </div>
            </div>
          ) : !loaded && loadError ? (
            <div
              role="alert"
              className="mx-auto mt-10 max-w-md rounded-3xl border border-rose-400/30 bg-rose-500/10 p-6 text-center backdrop-blur"
            >
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-rose-500/20">
                <Icon name="alert" className="h-6 w-6 text-rose-300" />
              </span>
              <p className="p2w-display mt-3 text-xl font-bold text-white">Couldn’t load the conversation</p>
              <p className="mt-1 break-words text-xs text-rose-100/80">{loadError}</p>
              <button
                onClick={retryLoad}
                className={`mt-4 rounded-full ${GRADIENT} px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-fuchsia-900/40 transition hover:brightness-110`}
              >
                Try again
              </button>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex min-h-[380px] items-center justify-center">
              <div className="w-full max-w-xl">
                <h2 className="p2w-display text-4xl font-extrabold leading-tight text-white sm:text-5xl">
                  What should change{" "}
                  <span className="bg-gradient-to-r from-violet-400 via-fuchsia-400 to-orange-300 bg-clip-text text-transparent">
                    next?
                  </span>
                </h2>
                <p className="mt-3 max-w-md text-sm leading-relaxed text-white/55">
                  Ask Prompt2Web to explain the page or request a change, and it will update your code.
                </p>

                <div className="mt-7 grid gap-3 sm:grid-cols-3">
                  {SUGGESTIONS.map((item) => (
                    <button
                      key={item.title}
                      type="button"
                      onClick={() => applySuggestion(item.prompt)}
                      className="rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-left backdrop-blur transition hover:-translate-y-1 hover:border-white/25 hover:bg-white/[0.08] hover:shadow-xl hover:shadow-black/40"
                    >
                      <span className="p2w-display block text-base font-bold leading-tight text-white">
                        {item.title}
                      </span>
                      <span className="mt-1.5 block text-xs leading-relaxed text-white/45">{item.hint}</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {messages.map((item, index) => {
                const day = dayLabelBefore(index);

                // The user message just before the last reply, used by Regenerate.
                const previous = index > 0 ? messages[index - 1] : undefined;
                const canRegenerate =
                  index === lastAssistantIndex && !!previous && previous.role === "user" && previous.id > 0;

                const unanswered =
                  item.role === "user" &&
                  (item.status === "failed" ||
                    item.status === "stopped" ||
                    (item.id === trailingUserId && !serverBusy));

                return (
                  <div key={item.id} className="space-y-6">
                    {day && (
                      <div className="flex items-center gap-3 text-[11px] font-medium text-white/30">
                        <span className="h-px flex-1 bg-white/10" />
                        {day}
                        <span className="h-px flex-1 bg-white/10" />
                      </div>
                    )}
                    <MessageBubble
                      item={item}
                      busy={busy}
                      running={running}
                      waiting={waiting}
                      unanswered={unanswered}
                      canRegenerate={canRegenerate}
                      onResend={() => void resendMessage(projectId, item.id)}
                      onEdit={(content) => void editMessage(projectId, item.id, content)}
                      onRegenerate={() => previous && void regenerate(projectId, previous.id)}
                    />
                  </div>
                );
              })}

              {busy && (
                <TypingIndicator
                  label={
                    running
                      ? "Working on it. This keeps running if you switch tabs."
                      : serverBusy
                      ? "Prompt2Web is writing a reply..."
                      : "Still working on your last message..."
                  }
                />
              )}
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </div>

      {/* Composer */}
      <div className="border-t border-white/10 bg-[#07060f]/70 px-4 pb-4 pt-3 backdrop-blur-xl sm:px-6">
        <div className="mx-auto max-w-3xl">
          {runError && (
            <div
              role="alert"
              className="mb-3 flex items-start gap-2 rounded-2xl border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-100"
            >
              <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0 text-rose-300" />
              <span className="min-w-0 flex-1 break-words">{runError}</span>
              <button
                type="button"
                onClick={() => dismissError(projectId)}
                className="shrink-0 rounded-full p-1 text-rose-300 transition hover:bg-white/10 hover:text-white"
                aria-label="Dismiss error"
              >
                <Icon name="close" className="h-4 w-4" />
              </button>
            </div>
          )}

          <form
            onSubmit={handleSubmit}
            className="relative rounded-3xl bg-[#0e0c1f]/95 p-2 ring-1 ring-white/10 transition focus-within:ring-fuchsia-400/60 focus-within:shadow-[0_0_60px_-20px_rgba(217,70,239,.6)]"
          >
            <div className="flex items-end gap-2">
              <textarea
                ref={textareaRef}
                value={message}
                onChange={(event) => setMessage(event.target.value.slice(0, MAX_LENGTH))}
                onKeyDown={handleKeyDown}
                placeholder="Ask Prompt2Web to change this page..."
                aria-label="Message"
                rows={1}
                className="max-h-[200px] min-h-[44px] flex-1 resize-none bg-transparent px-3 py-2.5 text-sm leading-relaxed text-white outline-none placeholder:text-white/30"
              />

              {running ? (
                <button
                  type="button"
                  onClick={() => stopChat(projectId)}
                  title="Stop generating"
                  aria-label="Stop generating"
                  className="mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-rose-400/40 bg-rose-500/15 text-rose-200 transition hover:border-rose-300 hover:bg-rose-500/25"
                >
                  <Icon name="stop" className="h-4 w-4" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!loaded || !message.trim()}
                  aria-label="Send message"
                  className={`mb-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${GRADIENT} text-white shadow-lg shadow-fuchsia-900/40 transition hover:scale-105 hover:brightness-110 disabled:cursor-not-allowed disabled:bg-none disabled:bg-white/10 disabled:text-white/30 disabled:shadow-none disabled:hover:scale-100`}
                >
                  <Icon name="send" className="h-5 w-5" />
                </button>
              )}
            </div>
          </form>

          <div className="mt-2 flex items-center justify-between px-1 text-[11px] text-white/30">
            <span className="flex items-center gap-2">
              Project #{projectId}
              <span title={liveTitle} className={`h-1.5 w-1.5 rounded-full ${liveDot}`} aria-label={liveTitle} />
            </span>
            <span className="hidden sm:inline">
              Enter to send · Shift + Enter for a new line
              {message.length > MAX_LENGTH * 0.8 && ` · ${message.length}/${MAX_LENGTH}`}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}