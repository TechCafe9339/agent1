"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";

import ProjectFiles from "./ProjectFiles";
import ProjectChat from "./ProjectChat";
import ProjectPreview from "./ProjectPreview";
import { usePreview } from "./Usepreview";
import { apiGet } from "../../../lib/api";
import { useRealtime } from "../../../lib/realtime";
import type { ConnectionState } from "../../../lib/realtime";

/* -------------------------------------------------------------------------- */
/* Types & constants                                                          */
/* -------------------------------------------------------------------------- */

type Project = {
  id: number;
  name: string;
  description: string;
  initial_prompt: string;
  status: string;
  created_at: string;
  updated_at: string;
};

type Specification = {
  id: number;
  name: string;
  description: string;
  application_type: string;
  stack: Record<string, unknown>;
  features: string[];
  entities: unknown[];
  pages: unknown[];
  user_roles: string[];
  assumptions: string[];
};

type PlanTask = { id: number; task_number: number; title: string; status: string };
type Plan = { id: number; tasks: PlanTask[] };

type WorkspaceResponse = {
  project: Project;
  specification: Specification | null;
  plan: Plan | null;
};

type Props = { projectId: string };

type TabKey = "overview" | "chat" | "files" | "tests" | "builds" | "preview";

const TABS: { key: TabKey; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "chat", label: "Chat" },
  { key: "files", label: "Files" },
  { key: "tests", label: "Tests" },
  { key: "builds", label: "Builds" },
  { key: "preview", label: "Preview" },
];

const TECH_STACK = [
  { label: "Type", value: "Static page" },
  { label: "Markup", value: "HTML" },
  { label: "Styling", value: "CSS" },
  { label: "Behavior", value: "JavaScript" },
];

const PLACEHOLDERS: Partial<Record<TabKey, { title: string; text: string }>> = {
  tests: { title: "No test results yet", text: "Test results will appear here once tests have been run." },
  builds: { title: "No builds yet", text: "Build history will appear here after the first build." },
};

const GRADIENT = "bg-gradient-to-r from-violet-500 via-fuchsia-500 to-orange-400";

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

type Tone = "success" | "danger" | "warning" | "neutral";

function toneOf(status: string): Tone {
  const s = (status || "").toLowerCase();
  if (/(fail|error|blocked)/.test(s)) return "danger";
  if (/(ready|complete|done|success|generated|passed)/.test(s)) return "success";
  if (/(generat|plan|prepar|running|progress|pending|queued)/.test(s)) return "warning";
  return "neutral";
}

const BADGE: Record<Tone, string> = {
  success: "bg-emerald-500/10 text-emerald-300 ring-emerald-400/30",
  danger: "bg-rose-500/10 text-rose-300 ring-rose-400/30",
  warning: "bg-amber-500/10 text-amber-300 ring-amber-400/30",
  neutral: "bg-slate-500/10 text-slate-300 ring-slate-400/30",
};

const TEXT_TONE: Record<Tone, string> = {
  success: "text-emerald-300",
  danger: "text-rose-300",
  warning: "text-amber-300",
  neutral: "text-white",
};

function formatStatus(status: string) {
  return (status || "unknown").replace(/[_-]+/g, " ");
}

function formatDate(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium capitalize ring-1 ring-inset ${BADGE[toneOf(status)]}`}>
      {formatStatus(status)}
    </span>
  );
}

function AlertIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v5M12 16.5v.01" />
    </svg>
  );
}

function Card({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-3xl border border-white/10 bg-white/[0.04] p-6 shadow-xl shadow-black/20 backdrop-blur ${className}`}>
      <h2 className="p2w-display flex items-center gap-2 text-lg font-bold leading-none text-white">
        <span className={`h-4 w-1 rounded-full ${GRADIENT}`} aria-hidden />
        {title}
      </h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wider text-white/40">{label}</div>
      <div className="mt-1.5 text-sm leading-relaxed text-white/80">{children}</div>
    </div>
  );
}

