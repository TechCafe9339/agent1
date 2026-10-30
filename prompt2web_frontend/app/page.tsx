"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { KeyboardEvent, MouseEvent, ReactNode } from "react";
import Link from "next/link";

import { apiGet, apiPost, apiPatch, apiDelete } from "../lib/api";
import { useRealtime } from "../lib/realtime";
import type { ConnectionState } from "../lib/realtime";

/* -------------------------------------------------------------------------- */
/* Types & constants                                                          */
/* -------------------------------------------------------------------------- */

type Project = {
  id: number;
  name?: string;
  description?: string | null;
  initial_prompt: string;
  status: string;
  created_at?: string;
  updated_at?: string;
};

type Stage = "saving" | "planning" | "generating";

const STAGES: { key: Stage; label: string; short: string }[] = [
  { key: "saving", label: "Saving project...", short: "Save" },
  { key: "planning", label: "Analyzing & planning...", short: "Plan" },
  { key: "generating", label: "Generating code...", short: "Generate" },
];

const QUICK_STARTS = [
  { icon: "user", label: "Portfolio Website", hint: "About, projects and contact", prompt: "Build a personal portfolio website with an about section, a projects gallery and a contact form", accent: "from-violet-400 to-indigo-500" },
  { icon: "rocket", label: "Product Landing Page", hint: "Hero, features and pricing", prompt: "Build a modern landing page for a mobile app with a hero, features, pricing and a call to action", accent: "from-fuchsia-500 to-pink-500" },
  { icon: "coffee", label: "Restaurant Website", hint: "Menu, gallery and reservations", prompt: "Build a restaurant website with a menu, a photo gallery, opening hours and a reservation section", accent: "from-amber-400 to-orange-500" },
  { icon: "calendar", label: "Event Invitation", hint: "Schedule, venue and RSVP", prompt: "Build an event invitation page with a countdown, a schedule, venue details and an RSVP form", accent: "from-emerald-400 to-teal-500" },
] as const;

// Rotating hints shown while the prompt box is empty.
const HINTS = [
  "A portfolio for a photographer with a gallery and a contact section…",
  "A landing page for my startup with pricing and testimonials…",
  "A bakery website with a menu, opening hours and a map…",
  "A wedding invitation page with a countdown and an RSVP form…",
];

// Keep these in one place so the UI never drifts from the real stack.
const STACK_LABEL = "HTML + CSS";
const MODEL_LABEL = "Suri 0.1";
const MAX_PROMPT_LENGTH = 2000;

/**
 * How many projects may generate at the same time. A local model usually
 * handles one job at a time, so lower this to 1 if two runs slow each other down.
 */
const MAX_PARALLEL_RUNS = 2;

const GRADIENT = "bg-gradient-to-r from-violet-500 via-fuchsia-500 to-orange-400";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function getErrorMessage(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback;
}

type ParsedError = { summary: string; details: string | null };

/** Turns a raw JSON error payload into a short summary plus optional details. */
function parseError(raw: string): ParsedError {
  const text = raw.trim();
  const start = text.indexOf("{");

  if (start === -1) {
    return text.length > 220
      ? { summary: "Something went wrong.", details: text }
      : { summary: text, details: null };
  }

  try {
    const data = JSON.parse(text.slice(start));
    const generation =
      data && typeof data.generation === "object" && data.generation ? data.generation : data;

    const message: string =
      (typeof data.message === "string" && data.message) || "Project generation failed.";
    const taskTitle: string | undefined =
      typeof generation.failed_task_title === "string" ? generation.failed_task_title : undefined;
    const detail: string | undefined =
      typeof generation.error === "string" ? generation.error : undefined;

    return {
      summary: taskTitle ? `${message.replace(/\.$/, "")} at "${taskTitle}".` : message,
      details: detail ? detail.trim() : null,
    };
  } catch {
    return { summary: "Project generation failed.", details: text };
  }
}

function projectTitle(project: Project) {
  if (project.name) return project.name;

  const text = project.initial_prompt?.trim() || "Untitled project";
  return text.length <= 32 ? text : `${text.slice(0, 32)}...`;
}

function isFailedStatus(status: string) {
  return /(fail|error)/i.test(status || "");
}

function statusTone(status: string) {
  const s = (status || "").toLowerCase();
  if (/(fail|error)/.test(s)) return "bg-rose-500/10 text-rose-300 ring-rose-400/30";
  if (/(ready|complete|done|success|generated)/.test(s)) return "bg-emerald-500/10 text-emerald-300 ring-emerald-400/30";
  if (/(generat|plan|prepar|running|progress|pending)/.test(s)) return "bg-amber-500/10 text-amber-300 ring-amber-400/30";
  return "bg-slate-500/10 text-slate-300 ring-slate-400/30";
}

/* -------------------------------------------------------------------------- */
/* Generation runs                                                            */
/*                                                                            */
/* Lives outside React on purpose. Planning and generating keep going when    */
/* you leave this page (open a project, switch tabs) and are picked up again  */
/* when you come back. Closing or reloading the browser tab still stops them. */
/* -------------------------------------------------------------------------- */

type RunStage = "planning" | "generating";

type Run = {
  projectId: number;
  /** The step that is running right now. */
  stage: RunStage | null;
  running: boolean;
  error: string | null;
  /** The step that failed, so Retry can resume there instead of starting over. */
  failedStage: RunStage | null;
  succeeded: boolean;
  /** Stopped by the user. Retry resumes from failedStage. */
  stopped: boolean;
  /** Latest message the server pushed while this run was working. */
  activity: string | null;
  /** Task progress pushed by the server, for example 3 of 8 done. */
  progress: { completed: number; total: number } | null;
  /** Hidden from the main panel (a failed run still shows Retry in the sidebar). */
  dismissed: boolean;
};

const EMPTY_RUNS: Record<number, Run> = {};
let runs: Record<number, Run> = EMPTY_RUNS;
const runListeners = new Set<() => void>();
const progressHandlers = new Set<() => void>();

function subscribeRuns(listener: () => void) {
  runListeners.add(listener);
  return () => {
    runListeners.delete(listener);
  };
}

function getRuns() {
  return runs;
}

function getServerRuns() {
  return EMPTY_RUNS;
}

function emitRuns() {
  runListeners.forEach((listener) => listener());
}