function Chips({ items, tone = "violet" }: { items: string[]; tone?: "violet" | "slate" }) {
  const cls =
    tone === "violet"
      ? "border-violet-400/30 bg-violet-500/10 text-violet-200"
      : "border-white/10 bg-white/5 text-white/70";
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item, index) => (
        <span key={`${item}-${index}`} className={`rounded-full border px-3 py-1 text-xs font-medium ${cls}`}>
          {item}
        </span>
      ))}
    </div>
  );
}

type ActivityItem = { id: string; message: string; at: string };

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
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
      title: "Real-time updates are off. Reload to refresh.",
    },
  }[state];

  return (
    <span
      title={look.title}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${look.box}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${look.dot}`} />
      {look.label}
    </span>
  );
}

/** The newest line is at the bottom, and the list follows it. */
function ActivityFeed({ items }: { items: ActivityItem[] }) {
  const boxRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items.length]);

  if (items.length === 0) {
    return <p className="text-sm text-white/45">Waiting for the next update...</p>;
  }

  return (
    <div ref={boxRef} role="log" aria-live="polite" className="max-h-56 space-y-2 overflow-y-auto pr-1">
      {items.map((item) => (
        <div key={item.id} className="flex gap-3 text-sm">
          <span className="shrink-0 pt-0.5 font-mono text-[11px] text-white/30">{formatTime(item.at)}</span>
          <span className="min-w-0 break-words text-white/75">{item.message}</span>
        </div>
      ))}
    </div>
  );
}

/** A step on the plan rail: gradient check when done, red when failed, numbered otherwise. */
function Station({ task }: { task: PlanTask }) {
  const tone = toneOf(task.status);
  const base = "relative z-10 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-semibold";
  if (tone === "success") {
    return (
      <span className={`${base} bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white`}>
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M5 13l4 4L19 7" />
        </svg>
      </span>
    );
  }
  if (tone === "danger") {
    return (
      <span className={`${base} bg-rose-500 text-white`}>
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </span>
    );
  }
  return (
    <span className={`${base} border-2 ${tone === "warning" ? "bp-pulse border-amber-300 bg-amber-400 text-amber-950" : "border-white/15 bg-[#0d0b1a] text-white/40"}`}>
      {task.task_number}
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Shared styles & backdrop                                                   */
/* (old bp-* class names are kept so the Files / Chat / Preview tabs still    */
/* find the helpers they use)                                                 */
/* -------------------------------------------------------------------------- */

const STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=Instrument+Serif:ital@0;1&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap');
  .bp-serif { font-family: 'Instrument Serif', Georgia, serif; font-weight: 400; }
  .p2w-display { font-family: 'Bricolage Grotesque', 'Inter', system-ui, sans-serif; letter-spacing: -0.02em; }
  .bp-root, .bp-root button, .bp-root input, .bp-root textarea { font-family: 'Inter', system-ui, sans-serif; }
  .bp-root .font-mono { font-family: 'JetBrains Mono', ui-monospace, monospace; }
  .p2w-bg { position: fixed; inset: 0; overflow: hidden; pointer-events: none; }
  .p2w-orb { position: absolute; border-radius: 9999px; filter: blur(100px); opacity: .4; }
  @keyframes p2w-drift { 0%,100% { transform: translate(0,0) scale(1); } 50% { transform: translate(40px,-30px) scale(1.12); } }
  .p2w-orb-a { animation: p2w-drift 18s ease-in-out infinite; }
  .p2w-orb-b { animation: p2w-drift 22s ease-in-out infinite reverse; }
  .p2w-dots { position: absolute; inset: 0;
    background-image: radial-gradient(rgba(255,255,255,.06) 1px, transparent 1px); background-size: 28px 28px;
    -webkit-mask-image: radial-gradient(ellipse at 50% 20%, #000 15%, transparent 75%);
            mask-image: radial-gradient(ellipse at 50% 20%, #000 15%, transparent 75%); }
  @keyframes bp-pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(251,191,36,.55); } 50% { box-shadow: 0 0 0 9px rgba(251,191,36,0); } }
  .bp-pulse { animation: bp-pulse 1.6s ease-in-out infinite; }
  @keyframes bp-grow { from { transform: scaleY(0); } to { transform: scaleY(1); } }
  .bp-rail { transform-origin: top; animation: bp-grow 1.1s cubic-bezier(.2,.8,.2,1) both; }
  .bp-bar { transition: width 1s cubic-bezier(.2,.8,.2,1); }
  @keyframes p2w-rise { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
  .p2w-rise { animation: p2w-rise .7s cubic-bezier(.2,.8,.2,1) both; }
  @media (prefers-reduced-motion: reduce) {
    .bp-pulse, .bp-rail, .p2w-orb-a, .p2w-orb-b, .p2w-rise { animation: none !important; }
    .bp-bar { transition: none; }
  }
`;

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="bp-root relative min-h-screen bg-[#07060f] text-white antialiased">
      <style>{STYLES}</style>
      <div className="p2w-bg" aria-hidden>
        <div className="p2w-orb p2w-orb-a -left-24 top-0 h-96 w-96 bg-violet-600" />
        <div className="p2w-orb p2w-orb-b -right-24 top-1/3 h-[26rem] w-[26rem] bg-fuchsia-600/70" />
        <div className="p2w-orb p2w-orb-a bottom-0 left-1/3 h-72 w-72 bg-orange-500/40" />
        <div className="p2w-dots" />
      </div>
      <div className="relative">{children}</div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Loading skeleton                                                           */
/* -------------------------------------------------------------------------- */

function LoadingState() {
  return (
    <Shell>
      <div role="status" aria-label="Loading project">
        <div className="border-b border-white/10 px-4 py-6 sm:px-8">
          <div className="h-4 w-28 animate-pulse rounded-full bg-white/10" />
          <div className="mt-4 h-7 w-64 animate-pulse rounded-full bg-white/10" />
        </div>
        <div className="mx-auto grid max-w-6xl gap-6 p-4 sm:p-8 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <div className="h-32 animate-pulse rounded-3xl bg-white/5" />
            <div className="h-56 animate-pulse rounded-3xl bg-white/5" />
          </div>
          <div className="space-y-6">
            <div className="h-28 animate-pulse rounded-3xl bg-white/5" />
            <div className="h-40 animate-pulse rounded-3xl bg-white/5" />
          </div>
        </div>
      </div>
    </Shell>
  );
}

/* -------------------------------------------------------------------------- */
/* Page                                                                       */
/* -------------------------------------------------------------------------- */

export default function ProjectWorkspaceClient({ projectId }: Props) {
  const [data, setData] = useState<WorkspaceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [reloadKey, setReloadKey] = useState(0);

  // Shared by the Files tab (Run button) and the Preview tab.
  const preview = usePreview(projectId);
  const [dirtyCount, setDirtyCount] = useState(0);
  // Files and Preview stay mounted (hidden) after the first visit so the
  // editor's open tabs and the running preview survive switching tabs.
  const [visited, setVisited] = useState<Partial<Record<TabKey, boolean>>>({});

  useEffect(() => {
    setVisited((current) => (current[activeTab] ? current : { ...current, [activeTab]: true }));
  }, [activeTab]);

  /* ------------------------------ Real-time updates ------------------------------ */

  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const activityId = useRef(0);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const numericId = Number(projectId);

  // Re-reads the workspace without the loading skeleton, so open editor tabs survive.
  const refreshQuietly = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(async () => {
      try {
        const result = await apiGet<WorkspaceResponse>(`/projects/${projectId}/workspace/`);
        setData(result);
      } catch {
        // The next event will try again.
      }
    }, 400);
  }, [projectId]);

  useEffect(
    () => () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    },
    []
  );

  const pushActivity = useCallback((message: string, at?: string) => {
    const id = String(++activityId.current);
    setActivity((current) => [...current, { id, message, at: at ?? new Date().toISOString() }].slice(-60));
  }, []);

  const socketState = useRealtime({
    projectId,
    onStatus: (event) => {
      if (event.projectId !== numericId) return;
      setData((current) =>
        current ? { ...current, project: { ...current.project, status: event.status } } : current
      );
      // The specification and plan may have changed along with the status.
      refreshQuietly();
    },
    onTask: (event) => {
      if (event.projectId !== numericId) return;
      setData((current) => {
        if (!current?.plan) return current;
        return {
          ...current,
          plan: {
            ...current.plan,
            tasks: current.plan.tasks.map((task) =>
              task.id === event.taskId
                ? { ...task, status: event.status, title: event.title ?? task.title }
                : task
            ),
          },
        };
      });
      // Also covers a task the page has not seen yet.
      refreshQuietly();
    },
    onActivity: (event) => {
      if (event.projectId === numericId) pushActivity(event.message, event.at);
    },
    onFile: (event) => {
      if (event.projectId === numericId) pushActivity(`${event.action} ${event.path}`);
    },
    // After a dropped connection, re-read anything that changed while we were away.
    onResync: refreshQuietly,
  });

  const openPreview = useCallback(() => setActiveTab("preview"), []);
  const openFiles = useCallback(() => setActiveTab("files"), []);

  useEffect(() => {
    // `cancelled` stops a slow response for an old project id from overwriting
    // the data for the project that is currently open.
    let cancelled = false;

    async function loadWorkspace() {
      setLoading(true);
      setError(null);

      try {
        const result = await apiGet<WorkspaceResponse>(`/projects/${projectId}/workspace/`);
        if (!cancelled) setData(result);
      } catch (err) {
        if (!cancelled) {
          setData(null);
          setError(err instanceof Error && err.message ? err.message : "Failed to load project.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadWorkspace();
    return () => {
      cancelled = true;
    };
  }, [projectId, reloadKey]);

  const retry = useCallback(() => setReloadKey((key) => key + 1), []);

  if (loading) return <LoadingState />;

  if (error || !data) {
    return (
      <Shell>
        <main className="flex min-h-screen items-center justify-center p-6">
          <div role="alert" className="w-full max-w-md rounded-3xl border border-rose-400/30 bg-rose-500/10 p-8 text-center backdrop-blur">
            <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-rose-500/20">
              <AlertIcon className="h-7 w-7 text-rose-300" />
            </span>
            <h1 className="p2w-display mt-4 text-2xl font-bold text-white">Couldn’t open this project</h1>
            <p className="mt-2 break-words text-sm text-rose-100/80">{error ?? "Project not found."}</p>
            <div className="mt-6 flex justify-center gap-3">
              <button
                onClick={retry}
                className={`rounded-full ${GRADIENT} px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-fuchsia-900/40 transition hover:brightness-110`}
              >
                Try again
              </button>
              <Link
                href="/"
                className="rounded-full border border-white/15 px-5 py-2 text-sm text-white/80 transition hover:bg-white/10"
              >
                Back to projects
              </Link>
            </div>
          </div>
        </main>
      </Shell>
    );
  }

  const { project, specification, plan } = data;

  const tasks = plan?.tasks ?? [];
  const sortedTasks = [...tasks].sort((a, b) => a.task_number - b.task_number);
  const completedCount = tasks.filter((t) => toneOf(t.status) === "success").length;
  const failedTask = sortedTasks.find((t) => toneOf(t.status) === "danger");
  const progressPct = tasks.length ? Math.round((completedCount / tasks.length) * 100) : 0;
  const statusTone = toneOf(project.status);

  const title = specification?.name || project.name || `Project #${project.id}`;
  const features = specification?.features ?? [];
  const roles = specification?.user_roles ?? [];
  const assumptions = specification?.assumptions ?? [];
  const updated = formatDate(project.updated_at);

  const placeholder = PLACEHOLDERS[activeTab];

  return (
    <Shell>
      {/* Header (same height as before so the Files / Chat / Preview tabs still fit) */}
      <header className="sticky top-0 z-20 border-b border-white/10 bg-[#07060f]/70 px-3 backdrop-blur-xl sm:px-5">
        <div className="flex h-12 items-center gap-3">
          <Link
            href="/"
            title="My Projects"
            aria-label="Back to My Projects"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/60 transition hover:bg-white/10 hover:text-white"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M15 6l-6 6 6 6" />
            </svg>
          </Link>

          <span className="h-5 w-px shrink-0 bg-white/10" aria-hidden />

          <h1 className="p2w-display min-w-0 truncate text-lg font-bold text-white">{title}</h1>
          <span className="shrink-0 text-xs text-white/30">#{project.id}</span>
          <StatusBadge status={project.status} />
          <LivePill state={socketState} />

          {updated && (
            <span className="ml-auto hidden shrink-0 text-xs text-white/35 lg:block">Updated {updated}</span>
          )}
        </div>

        <nav className="-mb-px flex gap-0.5 overflow-x-auto" role="tablist" aria-label="Project sections">
          {TABS.map((tab) => {
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                role="tab"
                aria-selected={active}
                onClick={() => setActiveTab(tab.key)}
                className={`relative shrink-0 border-b-2 px-3 py-2 text-[13px] font-medium transition ${
                  active
                    ? "border-fuchsia-400 text-white"
                    : "border-transparent text-white/45 hover:border-white/20 hover:text-white/80"
                }`}
              >
                {tab.label}
                {tab.key === "preview" && preview.status !== "stopped" && (
                  <span
                    className={`ml-2 inline-block h-1.5 w-1.5 rounded-full align-middle ${
                      preview.status === "running"
                        ? "bg-emerald-400 shadow-[0_0_8px_#34d399]"
                        : preview.status === "starting"
                        ? "animate-pulse bg-amber-400"
                        : "bg-rose-400"
                    }`}
                    aria-label={`Preview ${preview.status}`}
                  />
                )}
              </button>
            );
          })}
        </nav>
      </header>

      {/* Overview */}
      {activeTab === "overview" && (
        <main className="p2w-rise mx-auto max-w-6xl space-y-6 p-4 sm:p-8">
          {(statusTone === "danger" || failedTask) && (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-3xl border border-rose-400/30 bg-rose-500/10 p-4 text-sm text-rose-100"
            >
              <AlertIcon className="mt-0.5 h-5 w-5 shrink-0 text-rose-300" />
              <div className="min-w-0">
                <p className="font-semibold text-white">Generation did not complete</p>
                <p className="mt-1 break-words">
                  {failedTask
                    ? `Task ${failedTask.task_number}, "${failedTask.title}", failed, so the remaining tasks were not run.`
                    : "The project ended in a failed state."}{" "}
                  Check the Chat or Files tab for details, or create the project again.
                </p>
              </div>
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-3">
            {/* Main column */}
            <div className="min-w-0 space-y-6 lg:col-span-2">
              {(activity.length > 0 || statusTone === "warning") && (
                <Card title="Live activity">
                  <ActivityFeed items={activity} />
                </Card>
              )}

              <Card title="Initial prompt">
                <p className="whitespace-pre-wrap break-words text-base leading-7 text-white/80">
                  {project.initial_prompt}
                </p>
              </Card>

              <Card title="Page specification">
                {!specification ? (
                  <p className="text-sm text-white/45">Specification has not been generated yet.</p>
                ) : (
                  <div className="space-y-5">
                    {specification.description && <Field label="Description">{specification.description}</Field>}

                    <Field label="Page type">
                      <span className="capitalize">{(specification.application_type || "—").replace(/[_-]+/g, " ")}</span>
                    </Field>

                    {features.length > 0 && (
                      <Field label="Features">
                        <Chips items={features.map((f) => f.replace(/[_-]+/g, " "))} />
                      </Field>
                    )}

                    {roles.length > 0 && (
                      <Field label="User roles">
                        <Chips items={roles} tone="slate" />
                      </Field>
                    )}

                    {assumptions.length > 0 && (
                      <Field label="Assumptions">
                        <ul className="list-inside list-disc space-y-1 text-white/70 marker:text-fuchsia-400">
                          {assumptions.map((item, index) => (
                            <li key={index}>{item}</li>
                          ))}
                        </ul>
                      </Field>
                    )}
                  </div>
                )}
              </Card>

              {/* The plan is a real sequence, so it gets a numbered rail. */}
              <Card title="Implementation plan">
                {!plan ? (
                  <p className="text-sm text-white/45">Implementation plan has not been created yet.</p>
                ) : sortedTasks.length === 0 ? (
                  <p className="text-sm text-white/45">This plan has no tasks.</p>
                ) : (
                  <div className="relative">
                    <div className="bp-rail absolute bottom-4 left-[17px] top-4 w-0.5 rounded-full bg-gradient-to-b from-violet-500/60 via-fuchsia-500/40 to-white/10" aria-hidden />
                    <ol className="space-y-3">
                      {sortedTasks.map((task) => (
                        <li key={task.id} className="flex items-center gap-4">
                          <Station task={task} />
                          <div
                            className={`flex min-w-0 flex-1 items-center justify-between gap-3 rounded-2xl border px-4 py-3 transition hover:bg-white/[0.07] ${
                              toneOf(task.status) === "danger"
                                ? "border-rose-400/30 bg-rose-500/10"
                                : "border-white/10 bg-white/[0.04]"
                            }`}
                          >
                            <span className="min-w-0 truncate text-sm font-medium text-white">{task.title}</span>
                            <StatusBadge status={task.status} />
                          </div>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </Card>
            </div>

            {/* Sidebar column */}
            <aside className="space-y-6">
              <Card title="Status">
                <div className={`p2w-display text-4xl font-extrabold capitalize leading-none ${TEXT_TONE[statusTone]}`}>
                  {formatStatus(project.status)}
                </div>
                {formatDate(project.created_at) && (
                  <p className="mt-3 text-xs text-white/35">Created {formatDate(project.created_at)}</p>
                )}
              </Card>

              <Card title="Progress">
                {!plan || tasks.length === 0 ? (
                  <p className="text-sm text-white/45">No tasks available.</p>
                ) : (
                  <div>
                    <div className="flex items-baseline justify-between">
                      <div className="p2w-display text-5xl font-extrabold leading-none text-white">
                        {completedCount}
                        <span className="text-white/25">/{tasks.length}</span>
                      </div>
                      <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-sm font-semibold text-fuchsia-300">{progressPct}%</span>
                    </div>

                    <div
                      className="mt-5 h-2 overflow-hidden rounded-full bg-white/10"
                      role="progressbar"
                      aria-valuenow={progressPct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label="Tasks completed"
                    >
                      <div
                        className={`bp-bar h-full rounded-full ${failedTask ? "bg-rose-500" : `${GRADIENT} shadow-[0_0_14px_rgba(217,70,239,.7)]`}`}
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>

                    <p className="mt-2 text-xs text-white/40">tasks completed</p>
                  </div>
                )}
              </Card>

              <Card title="Tech stack">
                <dl className="space-y-3 text-sm">
                  {TECH_STACK.map((item) => (
                    <div key={item.label} className="flex items-center justify-between border-b border-white/10 pb-3 last:border-0 last:pb-0">
                      <dt className="text-white/50">{item.label}</dt>
                      <dd className="rounded-full bg-white/10 px-3 py-0.5 text-xs font-medium text-white">{item.value}</dd>
                    </div>
                  ))}
                </dl>
              </Card>
            </aside>
          </div>
        </main>
      )}

      {/* Files stays mounted (hidden) after the first visit, so open tabs and
          unsaved edits survive switching to Preview or back. */}
      {visited.files && (
        <div key={projectId} className={activeTab === "files" ? "block" : "hidden"}>
          <ProjectFiles
            projectId={projectId}
            active={activeTab === "files"}
            preview={preview}
            onOpenPreview={openPreview}
            onDirtyChange={setDirtyCount}
          />
        </div>
      )}

      {activeTab === "chat" && <ProjectChat projectId={projectId} />}

      {visited.preview && (
        <div className={activeTab === "preview" ? "block" : "hidden"}>
          <ProjectPreview preview={preview} dirtyCount={dirtyCount} onOpenFiles={openFiles} />
        </div>
      )}

      {placeholder && (
        <main className="mx-auto max-w-6xl p-4 sm:p-8">
          <div className="rounded-3xl border border-dashed border-white/15 bg-white/[0.02] px-6 py-16 text-center">
            <p className="p2w-display text-2xl font-bold text-white/85">{placeholder.title}</p>
            <p className="mt-2 text-sm text-white/45">{placeholder.text}</p>
          </div>
        </main>
      )}
    </Shell>
  );
}