function setRun(projectId: number, patch: Partial<Run>) {
  const previous: Run = runs[projectId] ?? {
    projectId,
    stage: null,
    running: false,
    error: null,
    failedStage: null,
    succeeded: false,
    stopped: false,
    activity: null,
    progress: null,
    dismissed: false,
  };
  runs = { ...runs, [projectId]: { ...previous, ...patch } };
  emitRuns();
}

function countRunning() {
  return Object.values(runs).filter((run) => run.running).length;
}

/** Tell the page to refresh the sidebar (a step started or finished). */
function notifyProgress() {
  progressHandlers.forEach((handler) => handler());
}

function dismissRun(projectId: number) {
  if (runs[projectId]) setRun(projectId, { dismissed: true });
}

function dismissFinishedRuns() {
  runs = Object.fromEntries(
    Object.entries(runs).map(([id, run]) => [id, run.succeeded ? { ...run, dismissed: true } : run])
  ) as Record<number, Run>;
  emitRuns();
}

/* Live updates pushed by the server over the socket. */

function applyActivity(projectId: number, message: string) {
  if (runs[projectId]?.running) setRun(projectId, { activity: message });
}

function applyTaskProgress(projectId: number, completed?: number, total?: number) {
  if (!runs[projectId]?.running) return;
  if (typeof completed !== "number" || typeof total !== "number" || total <= 0) return;
  setRun(projectId, { progress: { completed, total } });
}

/* Stopping: every active run has a control, so the Stop button can cancel it. */

class StoppedError extends Error {
  constructor() {
    super("Generation stopped.");
    this.name = "StoppedError";
  }
}

type RunControl = { stopped: boolean; stop: () => void; whenStopped: Promise<never> };

const controls = new Map<number, RunControl>();

function createControl(): RunControl {
  let trigger: () => void = () => {};
  const whenStopped = new Promise<never>((_, reject) => {
    trigger = () => reject(new StoppedError());
  });
  // Marks the promise as handled, so stopping never causes an unhandled rejection.
  whenStopped.catch(() => {});

  const control: RunControl = {
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

function stopRun(projectId: number) {
  controls.get(projectId)?.stop();
}

function stopAllRuns() {
  controls.forEach((control) => control.stop());
}

/** Plan and generate a project, or resume from the step that failed. */
async function runPipeline(projectId: number, from: RunStage) {
  if (runs[projectId]?.running) return;

  const control = createControl();
  controls.set(projectId, control);

  let stage: RunStage = from;
  setRun(projectId, {
    stage: from,
    running: true,
    error: null,
    failedStage: null,
    succeeded: false,
    stopped: false,
    activity: null,
    progress: null,
    dismissed: false,
  });
  notifyProgress();

  try {
    if (from === "planning") {
      // Analyze requirements and create the plan.
      await Promise.race([apiPost(`/projects/${projectId}/prepare/`, {}), control.whenStopped]);
    }

    // Stopped just as planning finished: do not start generating.
    if (control.stopped) throw new StoppedError();

    // Create the workspace and execute the plan.
    stage = "generating";
    setRun(projectId, { stage: "generating" });
    notifyProgress();
    await Promise.race([apiPost(`/projects/${projectId}/generate/`, {}), control.whenStopped]);

    setRun(projectId, { stage: null, running: false, succeeded: true });
  } catch (err) {
    if (control.stopped) {
      setRun(projectId, { stage: null, running: false, error: null, failedStage: stage, stopped: true });
    } else {
      setRun(projectId, {
        stage: null,
        running: false,
        error: getErrorMessage(err, "Project generation failed."),
        failedStage: stage,
      });
    }
  } finally {
    if (controls.get(projectId) === control) controls.delete(projectId);
    notifyProgress();
  }
}

/* -------------------------------------------------------------------------- */
/* Icons & small pieces                                                       */
/* -------------------------------------------------------------------------- */

function Icon({ name, className = "h-5 w-5" }: { name: string; className?: string }) {
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
    case "finance":
      return (<svg {...common}><path d="M3 17l6-6 4 4 8-8" /><path d="M15 7h6v6" /></svg>);
    case "cart":
      return (<svg {...common}><circle cx="9" cy="20" r="1.4" /><circle cx="18" cy="20" r="1.4" /><path d="M2 3h3l2.7 12.4a1 1 0 001 .8h9.6a1 1 0 001-.8L21 7H6" /></svg>);
    case "school":
      return (<svg {...common}><path d="M2 9l10-5 10 5-10 5L2 9z" /><path d="M6 11.5V16c0 1.2 2.7 3 6 3s6-1.8 6-3v-4.5" /></svg>);
    case "box":
      return (<svg {...common}><path d="M21 8l-9-5-9 5 9 5 9-5z" /><path d="M3 8v8l9 5 9-5V8" /><path d="M12 13v8" /></svg>);
    case "plus":
      return (<svg {...common}><path d="M12 5v14M5 12h14" /></svg>);
    case "menu":
      return (<svg {...common}><path d="M4 7h16M4 12h16M4 17h16" /></svg>);
    case "close":
      return (<svg {...common}><path d="M6 6l12 12M18 6L6 18" /></svg>);
    case "check":
      return (<svg {...common}><path d="M5 13l4 4L19 7" /></svg>);
    case "spark":
      return (<svg {...common}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" /><path d="M19 16l.7 2.1L22 19l-2.3.9L19 22l-.7-2.1L16 19l2.3-.9L19 16z" /></svg>);
    case "alert":
      return (<svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16.5v.01" /></svg>);
    case "refresh":
      return (<svg {...common}><path d="M20 11a8 8 0 10-2.3 5.7" /><path d="M20 4v7h-7" /></svg>);
    case "arrow":
      return (<svg {...common}><path d="M5 12h14M13 6l6 6-6 6" /></svg>);
    case "stop":
      return (<svg {...common}><rect x="6.5" y="6.5" width="11" height="11" rx="2.5" fill="currentColor" stroke="none" /></svg>);
    case "user":
      return (<svg {...common}><circle cx="12" cy="8" r="3.5" /><path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" /></svg>);
    case "rocket":
      return (<svg {...common}><path d="M5 15c-1.5 1.5-2 4-2 6 2 0 4.5-.5 6-2" /><path d="M14 4c3.5-1 6-1 6-1s0 2.5-1 6l-6 6-5-5 6-6z" /><circle cx="15" cy="9" r="1.2" /></svg>);
    case "coffee":
      return (<svg {...common}><path d="M4 8h13v6a5 5 0 01-5 5H9a5 5 0 01-5-5V8z" /><path d="M17 10h1.5a2.5 2.5 0 010 5H17" /><path d="M8 3v2M12 3v2" /></svg>);
    case "calendar":
      return (<svg {...common}><rect x="3.5" y="5" width="17" height="15" rx="2.5" /><path d="M3.5 10h17M8 3v4M16 3v4" /></svg>);
    default:
      return null;
  }
}

/** Shows whether real-time updates are connected. */
function LivePill({ state }: { state: ConnectionState }) {
  const look = {
    live: {
      label: "Live",
      dot: "bg-emerald-400 shadow-[0_0_8px_#34d399]",
      box: "bg-emerald-500/10 text-emerald-300 ring-emerald-400/30",
      title: "Real-time updates are on",
    },
    connecting: {
      label: "Connecting",
      dot: "animate-pulse bg-amber-400",
      box: "bg-amber-500/10 text-amber-300 ring-amber-400/30",
      title: "Connecting to the real-time server",
    },
    offline: {
      label: "Offline",
      dot: "bg-slate-400",
      box: "bg-slate-500/10 text-slate-300 ring-slate-400/30",
      title: "Real-time updates are off. The page still refreshes when you act.",
    },
  }[state];

  return (
    <span
      title={look.title}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${look.box}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${look.dot}`} />
      {look.label}
    </span>
  );
}

function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" className="opacity-25" />
      <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/* Sidebar project card                                                       */
/* -------------------------------------------------------------------------- */

type ProjectCardProps = {
  project: Project;
  run: Run | undefined;
  isEditing: boolean;
  isBusy: boolean;
  disabled: boolean;
  canRetry: boolean;
  editName: string;
  editDescription: string;
  onEditNameChange: (value: string) => void;
  onEditDescriptionChange: (value: string) => void;
  onStartEditing: () => void;
  onCancelEditing: () => void;
  onSave: () => void;
  onDelete: () => void;
  onRetry: () => void;
  onStop: () => void;
};

function ProjectCard({
  project, run, isEditing, isBusy, disabled, canRetry, editName, editDescription,
  onEditNameChange, onEditDescriptionChange, onStartEditing, onCancelEditing, onSave, onDelete, onRetry, onStop,
}: ProjectCardProps) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const actionsDisabled = isBusy || disabled;

  function handleEditKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancelEditing();
    }
  }

  const field =
    "mt-1.5 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white outline-none transition placeholder:text-white/30 focus:border-violet-400/70 focus:bg-white/10";

  if (isEditing) {
    return (
      <div
        className="rounded-2xl border border-violet-400/40 bg-white/[0.06] p-3 shadow-lg shadow-violet-900/20"
        onKeyDown={handleEditKeyDown}
      >
        <div className="space-y-3">
          <label className="block text-xs font-medium text-white/60">
            Project name
            <input
              value={editName}
              onChange={(e) => onEditNameChange(e.target.value)}
              onKeyDown={(e) => {
                // Ignore Enter while an IME composition is active.
                if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  onSave();
                }
              }}
              maxLength={150}
              autoFocus
              className={field}
              placeholder="Project name"
            />
          </label>
          <label className="block text-xs font-medium text-white/60">
            Description
            <textarea
              value={editDescription}
              onChange={(e) => onEditDescriptionChange(e.target.value)}
              rows={3}
              className={`${field} resize-y`}
              placeholder="Optional description"
            />
          </label>
          <div className="flex gap-2">
            <button
              onClick={onSave}
              disabled={isBusy}
              className={`flex flex-1 items-center justify-center gap-2 rounded-xl ${GRADIENT} px-3 py-2 text-xs font-semibold text-white transition hover:brightness-110 disabled:opacity-50`}
            >
              {isBusy && <Spinner className="h-3 w-3" />}
              {isBusy ? "Saving..." : "Save changes"}
            </button>
            <button
              onClick={onCancelEditing}
              disabled={isBusy}
              className="rounded-xl border border-white/10 px-3 py-2 text-xs text-white/70 transition hover:bg-white/10 disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="group rounded-2xl border border-white/10 bg-white/[0.03] p-3 transition hover:-translate-y-0.5 hover:border-violet-400/40 hover:bg-white/[0.06] hover:shadow-lg hover:shadow-violet-900/20">
      <Link
        href={`/projects/${project.id}`}
        className="block rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 truncate text-sm font-semibold text-white">{projectTitle(project)}</div>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium capitalize ring-1 ring-inset ${statusTone(project.status)}`}>
            {project.status || "unknown"}
          </span>
        </div>
        {project.description && (
          <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-white/50">{project.description}</p>
        )}
        <div className="mt-2 text-[11px] text-white/30">Project #{project.id}</div>
      </Link>

      {run?.running && (
        <div className="mt-2 flex items-center justify-between gap-2 text-xs text-amber-300" role="status">
          <span className="flex min-w-0 items-center gap-2">
            <Spinner className="h-3 w-3 shrink-0" />
            <span className="truncate">
              {run.activity ?? (run.stage === "planning" ? "Analyzing & planning..." : "Generating code...")}
            </span>
          </span>
          <button
            onClick={onStop}
            className="flex shrink-0 items-center gap-1 rounded-full border border-rose-400/40 px-2.5 py-0.5 text-[11px] font-medium text-rose-300 transition hover:bg-rose-500/10"
          >
            <Icon name="stop" className="h-3 w-3" />
            Stop
          </button>
        </div>
      )}

      {run?.error && !run.running && (
        <p className="mt-2 line-clamp-2 break-words text-xs text-rose-300" title={parseError(run.error).summary}>
          {parseError(run.error).summary}
        </p>
      )}

      <div className="mt-3 border-t border-white/10 pt-3">
        {confirmingDelete ? (
          <div className="space-y-2">
            <p className="text-xs text-white/60">Delete this project and its generated files? This cannot be undone.</p>
            <div className="flex gap-2">
              <button
                onClick={() => { setConfirmingDelete(false); onDelete(); }}
                disabled={actionsDisabled}
                className="flex-1 rounded-xl bg-rose-500 px-2 py-1.5 text-xs font-semibold text-white transition hover:bg-rose-400 disabled:opacity-50"
              >
                Yes, delete
              </button>
              <button
                onClick={() => setConfirmingDelete(false)}
                className="flex-1 rounded-xl border border-white/10 px-2 py-1.5 text-xs text-white/70 transition hover:bg-white/10"
              >
                Keep
              </button>
            </div>
          </div>
        ) : (
          <>
            {canRetry && (
              <button
                onClick={onRetry}
                disabled={actionsDisabled}
                className="mb-2 flex w-full items-center justify-center gap-1.5 rounded-xl bg-amber-400 px-2 py-1.5 text-xs font-semibold text-amber-950 transition hover:bg-amber-300 disabled:opacity-50"
              >
                <Icon name="refresh" className="h-3.5 w-3.5" />
                Retry generation
              </button>
            )}
            <div className="flex gap-2">
              <button
                onClick={onStartEditing}
                disabled={actionsDisabled}
                className="flex-1 rounded-xl border border-white/10 px-2 py-1.5 text-xs text-white/70 transition hover:border-violet-400/60 hover:text-violet-200 disabled:opacity-50"
              >
                Edit
              </button>
              <button
                onClick={() => setConfirmingDelete(true)}
                disabled={actionsDisabled}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-white/10 px-2 py-1.5 text-xs text-white/60 transition hover:border-rose-400/60 hover:text-rose-300 disabled:opacity-50"
              >
                {isBusy && <Spinner className="h-3 w-3" />}
                {isBusy ? "Deleting..." : "Delete"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Progress: a gradient bar that fills across three steps                     */
/* -------------------------------------------------------------------------- */

function ProgressLine({ stage }: { stage: Stage }) {
  const activeIndex = STAGES.findIndex((s) => s.key === stage);
  const fill = activeIndex === 0 ? 8 : activeIndex === 1 ? 50 : 92;

  return (
    <ol className="relative mt-8 flex justify-between" aria-label="Progress">
      <div className="absolute left-4 right-4 top-4 h-1 rounded-full bg-white/10" />
      <div
        className={`p2w-draw absolute left-4 top-4 h-1 rounded-full ${GRADIENT} shadow-[0_0_16px_rgba(217,70,239,.7)]`}
        style={{ width: `calc((100% - 2rem) * ${fill / 100})` }}
      />
      {STAGES.map((item, index) => {
        const done = index < activeIndex;
        const active = index === activeIndex;
        return (
          <li key={item.key} className="relative z-10 flex w-20 flex-col items-center gap-2">
            <span
              className={`flex h-9 w-9 items-center justify-center rounded-full border-2 text-white ${done
                ? "border-transparent bg-gradient-to-br from-violet-500 to-fuchsia-500"
                : active
                  ? "p2w-pulse border-amber-300 bg-amber-400"
                  : "border-white/15 bg-[#0d0b1a]"
                }`}
            >
              {done ? <Icon name="check" className="h-4 w-4" /> : <span className={`text-xs font-semibold ${active ? "text-amber-950" : "text-white/30"}`}>{index + 1}</span>}
            </span>
            <span className={`text-xs font-medium ${active ? "text-amber-300" : done ? "text-violet-300" : "text-white/30"}`}>
              {item.short}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/* -------------------------------------------------------------------------- */
/* Run card: progress, failure with Retry, or success for one project         */
/* -------------------------------------------------------------------------- */

function RunCard({
  title,
  run,
  onRetry,
  onStop,
  onDismiss,
}: {
  title: string;
  run: Run;
  onRetry: () => void;
  onStop: () => void;
  onDismiss: () => void;
}) {
  const href = `/projects/${run.projectId}`;

  if (run.running && run.stage) {
    const label = STAGES.find((s) => s.key === run.stage)?.label;
    return (
      <div role="status" aria-live="polite" className="rounded-3xl border border-amber-300/30 bg-white/[0.04] p-5 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <p className="min-w-0 truncate text-sm font-semibold text-white">{title}</p>
          <span className="shrink-0 rounded-full bg-amber-400/10 px-3 py-1 text-xs font-medium text-amber-300">{label}</span>
        </div>
        <div className="mx-auto max-w-md">
          <ProgressLine stage={run.stage} />
        </div>

        {(run.activity || run.progress) && (
          <div className="mx-auto mt-6 max-w-md rounded-2xl border border-white/10 bg-black/20 p-3" aria-live="polite">
            <div className="flex items-center justify-between gap-3 text-xs">
              <span className="flex min-w-0 items-center gap-2 text-white/70">
                <span className="relative flex h-2 w-2 shrink-0">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/60" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                </span>
                <span className="truncate">{run.activity ?? "Working..."}</span>
              </span>
              {run.progress && (
                <span className="shrink-0 font-medium text-fuchsia-300">
                  {run.progress.completed}/{run.progress.total} tasks
                </span>
              )}
            </div>
            {run.progress && (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                <div
                  className={`p2w-draw h-full rounded-full ${GRADIENT}`}
                  style={{ width: `${Math.round((run.progress.completed / run.progress.total) * 100)}%` }}
                />
              </div>
            )}
          </div>
        )}

        <div className="mt-6 flex flex-col items-center gap-3">
          <button
            onClick={onStop}
            className="flex items-center gap-2 rounded-full border border-rose-400/40 bg-rose-500/10 px-5 py-2 text-sm font-semibold text-rose-200 transition hover:border-rose-300 hover:bg-rose-500/20"
          >
            <Icon name="stop" className="h-4 w-4" />
            Stop generating
          </button>
          <p className="text-center text-xs text-white/40">
            This can take a few minutes. You can leave this page and it keeps running; closing the tab stops it.
          </p>
        </div>
      </div>
    );
  }

  if (run.stopped) {
    return (
      <div
        role="status"
        className="flex items-start gap-3 rounded-3xl border border-amber-300/30 bg-amber-400/10 p-4 text-sm text-amber-100"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-400/20 text-amber-300">
          <Icon name="stop" className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-amber-200/60">{title}</p>
          <p className="mt-0.5 font-medium">Generation stopped.</p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={onRetry}
              className="flex items-center gap-1.5 rounded-full bg-amber-400 px-4 py-1.5 text-xs font-semibold text-amber-950 transition hover:bg-amber-300"
            >
              <Icon name="refresh" className="h-3.5 w-3.5" />
              {run.failedStage === "planning" ? "Retry from planning" : "Retry generation"}
            </button>
            <Link
              href={href}
              className="rounded-full border border-amber-200/30 px-4 py-1.5 text-xs text-amber-100 transition hover:border-amber-200 hover:text-white"
            >
              Open project
            </Link>
          </div>
        </div>
        <button
          onClick={onDismiss}
          className="shrink-0 rounded-full p-1 text-amber-200/70 transition hover:bg-white/10 hover:text-white"
          aria-label="Dismiss"
        >
          <Icon name="close" className="h-4 w-4" />
        </button>
      </div>
    );
  }

  if (run.error) {
    const parsed = parseError(run.error);
    return (
      <div
        role="alert"
        className="flex items-start gap-3 overflow-hidden rounded-3xl border border-rose-400/30 bg-rose-500/10 p-4 text-sm text-rose-100"
      >
        <Icon name="alert" className="mt-0.5 h-5 w-5 shrink-0 text-rose-300" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs text-rose-200/60">{title}</p>
          <p className="mt-0.5 break-words font-medium">{parsed.summary}</p>
          {parsed.details && (
            <details className="mt-2 text-xs text-rose-100/80">
              <summary className="cursor-pointer select-none hover:text-white">Technical details</summary>
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-black/40 p-3 font-mono text-[11px] leading-relaxed">
                {parsed.details}
              </pre>
            </details>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={onRetry}
              className="flex items-center gap-1.5 rounded-full bg-amber-400 px-4 py-1.5 text-xs font-semibold text-amber-950 transition hover:bg-amber-300"
            >
              <Icon name="refresh" className="h-3.5 w-3.5" />
              {run.failedStage === "planning" ? "Retry from planning" : "Retry generation"}
            </button>
            <Link
              href={href}
              className="rounded-full border border-rose-300/30 px-4 py-1.5 text-xs text-rose-100 transition hover:border-rose-300 hover:text-white"
            >
              Open project
            </Link>
          </div>
        </div>
        <button
          onClick={onDismiss}
          className="shrink-0 rounded-full p-1 text-rose-300 transition hover:bg-white/10 hover:text-white"
          aria-label="Dismiss"
        >
          <Icon name="close" className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div
      role="status"
      className="flex items-center gap-3 rounded-3xl border border-emerald-400/30 bg-emerald-500/10 p-4 text-sm text-emerald-100"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-400 text-emerald-950">
        <Icon name="check" className="h-4 w-4" />
      </span>
      <span className="flex-1">
        <strong className="font-semibold">{title}</strong> was generated successfully.
      </span>
      <Link
        href={href}
        className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-400 px-4 py-1.5 text-xs font-semibold text-emerald-950 transition hover:bg-emerald-300"
      >
        Open project
        <Icon name="arrow" className="h-3.5 w-3.5" />
      </Link>
      <button
        onClick={onDismiss}
        className="shrink-0 rounded-full p-1 text-emerald-200/70 transition hover:bg-white/10 hover:text-white"
        aria-label="Dismiss"
      >
        <Icon name="close" className="h-4 w-4" />
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export default function Home() {
  const [prompt, setPrompt] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [backendOnline, setBackendOnline] = useState<boolean | null>(null);
  /** True only while the project is being saved; generation then runs in the background. */
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [hintIndex, setHintIndex] = useState(0);

  const [editingProjectId, setEditingProjectId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [busyProjectId, setBusyProjectId] = useState<number | null>(null);

  const runMap = useSyncExternalStore(subscribeRuns, getRuns, getServerRuns);
  const runList = Object.values(runMap)
    .filter((run) => !run.dismissed)
    .sort((a, b) => b.projectId - a.projectId);
  const activeRuns = Object.values(runMap).filter((run) => run.running).length;

  const mountedRef = useRef(true);
  const mainRef = useRef<HTMLElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Cycle the placeholder hint while the box is empty.
  useEffect(() => {
    const id = setInterval(() => setHintIndex((i) => (i + 1) % HINTS.length), 3800);
    return () => clearInterval(id);
  }, []);

  // A soft spotlight follows the cursor.
  function handleMouseMove(event: MouseEvent<HTMLElement>) {
    const el = mainRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${event.clientX - rect.left}px`);
    el.style.setProperty("--my", `${event.clientY - rect.top}px`);
  }

  /**
   * Loads projects. It only reports its own failure and never clears an
   * existing error, so another error is not wiped by a refresh.
   */
  const loadProjects = useCallback(async () => {
    try {
      const data = await apiGet<Project[] | { results: Project[] }>("/projects/");
      if (!mountedRef.current) return;

      setProjects(Array.isArray(data) ? data : data.results ?? []);
      setBackendOnline(true);
    } catch (err) {
      if (!mountedRef.current) return;

      setBackendOnline(false);
      setError((current) => current ?? getErrorMessage(err, "Could not load projects."));
    } finally {
      if (mountedRef.current) setLoadingProjects(false);
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  // Real-time updates: statuses in the sidebar and live progress on the run cards.
  const socketState = useRealtime({
    all: true,
    onStatus: (event) => {
      setProjects((current) =>
        current.map((project) => (project.id === event.projectId ? { ...project, status: event.status } : project))
      );
    },
    onTask: (event) => applyTaskProgress(event.projectId, event.completed, event.total),
    onActivity: (event) => applyActivity(event.projectId, event.message),
    // After a dropped connection, re-read anything that changed while we were away.
    onResync: () => {
      void loadProjects();
    },
  });

  // Keep the sidebar statuses fresh while a run moves between steps and when it ends.
  useEffect(() => {
    const handler = () => {
      void loadProjects();
    };
    progressHandlers.add(handler);
    return () => {
      progressHandlers.delete(handler);
    };
  }, [loadProjects]);

  // Warn before a reload or close throws away a run that is still going.
  useEffect(() => {
    if (activeRuns === 0) return;

    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [activeRuns]);

  /* ----------------------------- Create project ---------------------------- */

  function limitMessage() {
    return `${MAX_PARALLEL_RUNS} project${MAX_PARALLEL_RUNS > 1 ? "s are" : " is"} already generating. Wait for one to finish, then try again.`;
  }

  async function handleSend() {
    const cleanedPrompt = prompt.trim();

    if (creating) return;

    if (!cleanedPrompt) {
      setError("Please describe the web page you want to build.");
      return;
    }

    if (countRunning() >= MAX_PARALLEL_RUNS) {
      setError(limitMessage());
      return;
    }

    setError(null);
    setCreating(true);

    try {
      // Save the project in the backend.
      const project = await apiPost<Project>("/projects/", { initial_prompt: cleanedPrompt });

      // Show it in the sidebar right away and free the form for the next idea.
      setProjects((current) => [project, ...current]);
      setPrompt((current) =>
        current === cleanedPrompt ? "" : current
      );

      // Plan and generate in the background. Progress and failures appear below the form.
      void runPipeline(project.id, "planning");
    } catch (err) {
      setError(getErrorMessage(err, "Could not create the project."));
    } finally {
      if (mountedRef.current) setCreating(false);
    }
  }

  function handlePromptKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Ctrl/Cmd + Enter submits.
    if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      handleSend();
    }
  }


  /** Start a fresh project without interrupting existing generation tasks. */
  function resetForm() {
    setPrompt("");
    setError(null);

    cancelEditing();
    setSidebarOpen(false);
    dismissFinishedRuns();

    scrollRef.current?.scrollTo({
      top: 0,
      behavior: "smooth",
    });

    requestAnimationFrame(() => {
      textareaRef.current?.focus();
    });
  }


  /* ------------------------------ Retry project ---------------------------- */

  function retryProject(projectId: number) {
    if (runMap[projectId]?.running) return;

    if (countRunning() >= MAX_PARALLEL_RUNS) {
      setError(limitMessage());
      return;
    }

    setError(null);

    // If the failure stage is known, resume there.
    // After a page reload, the stage is unknown, so
    // retry from planning instead of assuming a plan exists.
    const retryFrom =
      runMap[projectId]?.failedStage ?? "planning";

    void runPipeline(projectId, retryFrom);
  }

  /* ------------------------------ Edit project ----------------------------- */

  function startEditing(project: Project) {
    setEditingProjectId(project.id);
    // Use the real name only. projectTitle() can return a truncated prompt
    // ending in "...", which would otherwise get saved as the project name.
    setEditName(project.name ?? "");
    setEditDescription(project.description || "");
    setError(null);
  }

  function cancelEditing() {
    setEditingProjectId(null);
    setEditName("");
    setEditDescription("");
  }

  async function saveProject(projectId: number) {
    const cleanedName = editName.trim();

    if (!cleanedName) {
      setError("Project name cannot be empty.");
      return;
    }

    try {
      setBusyProjectId(projectId);
      setError(null);

      const updatedProject = await apiPatch<Project>(`/projects/${projectId}/`, {
        name: cleanedName,
        description: editDescription.trim(),
      });

      setProjects((current) =>
        current.map((project) => (project.id === projectId ? { ...project, ...updatedProject } : project))
      );

      cancelEditing();
    } catch (err) {
      setError(getErrorMessage(err, "Could not update the project."));
    } finally {
      if (mountedRef.current) setBusyProjectId(null);
    }
  }

  /* ----------------------------- Delete project ---------------------------- */

  async function deleteProject(project: Project) {
    try {
      setBusyProjectId(project.id);
      setError(null);

      await apiDelete(`/projects/${project.id}/`);

      setProjects((current) => current.filter((item) => item.id !== project.id));
      dismissRun(project.id);

      if (editingProjectId === project.id) cancelEditing();
    } catch (err) {
      setError(getErrorMessage(err, "Could not delete the project."));
    } finally {
      if (mountedRef.current) setBusyProjectId(null);
    }
  }

  /* --------------------------------- Render -------------------------------- */

  const parsedError = error ? parseError(error) : null;

  const sidebar: ReactNode = (
    <>
      <div className="flex items-center justify-between px-5 py-5">
        <div className="flex items-center gap-3">
          <div className={`p2w-float flex h-10 w-10 items-center justify-center rounded-2xl ${GRADIENT} text-white shadow-lg shadow-fuchsia-900/40`}>
            <Icon name="spark" className="h-5 w-5" />
          </div>
          <div>
            <h1 className="p2w-display text-lg font-bold leading-none text-white">Prompt2Web</h1>
            <p className="mt-1 text-xs text-white/40">Describe it. Get a website.</p>
          </div>
        </div>
        <button
          onClick={() => setSidebarOpen(false)}
          className="rounded-full p-1.5 text-white/60 hover:bg-white/10 hover:text-white md:hidden"
          aria-label="Close sidebar"
        >
          <Icon name="close" className="h-5 w-5" />
        </button>
      </div>

      <div className="px-4 pb-4">
        <button
          type="button"
          onClick={resetForm}
          aria-label="Start a new project"
          className="flex w-full items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:border-transparent hover:bg-gradient-to-r hover:from-violet-500 hover:via-fuchsia-500 hover:to-orange-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-400"
        >
          <Icon name="plus" className="h-4 w-4" />
          New project
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <div className="mb-3 flex items-center justify-between px-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-white/40">My projects</p>
          {!loadingProjects && (
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium text-white/70">{projects.length}</span>
          )}
        </div>

        {loadingProjects ? (
          <div className="space-y-2" aria-label="Loading projects">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-24 animate-pulse rounded-2xl bg-white/5" />
            ))}
          </div>
        ) : projects.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/15 px-4 py-10 text-center">
            <p className="text-sm font-semibold text-white/80">No projects yet</p>
            <p className="mt-1 text-xs text-white/40">Describe a page on the right to create your first one.</p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {projects.map((project) => {
              const run = runMap[project.id];
              // Failed on the server, or failed in this session and not retried since.
              const canRetry =
                !run?.running && !run?.succeeded && (!!run?.error || !!run?.stopped || isFailedStatus(project.status));

              return (
                <ProjectCard
                  key={project.id}
                  project={project}
                  run={run}
                  isEditing={editingProjectId === project.id}
                  isBusy={busyProjectId === project.id}
                  disabled={!!run?.running}
                  canRetry={canRetry}
                  editName={editName}
                  editDescription={editDescription}
                  onEditNameChange={setEditName}
                  onEditDescriptionChange={setEditDescription}
                  onStartEditing={() => startEditing(project)}
                  onCancelEditing={cancelEditing}
                  onSave={() => saveProject(project.id)}
                  onDelete={() => deleteProject(project)}
                  onRetry={() => retryProject(project.id)}
                  onStop={() => stopRun(project.id)}
                />
              );
            })}
          </div>
        )}
      </div>

      <div className="m-4 flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
        <span className="text-xs text-white/50">Model</span>
        <span className="flex items-center gap-2 text-xs font-medium text-white">
          <span className="h-1.5 w-1.5 rounded-full bg-fuchsia-400 shadow-[0_0_8px_#e879f9]" />
          {MODEL_LABEL}
        </span>
      </div>
    </>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-[#07060f] text-white antialiased">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=Inter:wght@400;500;600&display=swap');
        .p2w-root, .p2w-root button, .p2w-root textarea, .p2w-root input { font-family: 'Inter', system-ui, sans-serif; }
        .p2w-display { font-family: 'Bricolage Grotesque', 'Inter', system-ui, sans-serif; letter-spacing: -0.02em; }
        .p2w-spot { position: absolute; inset: 0; pointer-events: none;
          background: radial-gradient(420px circle at var(--mx, 50%) var(--my, 25%), rgba(168,85,247,.16), transparent 70%); }
        .p2w-dots { position: absolute; inset: 0; pointer-events: none;
          background-image: radial-gradient(rgba(255,255,255,.07) 1px, transparent 1px); background-size: 28px 28px;
          -webkit-mask-image: radial-gradient(ellipse at 50% 30%, #000 20%, transparent 75%);
                  mask-image: radial-gradient(ellipse at 50% 30%, #000 20%, transparent 75%); }
        .p2w-orb { position: absolute; border-radius: 9999px; filter: blur(90px); pointer-events: none; opacity: .55; }
        @keyframes p2w-drift { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(40px,-30px) scale(1.12); } }
        .p2w-orb-a { animation: p2w-drift 16s ease-in-out infinite; }
        .p2w-orb-b { animation: p2w-drift 20s ease-in-out infinite reverse; }
        @keyframes p2w-shine { to { background-position: 200% center; } }
        .p2w-shine { background-size: 200% auto; animation: p2w-shine 6s linear infinite; }
        .p2w-draw { transition: width 1.2s cubic-bezier(.2,.8,.2,1); }
        @keyframes p2w-pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(251,191,36,.55); } 50% { box-shadow: 0 0 0 10px rgba(251,191,36,0); } }
        .p2w-pulse { animation: p2w-pulse 1.6s ease-in-out infinite; }
        @keyframes p2w-float { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
        .p2w-float { animation: p2w-float 4s ease-in-out infinite; }
        @keyframes p2w-border { to { transform: rotate(360deg); } }
        .p2w-busy::before { content: ''; position: absolute; inset: -60%; z-index: -1;
          background: conic-gradient(from 0deg, transparent, #fbbf24, transparent 40%);
          animation: p2w-border 2.4s linear infinite; }
        @keyframes p2w-rise { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: none; } }
        .p2w-rise { animation: p2w-rise .8s cubic-bezier(.2,.8,.2,1) both; }
        .p2w-rise-2 { animation: p2w-rise .8s .12s cubic-bezier(.2,.8,.2,1) both; }
        .p2w-rise-3 { animation: p2w-rise .8s .24s cubic-bezier(.2,.8,.2,1) both; }
        .p2w-scroll::-webkit-scrollbar { width: 8px; }
        .p2w-scroll::-webkit-scrollbar-thumb { background: rgba(255,255,255,.12); border-radius: 9999px; }
        @media (prefers-reduced-motion: reduce) {
          .p2w-pulse, .p2w-float, .p2w-shine, .p2w-rise, .p2w-rise-2, .p2w-rise-3, .p2w-orb-a, .p2w-orb-b, .p2w-busy::before { animation: none !important; }
          .p2w-draw { transition: none; }
        }
      `}</style>

      <div className="p2w-root contents">
        {/* Mobile overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/70 backdrop-blur-sm md:hidden"
            onClick={() => setSidebarOpen(false)}
            aria-hidden
          />
        )}

        {/* Sidebar */}
        <aside
          className={`p2w-scroll fixed inset-y-0 left-0 z-40 flex w-72 shrink-0 flex-col border-r border-white/10 bg-[#0b0919]/95 backdrop-blur-xl transition-transform duration-200 md:static md:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"
            }`}
        >
          {sidebar}
        </aside>

        {/* Main content */}
        <main
          ref={mainRef}
          onMouseMove={handleMouseMove}
          className="relative min-w-0 flex-1 overflow-hidden"
        >
          {/* Background stays put while the content scrolls over it */}
          <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
            <div className="p2w-orb p2w-orb-a -left-20 top-10 h-96 w-96 bg-violet-600" />
            <div className="p2w-orb p2w-orb-b -right-24 top-40 h-[28rem] w-[28rem] bg-fuchsia-600/70" />
            <div className="p2w-orb p2w-orb-a bottom-0 left-1/3 h-72 w-72 bg-orange-500/40" />
            <div className="p2w-dots" />
            <div className="p2w-spot" />
          </div>

          <div ref={scrollRef} className="p2w-scroll relative z-10 flex h-full flex-col overflow-y-auto overflow-x-hidden">

          <header className="sticky top-0 z-10 flex h-16 shrink-0 items-center justify-between border-b border-white/10 bg-[#07060f]/60 px-4 backdrop-blur-xl sm:px-6">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setSidebarOpen(true)}
                className="rounded-full p-2 text-white/70 hover:bg-white/10 hover:text-white md:hidden"
                aria-label="Open sidebar"
              >
                <Icon name="menu" className="h-5 w-5" />
              </button>
              <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-white/70">
                New project
              </span>
              <LivePill state={socketState} />
            </div>

            {backendOnline !== null && (
              <div
                className={`flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ring-1 ring-inset ${backendOnline ? "bg-emerald-500/10 text-emerald-300 ring-emerald-400/30" : "bg-rose-500/10 text-rose-300 ring-rose-400/30"
                  }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${backendOnline ? "bg-emerald-400" : "bg-rose-400"}`} />
                {backendOnline ? "Backend connected" : "Backend unreachable"}
              </div>
            )}
          </header>

          <section className="relative flex flex-1 flex-col items-center justify-center px-4 py-12 sm:px-8">
            <div className="w-full max-w-3xl">
              <div className="p2w-rise mb-10 text-center">
                <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-xs font-medium text-white/70 backdrop-blur">
                  <Icon name="spark" className="h-3.5 w-3.5 text-fuchsia-300" />
                  AI WebPage builder
                </span>
                <h2 className="p2w-display mt-6 text-5xl font-extrabold leading-[1.02] sm:text-7xl">
                  Turn your idea into
                  <br />
                  <span className={`p2w-shine bg-gradient-to-r from-violet-400 via-fuchsia-400 via-orange-300 to-violet-400 bg-clip-text text-transparent`}>
                    a beautiful web page.
                  </span>
                </h2>
                <p className="mx-auto mt-6 max-w-xl text-base leading-relaxed text-white/55">
                  Write a few lines about what you need. Prompt2Web plans the layout, then
                  generates a static website (HTML and CSS) you can open and edit.
                </p>
              </div>

              {/* Prompt card */}
              <div className="p2w-rise-2 relative overflow-hidden rounded-3xl p-[1.5px]">
                {creating && <div className="p2w-busy absolute inset-0" aria-hidden />}
                <div
                  className={`relative rounded-3xl bg-[#0e0c1f]/95 p-3 backdrop-blur transition focus-within:shadow-[0_0_80px_-20px_rgba(217,70,239,.6)] ${creating ? "" : "ring-1 ring-white/10 focus-within:ring-fuchsia-400/60"
                    }`}
                >
                  <textarea
                    ref={textareaRef}
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value.slice(0, MAX_PROMPT_LENGTH))}
                    onKeyDown={handlePromptKeyDown}
                    disabled={creating}
                    placeholder={HINTS[hintIndex]}
                    aria-label="Describe your web page"
                    rows={5}
                    className="w-full resize-none bg-transparent p-3 text-base leading-relaxed text-white outline-none placeholder:text-white/30 disabled:opacity-60"
                  />

                  <div className="flex flex-wrap items-center justify-between gap-3 px-2 pb-1 pt-2">
                    <div className="flex items-center gap-3 text-xs text-white/40">
                      <span className="rounded-full bg-white/10 px-3 py-1 font-medium text-white/80">{STACK_LABEL}</span>
                      <span className="hidden sm:inline">{prompt.length}/{MAX_PROMPT_LENGTH}</span>
                      <span className="hidden text-white/30 sm:inline">Ctrl/⌘ + Enter to send</span>
                    </div>

                    <div className="flex items-center gap-2">
                    {activeRuns > 0 && (
                      <button
                        type="button"
                        onClick={stopAllRuns}
                        className="flex items-center gap-2 rounded-full border border-rose-400/40 bg-rose-500/10 px-5 py-3 text-sm font-semibold text-rose-200 transition hover:border-rose-300 hover:bg-rose-500/20"
                      >
                        <Icon name="stop" className="h-4 w-4" />
                        {activeRuns > 1 ? `Stop all (${activeRuns})` : "Stop"}
                      </button>
                    )}
                    <button
                      onClick={handleSend}
                      disabled={creating || !prompt.trim()}
                      aria-busy={creating}
                      className={`flex min-w-40 items-center justify-center gap-2 rounded-full ${GRADIENT} px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-fuchsia-900/40 transition hover:scale-[1.03] hover:brightness-110 active:scale-100 disabled:cursor-not-allowed disabled:bg-none disabled:bg-white/10 disabled:text-white/30 disabled:shadow-none disabled:hover:scale-100`}
                    >
                      {creating ? <Spinner /> : <Icon name="spark" className="h-4 w-4" />}
                      {creating ? "Saving project..." : "Generate"}
                    </button>
                    </div>
                  </div>
                </div>
              </div>

              {parsedError && (
                <div
                  role="alert"
                  className="mt-5 flex items-start gap-3 overflow-hidden rounded-3xl border border-rose-400/30 bg-rose-500/10 p-4 text-sm text-rose-100"
                >
                  <Icon name="alert" className="mt-0.5 h-5 w-5 shrink-0 text-rose-300" />
                  <div className="min-w-0 flex-1">
                    <p className="break-words font-medium">{parsedError.summary}</p>
                    {parsedError.details && (
                      <details className="mt-2 text-xs text-rose-100/80">
                        <summary className="cursor-pointer select-none hover:text-white">Technical details</summary>
                        <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-black/40 p-3 font-mono text-[11px] leading-relaxed">
                          {parsedError.details}
                        </pre>
                      </details>
                    )}
                  </div>
                  <button
                    onClick={() => setError(null)}
                    className="shrink-0 rounded-full p-1 text-rose-300 transition hover:bg-white/10 hover:text-white"
                    aria-label="Dismiss error"
                  >
                    <Icon name="close" className="h-4 w-4" />
                  </button>
                </div>
              )}

              {/* Projects generating in the background, failed (with Retry) or just finished */}
              {runList.length > 0 && (
                <div className="mt-5 space-y-3">
                  {runList.map((run) => {
                    const project = projects.find((item) => item.id === run.projectId);
                    return (
                      <RunCard
                        key={run.projectId}
                        title={project ? projectTitle(project) : `Project #${run.projectId}`}
                        run={run}
                        onRetry={() => retryProject(run.projectId)}
                        onStop={() => stopRun(run.projectId)}
                        onDismiss={() => dismissRun(run.projectId)}
                      />
                    );
                  })}
                </div>
              )}

              {/* Quick starts */}
              <div className="p2w-rise-3 mt-12">
                <p className="mb-4 text-center text-xs font-semibold uppercase tracking-wider text-white/40">
                  Or start from a template idea
                </p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {QUICK_STARTS.map((item) => (
                    <button
                      key={item.label}
                      onClick={() => {
                        setPrompt(item.prompt);
                        textareaRef.current?.focus();
                      }}
                      disabled={creating}
                      className="group flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.04] p-4 text-left backdrop-blur transition hover:-translate-y-1 hover:border-white/25 hover:bg-white/[0.08] hover:shadow-xl hover:shadow-black/40 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0"
                    >
                      <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${item.accent} text-white shadow-lg transition group-hover:scale-110 group-hover:rotate-3`}>
                        <Icon name={item.icon} className="h-6 w-6" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="p2w-display block text-base font-bold leading-tight text-white">{item.label}</span>
                        <span className="mt-0.5 block truncate text-xs text-white/45">{item.hint}</span>
                      </span>
                      <Icon name="arrow" className="h-4 w-4 shrink-0 text-white/20 transition group-hover:translate-x-1 group-hover:text-white" />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </section>
          </div>
        </main>
      </div>
    </div>
  );
}