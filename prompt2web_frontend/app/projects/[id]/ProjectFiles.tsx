"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import type { BeforeMount, OnMount } from "@monaco-editor/react";

import { apiDelete, apiGet, apiPost } from "../../../lib/api";
import type { PreviewController } from "./Usepreview";
import TerminalPanel, { type TerminalHandle } from "./TerminalPanel";

/* -------------------------------------------------------------------------- */
/* Theme                                                                      */
/*                                                                            */
/* Prompt2Web dashboard palette:                                              */
/*   page        #07050f      panels   #0b0816 / #0f0b1d                      */
/*   hover       #14102a      border   #231b3d / #2f2552                      */
/*   text        #f5f2ff      muted    #8b86a8 / #5e5880                      */
/*   accent      violet #a78bfa, magenta #d946ef -> violet #8b5cf6 (buttons)   */
/*   headline    pink #e0b0d0 -> orange #ffb35c                               */
/*   success     #34d399      warning  #ffb35c      danger #f87171            */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* Types & constants                                                          */
/* -------------------------------------------------------------------------- */

type FileNode = {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileNode[];
};

type FilesResponse = {
  exists: boolean;
  files: FileNode[];
};

type FileResponse = {
  name: string;
  path: string;
  content: string;
};

type FileBuffer = {
  name: string;
  path: string;
  original: string;
  content: string;
};

type Toast = { kind: "error" | "success" | "info"; text: string } | null;

type TerminalTab = { id: string; title: string };

type Props = {
  projectId: string;
  /** False while another tab is showing (the editor stays mounted but hidden). */
  active: boolean;
  preview: PreviewController;
  onOpenPreview: () => void;
  onDirtyChange?: (count: number) => void;
};

/** Maximum number of shells that can be open at once. */
const MAX_TERMINALS = 6;

/**
 * Every backend call the editor makes lives here, so the URLs can be adjusted
 * in one place. Reading files uses your existing endpoints; saving, deleting
 * and running need matching endpoints on the backend.
 */
const API = {
  files: (id: string) => `/projects/${id}/files/`,
  file: (id: string, path: string) => `/projects/${id}/file/?path=${encodeURIComponent(path)}`,
  save: (id: string) => `/projects/${id}/file/save/`, // POST { path, content }
  remove: (id: string, path: string) => `/projects/${id}/file/?path=${encodeURIComponent(path)}`, // DELETE (file or folder)
};

const RUN_PRESETS = [
  { label: "Install frontend", command: "cd frontend && npm install" },
  { label: "Install backend", command: "cd backend && npm install" },
  { label: "Build frontend", command: "cd frontend && npm run build" },
  { label: "Test backend", command: "cd backend && npm test" },
];

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback;
}

/** The shell command that runs a file, or null when we don't know how. */
function runCommandFor(path: string): string | null {
  const q = `"${path.replace(/"/g, '\\"')}"`;
  switch (extOf(path)) {
    case "js":
    case "mjs":
    case "cjs":
      return `node ${q}`;
    case "ts":
    case "tsx":
      return `npx tsx ${q}`;
    case "py":
      return `python3 ${q}`;
    case "sh":
      return `bash ${q}`;
    case "sql":
      return null;
    default:
      return null;
  }
}

const LANGUAGES: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  css: "css",
  scss: "scss",
  html: "html",
  md: "markdown",
  sql: "sql",
  py: "python",
  yml: "yaml",
  yaml: "yaml",
  sh: "shell",
  xml: "xml",
  env: "ini",
  gitignore: "plaintext",
  prisma: "plaintext",
};

function extOf(name: string) {
  const lower = name.toLowerCase();
  if (lower.startsWith(".") && !lower.slice(1).includes(".")) return lower.slice(1);
  const dot = lower.lastIndexOf(".");
  return dot === -1 ? "" : lower.slice(dot + 1);
}

function languageFor(name: string) {
  return LANGUAGES[extOf(name)] ?? "plaintext";
}

const BADGES: Record<string, { label: string; cls: string }> = {
  ts: { label: "TS", cls: "text-sky-400" },
  tsx: { label: "TSX", cls: "text-sky-400" },
  js: { label: "JS", cls: "text-yellow-400" },
  jsx: { label: "JSX", cls: "text-yellow-400" },
  mjs: { label: "JS", cls: "text-yellow-400" },
  cjs: { label: "JS", cls: "text-yellow-400" },
  json: { label: "{}", cls: "text-amber-400" },
  css: { label: "CSS", cls: "text-violet-400" },
  scss: { label: "SCSS", cls: "text-pink-400" },
  html: { label: "<>", cls: "text-orange-400" },
  md: { label: "MD", cls: "text-slate-300" },
  sql: { label: "SQL", cls: "text-emerald-400" },
  py: { label: "PY", cls: "text-blue-400" },
  yml: { label: "YML", cls: "text-rose-300" },
  yaml: { label: "YML", cls: "text-rose-300" },
  sh: { label: "SH", cls: "text-green-400" },
  env: { label: "ENV", cls: "text-lime-300" },
  prisma: { label: "PRI", cls: "text-teal-300" },
};

function flatten(nodes: FileNode[]): FileNode[] {
  const out: FileNode[] = [];
  for (const node of nodes) {
    if (node.type === "file") out.push(node);
    else if (node.children) out.push(...flatten(node.children));
  }
  return out;
}

function fuzzyMatch(query: string, target: string) {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (t.includes(q)) return true;
  let i = 0;
  for (const ch of t) {
    if (ch === q[i]) i++;
    if (i === q.length) return true;
  }
  return false;
}

/* -------------------------------------------------------------------------- */
/* Icons & small pieces                                                       */
/* -------------------------------------------------------------------------- */

function Icon({ name, className = "h-4 w-4" }: { name: string; className?: string }) {
  const common = {
    className,
    fill: "none",
    viewBox: "0 0 24 24",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  switch (name) {
    case "chevron":
      return (<svg {...common}><path d="M9 6l6 6-6 6" /></svg>);
    case "folder":
      return (<svg {...common}><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" /></svg>);
    case "file":
      return (<svg {...common}><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8l-5-5z" /><path d="M14 3v5h5" /></svg>);
    case "plus":
      return (<svg {...common}><path d="M12 5v14M5 12h14" /></svg>);
    case "refresh":
      return (<svg {...common}><path d="M20 11a8 8 0 10-2.3 5.7" /><path d="M20 4v7h-7" /></svg>);
    case "save":
      return (<svg {...common}><path d="M5 3h11l3 3v13a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z" /><path d="M7 3v6h8V3M7 21v-7h10v7" /></svg>);
    case "play":
      return (<svg {...common} fill="currentColor" stroke="none"><path d="M7 4.5v15a1 1 0 001.5.86l12-7.5a1 1 0 000-1.72l-12-7.5A1 1 0 007 4.5z" /></svg>);
    case "terminal":
      return (<svg {...common}><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M7 9l3 3-3 3M13 15h4" /></svg>);
    case "stop":
      return (<svg {...common} fill="currentColor" stroke="none"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>);
    case "sidebar":
      return (<svg {...common}><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9 4v16" /></svg>);
    case "close":
      return (<svg {...common}><path d="M6 6l12 12M18 6L6 18" /></svg>);
    case "trash":
      return (<svg {...common}><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3" /></svg>);
    case "search":
      return (<svg {...common}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>);
    case "alert":
      return (<svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16.5v.01" /></svg>);
    case "check":
      return (<svg {...common}><path d="M5 13l4 4L19 7" /></svg>);
    case "sparkle":
      return (<svg {...common}><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3zM19 16l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16z" /></svg>);
    default:
      return null;
  }
}

function Spinner({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg className={`${className} animate-spin`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" className="opacity-25" />
      <path d="M21 12a9 9 0 00-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function FileBadge({ name }: { name: string }) {
  const badge = BADGES[extOf(name)];
  if (!badge) return <Icon name="file" className="h-3.5 w-3.5 shrink-0 text-[#5e5880]" />;
  return (
    <span
      className={`w-5 shrink-0 text-center font-mono text-[9px] font-bold leading-none ${badge.cls}`}
      aria-hidden
    >
      {badge.label}
    </span>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="rounded-lg p-1.5 text-[#8b86a8] transition hover:bg-[#a78bfa]/10 hover:text-white disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-[#8b86a8]"
    >
      {children}
    </button>
  );
}

function EditorSkeleton() {
  return (
    <div className="flex h-full items-center justify-center gap-2 text-sm text-[#8b86a8]" role="status">
      <Spinner className="h-4 w-4" /> Loading editor...
    </div>
  );
}

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), {
  ssr: false,
  loading: () => <EditorSkeleton />,
});

/* -------------------------------------------------------------------------- */
/* Monaco setup                                                               */
/* -------------------------------------------------------------------------- */

type TsDefaults = {
  setCompilerOptions(options: Record<string, unknown>): void;
  setDiagnosticsOptions(options: Record<string, unknown>): void;
};

type TsApi = {
  typescriptDefaults: TsDefaults;
  javascriptDefaults: TsDefaults;
  ScriptTarget: { ESNext: number };
  JsxEmit: { Preserve: number };
  ModuleResolutionKind: { NodeJs: number };
  ModuleKind: { ESNext: number };
};

const handleBeforeMount: BeforeMount = (monaco) => {
  // Prompt2Web palette: near-black violet background, lilac keywords, orange strings.
  monaco.editor.defineTheme("prompt2web", {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "keyword", foreground: "c4b5fd" },
      { token: "string", foreground: "ffb35c" },
      { token: "number", foreground: "34d399" },
      { token: "comment", foreground: "5e5880", fontStyle: "italic" },
      { token: "type", foreground: "f0abfc" },
    ],
    colors: {
      "editor.background": "#07050f",
      "editorGutter.background": "#07050f",
      "minimap.background": "#07050f",
      "editor.lineHighlightBackground": "#110c22",
      "editor.lineHighlightBorder": "#110c22",
      "editorLineNumber.foreground": "#3b3360",
      "editorLineNumber.activeForeground": "#c4b5fd",
      "editor.selectionBackground": "#a78bfa33",
      "editorCursor.foreground": "#f0abfc",
      "editorIndentGuide.background1": "#171229",
      "editorIndentGuide.activeBackground1": "#2f2552",
      "scrollbarSlider.background": "#2f255266",
    },
  });

  // The editor has no project type definitions, so semantic checks would show
  // false "cannot find module" errors. Keep syntax checking, skip the rest.
  const ts =
    (monaco.languages as unknown as { typescript?: TsApi }).typescript ??
    (monaco as unknown as { typescript?: TsApi }).typescript;

  if (ts) {
    const options = {
      target: ts.ScriptTarget.ESNext,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      jsx: ts.JsxEmit.Preserve,
      allowJs: true,
      allowNonTsExtensions: true,
    };
    ts.typescriptDefaults.setCompilerOptions(options);
    ts.javascriptDefaults.setCompilerOptions(options);
    ts.typescriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true });
    ts.javascriptDefaults.setDiagnosticsOptions({ noSemanticValidation: true });
  }
};

/* -------------------------------------------------------------------------- */
/* Explorer tree                                                              */
/* -------------------------------------------------------------------------- */

function TreeItem({
  item,
  depth,
  selectedPath,
  dirtyPaths,
  onSelect,
  onDelete,
}: {
  item: FileNode;
  depth: number;
  selectedPath: string | null;
  dirtyPaths: Set<string>;
  onSelect: (path: string) => void;
  onDelete: (item: FileNode) => void;
}) {
  const [expanded, setExpanded] = useState(depth === 0);
  const pad = { paddingLeft: `${depth * 12 + 8}px` };

  if (item.type === "directory") {
    return (
      <div>
        <div
          style={pad}
          className="group mx-2 flex items-center rounded-lg pr-1 transition hover:bg-[#a78bfa]/10"
        >
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left text-[13px] text-[#cfcae6]"
          >
            <Icon
              name="chevron"
              className={`h-3.5 w-3.5 shrink-0 text-[#5e5880] transition-transform ${expanded ? "rotate-90" : ""}`}
            />
            <Icon name="folder" className="h-3.5 w-3.5 shrink-0 text-[#c084fc]/80" />
            <span className="truncate">{item.name}</span>
          </button>
          <button
            type="button"
            onClick={() => onDelete(item)}
            className="rounded-md p-1 text-[#5e5880] opacity-0 transition hover:text-[#f87171] focus:opacity-100 group-hover:opacity-100"
            aria-label={`Delete folder ${item.name}`}
            title="Delete folder"
          >
            <Icon name="trash" className="h-3.5 w-3.5" />
          </button>
        </div>

        {expanded &&
          item.children?.map((child) => (
            <TreeItem
              key={child.path}
              item={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              dirtyPaths={dirtyPaths}
              onSelect={onSelect}
              onDelete={onDelete}
            />
          ))}
      </div>
    );
  }

  const selected = selectedPath === item.path;
  const dirty = dirtyPaths.has(item.path);

  return (
    <div
      style={{ paddingLeft: `${depth * 12 + 22}px` }}
      className={`group mx-2 flex items-center gap-2 rounded-lg pr-1 transition ${
        selected
          ? "bg-gradient-to-r from-[#d946ef]/20 to-[#8b5cf6]/20 text-white ring-1 ring-inset ring-[#a78bfa]/30"
          : "text-[#a29dbf] hover:bg-[#a78bfa]/10 hover:text-[#f5f2ff]"
      }`}
    >
      <button
        type="button"
        onClick={() => onSelect(item.path)}
        className="flex min-w-0 flex-1 items-center gap-2 py-1.5 text-left text-[13px]"
      >
        <FileBadge name={item.name} />
        <span className="truncate">{item.name}</span>
        {dirty && <span className="ml-auto h-2 w-2 shrink-0 rounded-full bg-[#ffb35c]" title="Unsaved" />}
      </button>
      <button
        type="button"
        onClick={() => onDelete(item)}
        className="rounded-md p-1 text-[#5e5880] opacity-0 transition hover:text-[#f87171] focus:opacity-100 group-hover:opacity-100"
        aria-label={`Delete ${item.name}`}
        title="Delete file"
      >
        <Icon name="trash" className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Quick open (Ctrl/Cmd + P)                                                  */
/* -------------------------------------------------------------------------- */

function QuickOpen({
  files,
  onPick,
  onClose,
}: {
  files: FileNode[];
  onPick: (path: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);

  const results = useMemo(
    () => (query ? files.filter((f) => fuzzyMatch(query, f.path)) : files).slice(0, 50),
    [files, query]
  );

  function onKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      setIndex((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const pick = results[index];
      if (pick) onPick(pick.path);
    }
  }

  return (
    <div
      className="absolute inset-0 z-30 flex items-start justify-center bg-[#02010a]/70 px-4 pt-16 backdrop-blur-sm"
      onMouseDown={onClose}
    >
      <div
        className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-[#a78bfa]/30 bg-[#0f0b1d] shadow-[0_0_60px_-15px_rgba(168,85,247,.5)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIndex(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Go to file..."
          aria-label="Go to file"
          className="w-full border-b border-[#231b3d] bg-transparent px-4 py-3 text-sm text-[#f5f2ff] outline-none placeholder:text-[#5e5880]"
        />
        <ul className="max-h-72 overflow-y-auto py-1.5" role="listbox">
          {results.length === 0 ? (
            <li className="px-4 py-3 text-sm text-[#8b86a8]">No matching files</li>
          ) : (
            results.map((file, i) => (
              <li key={file.path} role="option" aria-selected={i === index}>
                <button
                  type="button"
                  onMouseEnter={() => setIndex(i)}
                  onClick={() => onPick(file.path)}
                  className={`mx-1.5 flex w-[calc(100%-0.75rem)] items-center gap-2.5 rounded-lg px-3 py-1.5 text-left text-sm ${
                    i === index ? "bg-[#a78bfa]/15 text-white" : "text-[#cfcae6]"
                  }`}
                >
                  <FileBadge name={file.name} />
                  <span className="truncate">{file.name}</span>
                  <span className="ml-1 truncate font-mono text-xs text-[#5e5880]">{file.path}</span>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Main component                                                             */
/* -------------------------------------------------------------------------- */

export default function ProjectFiles({
  projectId,
  active,
  preview,
  onOpenPreview,
  onDirtyChange,
}: Props) {
  // Explorer
  const [files, setFiles] = useState<FileNode[]>([]);
  const [workspaceExists, setWorkspaceExists] = useState(true);
  const [treeLoading, setTreeLoading] = useState(true);
  const [treeError, setTreeError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [creating, setCreating] = useState(false);
  const [newPath, setNewPath] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Editor
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [buffers, setBuffers] = useState<Record<string, FileBuffer>>({});
  const [loadingPaths, setLoadingPaths] = useState<Record<string, boolean>>({});
  const [savingPaths, setSavingPaths] = useState<Record<string, boolean>>({});
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  const [wordWrap, setWordWrap] = useState(false);
  const [minimap, setMinimap] = useState(true);
  const [fontSize, setFontSize] = useState(14);
  const [quickOpen, setQuickOpen] = useState(false);
  const [toast, setToast] = useState<Toast>(null);

  // Terminals: each tab is its own real shell (see TerminalPanel). All of them
  // stay mounted while hidden so their shells keep running, like VS Code.
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminals, setTerminals] = useState<TerminalTab[]>([{ id: "t1", title: "Terminal 1" }]);
  const [activeTerminalId, setActiveTerminalId] = useState("t1");
  const terminalCounter = useRef(1);
  const terminalRefs = useRef<Record<string, TerminalHandle | null>>({});

  const mountedRef = useRef(true);
  const loadSeq = useRef(0);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const buffersRef = useRef(buffers);
  buffersRef.current = buffers;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  const flatFiles = useMemo(() => flatten(files), [files]);

  const dirtyPaths = useMemo(() => {
    const set = new Set<string>();
    for (const buf of Object.values(buffers)) {
      if (buf.content !== buf.original) set.add(buf.path);
    }
    return set;
  }, [buffers]);

  const activeBuffer = activePath ? buffers[activePath] : undefined;
  const anySaving = Object.values(savingPaths).some(Boolean);

  // Let the parent know how many files have unsaved edits.
  useEffect(() => {
    onDirtyChange?.(dirtyPaths.size);
  }, [dirtyPaths.size, onDirtyChange]);

  const notify = useCallback((kind: "error" | "success" | "info", text: string) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ kind, text });
    if (kind !== "error") {
      toastTimer.current = setTimeout(() => setToast(null), 2500);
    }
  }, []);

  // Surface a failed run (reported by the preview) as a toast on this page.
  useEffect(() => {
    if (active && preview.status === "failed" && preview.error) {
      notify("error", `Run failed: ${preview.error}`);
    }
  }, [active, preview.status, preview.error, notify]);

  /* ------------------------------ Load files ------------------------------ */

  const loadFiles = useCallback(
    async (silent = false) => {
      const seq = ++loadSeq.current;
      if (!silent) setTreeLoading(true);

      try {
        setTreeError(null);
        const result = await apiGet<FilesResponse>(API.files(projectId));
        if (!mountedRef.current || seq !== loadSeq.current) return;

        setFiles(result.files ?? []);
        setWorkspaceExists(result.exists !== false);
      } catch (err) {
        if (!mountedRef.current || seq !== loadSeq.current) return;
        setTreeError(errorMessage(err, "Failed to load project files."));
      } finally {
        if (mountedRef.current && seq === loadSeq.current) setTreeLoading(false);
      }
    },
    [projectId]
  );

  useEffect(() => {
    // Start clean whenever the project changes.
    setOpenTabs([]);
    setActivePath(null);
    setBuffers({});
    loadFiles();
  }, [projectId, loadFiles]);

  /* ------------------------------ Open / close ----------------------------- */

  const openFile = useCallback(
    async (path: string) => {
      setQuickOpen(false);
      setActivePath(path);
      setOpenTabs((tabs) => (tabs.includes(path) ? tabs : [...tabs, path]));

      if (buffersRef.current[path]) return;

      setLoadingPaths((s) => ({ ...s, [path]: true }));
      try {
        const result = await apiGet<FileResponse>(API.file(projectId, path));
        if (!mountedRef.current) return;

        const content = result.content ?? "";
        setBuffers((b) => ({
          ...b,
          [path]: { name: result.name || path.split("/").pop() || path, path, original: content, content },
        }));
      } catch (err) {
        if (!mountedRef.current) return;
        // Drop the tab that could not be loaded.
        setOpenTabs((tabs) => tabs.filter((p) => p !== path));
        setActivePath((current) => (current === path ? null : current));
        notify("error", `Could not open ${path}: ${errorMessage(err, "Failed to open file.")}`);
      } finally {
        if (mountedRef.current) setLoadingPaths((s) => ({ ...s, [path]: false }));
      }
    },
    [projectId, notify]
  );

  const removeTab = useCallback(
    (path: string) => {
      const index = openTabs.indexOf(path);
      const next = openTabs.filter((p) => p !== path);

      setOpenTabs(next);
      if (activePath === path) setActivePath(next[Math.min(index, next.length - 1)] ?? null);
      setBuffers((b) => {
        const rest = { ...b };
        delete rest[path];
        return rest;
      });
    },
    [openTabs, activePath]
  );

  /** Close several tabs at once (used when a whole folder is deleted). */
  const removeTabs = useCallback(
    (paths: string[]) => {
      const gone = new Set(paths);
      const remaining = openTabs.filter((p) => !gone.has(p));

      setOpenTabs(remaining);

      if (activePath && gone.has(activePath)) {
        const index = openTabs.indexOf(activePath);
        setActivePath(remaining[Math.min(index, remaining.length - 1)] ?? null);
      }

      setBuffers((b) => {
        const rest = { ...b };
        for (const p of paths) delete rest[p];
        return rest;
      });
    },
    [openTabs, activePath]
  );

  function closeTab(path: string) {
    const buf = buffers[path];
    if (
      buf &&
      buf.content !== buf.original &&
      !window.confirm(`"${buf.name}" has unsaved changes. Close it without saving?`)
    ) {
      return;
    }
    removeTab(path);
  }

  /* --------------------------------- Save --------------------------------- */

  const saveFile = useCallback(
    async (path: string): Promise<boolean> => {
      const buf = buffersRef.current[path];
      if (!buf || buf.content === buf.original) return true;

      const snapshot = buf.content;
      setSavingPaths((s) => ({ ...s, [path]: true }));

      try {
        await apiPost(API.save(projectId), { path, content: snapshot });
        if (!mountedRef.current) return true;

        // If the user kept typing while saving, the file correctly stays dirty.
        setBuffers((b) => (b[path] ? { ...b, [path]: { ...b[path], original: snapshot } } : b));
        return true;
      } catch (err) {
        if (mountedRef.current) {
          notify("error", `Could not save ${buf.name}: ${errorMessage(err, "Save failed.")}`);
        }
        return false;
      } finally {
        if (mountedRef.current) setSavingPaths((s) => ({ ...s, [path]: false }));
      }
    },
    [projectId, notify]
  );

  const saveActive = useCallback(async () => {
    if (!activePath) return;
    const buf = buffersRef.current[activePath];
    if (!buf || buf.content === buf.original) {
      notify("info", "No changes to save.");
      return;
    }
    if (await saveFile(activePath)) notify("success", `Saved ${buf.name}`);
  }, [activePath, saveFile, notify]);

  const saveAll = useCallback(async (): Promise<boolean> => {
    const dirty = Object.values(buffersRef.current).filter((b) => b.content !== b.original);
    if (dirty.length === 0) return true;

    let ok = true;
    for (const buf of dirty) {
      if (!(await saveFile(buf.path))) ok = false;
    }
    if (ok) notify("success", `Saved ${dirty.length} file${dirty.length > 1 ? "s" : ""}`);
    return ok;
  }, [saveFile, notify]);

  /* ------------------------------ Create / delete -------------------------- */

  async function createFile() {
    const path = newPath.trim().replace(/\\/g, "/").replace(/^\/+/, "");
    const parts = path.split("/");

    if (!path || parts.some((p) => p === "" || p === "..")) {
      notify("error", "Enter a valid relative path, e.g. frontend/src/utils.ts");
      return;
    }
    if (flatFiles.some((f) => f.path === path)) {
      setCreating(false);
      setNewPath("");
      openFile(path);
      return;
    }

    try {
      await apiPost(API.save(projectId), { path, content: "" });
      setCreating(false);
      setNewPath("");
      await loadFiles(true);
      await openFile(path);
      notify("success", `Created ${path}`);
    } catch (err) {
      notify("error", `Could not create file: ${errorMessage(err, "Request failed.")}`);
    }
  }

  /** Delete a file, or a folder together with everything inside it. */
  async function deleteEntry(item: FileNode) {
    const isDir = item.type === "directory";
    const isAffected = (p: string) => p === item.path || (isDir && p.startsWith(`${item.path}/`));

    const affectedTabs = openTabs.filter(isAffected);
    const unsaved = affectedTabs.filter((p) => dirtyPaths.has(p));

    let message = isDir
      ? `Delete folder "${item.path}" and everything inside it?`
      : `Delete "${item.path}"?`;
    message += "\n\nThis cannot be undone.";
    if (unsaved.length > 0) {
      message += `\n\n${unsaved.length} open file${unsaved.length > 1 ? "s have" : " has"} unsaved changes that will be lost.`;
    }

    if (!window.confirm(message)) return;

    try {
      await apiDelete(API.remove(projectId, item.path));
      if (affectedTabs.length > 0) removeTabs(affectedTabs);
      await loadFiles(true);
      notify("success", `Deleted ${item.name}`);
    } catch (err) {
      notify("error", `Could not delete ${item.name}: ${errorMessage(err, "Request failed.")}`);
    }
  }

  /* -------------------------------- Terminals ------------------------------ */

  /** Open a new shell tab and switch to it. */
  const createTerminal = useCallback(() => {
    if (terminals.length >= MAX_TERMINALS) {
      notify("info", `Terminal limit reached (${MAX_TERMINALS}).`);
      return;
    }
    const n = ++terminalCounter.current;
    const id = `t${n}`;
    setTerminals((list) => [...list, { id, title: `Terminal ${n}` }]);
    setActiveTerminalId(id);
    setTerminalOpen(true);
  }, [terminals.length, notify]);

  /** Close one shell tab (its WebSocket closes and the server kills the pty). */
  const closeTerminal = useCallback(
    (id: string) => {
      delete terminalRefs.current[id];
      const index = terminals.findIndex((t) => t.id === id);
      const next = terminals.filter((t) => t.id !== id);

      if (next.length === 0) {
        // Closing the last shell hides the panel and leaves a fresh one ready.
        const n = ++terminalCounter.current;
        const fresh = { id: `t${n}`, title: `Terminal ${n}` };
        setTerminals([fresh]);
        setActiveTerminalId(fresh.id);
        setTerminalOpen(false);
        return;
      }

      setTerminals(next);
      if (id === activeTerminalId) {
        setActiveTerminalId(next[Math.min(index, next.length - 1)].id);
      }
    },
    [terminals, activeTerminalId]
  );

  /** Save pending edits, show the terminal, and type the command into the active shell. */
  const sendToTerminal = useCallback(
    async (command: string) => {
      // Always run against what is on screen: save pending edits first.
      if (!(await saveAll())) {
        notify("error", "Run cancelled: some files could not be saved.");
        return;
      }
      setTerminalOpen(true);
      terminalRefs.current[activeTerminalId]?.run(command);
    },
    [saveAll, notify, activeTerminalId]
  );

  const fileCommand = activePath ? runCommandFor(activePath) : null;

  /** Save everything, start the whole project, and show it in the Preview tab. */
  async function runProject() {
    if (preview.busy || preview.status === "starting") {
      onOpenPreview();
      return;
    }

    // Run what is on screen: save pending edits first.
    if (!(await saveAll())) {
      notify("error", "Run cancelled: some files could not be saved.");
      return;
    }

    onOpenPreview();
    if (preview.status === "running") preview.restart();
    else preview.start();
  }

  /* ------------------------------- Shortcuts ------------------------------- */

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // The editor stays mounted while hidden; ignore shortcuts then.
      if (!active) return;
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();

      if (key === "s") {
        event.preventDefault();
        if (event.shiftKey) saveAll();
        else saveActive();
      } else if (key === "p" && !event.shiftKey) {
        event.preventDefault();
        setQuickOpen(true);
      } else if (event.key === "`" || event.code === "Backquote") {
        event.preventDefault();
        if (event.shiftKey) createTerminal();
        else setTerminalOpen((open) => !open);
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, saveActive, saveAll, createTerminal]);

  // Warn before leaving the page with unsaved work.
  useEffect(() => {
    if (dirtyPaths.size === 0) return;

    function onBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirtyPaths]);

  const handleMount: OnMount = (editor) => {
    editor.onDidChangeCursorPosition((e) => {
      setCursor({ line: e.position.lineNumber, col: e.position.column });
    });
    editor.focus();
  };

  function updateContent(path: string, value: string) {
    setBuffers((b) => (b[path] ? { ...b, [path]: { ...b[path], content: value } } : b));
  }

  /* --------------------------------- Render -------------------------------- */

  const previewLive = preview.status === "running";
  const previewStarting = preview.status === "starting" || preview.busy;

  const filterMatches = filter.trim()
    ? flatFiles.filter((f) => fuzzyMatch(filter.trim(), f.path))
    : null;

  const ghostBtn =
    "flex items-center gap-1.5 rounded-lg border border-[#2f2552] bg-[#0f0b1d] px-2.5 py-1.5 text-xs font-medium text-[#cfcae6] transition hover:border-[#a78bfa]/70 hover:text-white disabled:opacity-40 disabled:hover:border-[#2f2552] disabled:hover:text-[#cfcae6]";

  const explorer = (
    <aside className="flex w-64 shrink-0 flex-col border-r border-[#231b3d] bg-[#0b0816]/80">
      <div className="flex items-center justify-between px-3 py-2.5">
        <div className="flex items-center gap-2">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-[#8b86a8]">Explorer</h2>
          <span className="rounded-full bg-[#1a1433] px-2 py-0.5 text-[11px] font-semibold text-[#cfcae6]">
            {flatFiles.length}
          </span>
        </div>
        <div className="flex items-center">
          <IconButton label="New file" onClick={() => setCreating((c) => !c)}>
            <Icon name="plus" className="h-4 w-4" />
          </IconButton>
          <IconButton label="Refresh" onClick={() => loadFiles(true)}>
            <Icon name="refresh" className="h-4 w-4" />
          </IconButton>
        </div>
      </div>

      <div className="px-3 pb-2">
        <div className="flex items-center gap-2 rounded-lg border border-[#231b3d] bg-[#07050f] px-2.5 py-1.5 focus-within:border-[#a78bfa]/60">
          <Icon name="search" className="h-3.5 w-3.5 text-[#5e5880]" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter files"
            aria-label="Filter files"
            className="w-full bg-transparent text-xs text-[#f5f2ff] outline-none placeholder:text-[#5e5880]"
          />
        </div>
      </div>

      {creating && (
        <div className="px-3 pb-2">
          <input
            autoFocus
            value={newPath}
            onChange={(e) => setNewPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) {
                e.preventDefault();
                createFile();
              } else if (e.key === "Escape") {
                setCreating(false);
                setNewPath("");
              }
            }}
            placeholder="frontend/src/new-file.ts"
            aria-label="New file path"
            className="w-full rounded-lg border border-[#a78bfa]/60 bg-[#07050f] px-2.5 py-1.5 font-mono text-xs text-[#f5f2ff] outline-none placeholder:text-[#5e5880]"
          />
          <p className="mt-1 text-[10px] text-[#5e5880]">Enter to create · Esc to cancel</p>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto pb-2">
        {treeLoading ? (
          <div className="space-y-2 px-3 pt-2" role="status" aria-label="Loading files">
            {[0, 1, 2, 3, 4].map((i) => (
              <div
                key={i}
                className="h-4 animate-pulse rounded-md bg-[#14102a]"
                style={{ width: `${90 - i * 10}%` }}
              />
            ))}
          </div>
        ) : treeError ? (
          <div
            role="alert"
            className="m-3 rounded-xl border border-[#f87171]/40 bg-[#2a0f16]/60 p-3 text-xs text-[#fecdd3]"
          >
            <p className="break-words">{treeError}</p>
            <button
              onClick={() => loadFiles()}
              className="mt-2 rounded-lg bg-gradient-to-r from-[#d946ef] to-[#8b5cf6] px-3 py-1 font-semibold text-white hover:brightness-110"
            >
              Try again
            </button>
          </div>
        ) : files.length === 0 ? (
          <p className="px-4 py-3 text-xs leading-relaxed text-[#8b86a8]">
            {workspaceExists
              ? "No files yet. Create one with the + button."
              : "No generated files yet. The workspace is created once generation runs."}
          </p>
        ) : filterMatches ? (
          filterMatches.length === 0 ? (
            <p className="px-4 py-3 text-xs text-[#8b86a8]">No files match &quot;{filter}&quot;.</p>
          ) : (
            filterMatches.map((file) => (
              <TreeItem
                key={file.path}
                item={file}
                depth={0}
                selectedPath={activePath}
                dirtyPaths={dirtyPaths}
                onSelect={openFile}
                onDelete={deleteEntry}
              />
            ))
          )
        ) : (
          files.map((item) => (
            <TreeItem
              key={item.path}
              item={item}
              depth={0}
              selectedPath={activePath}
              dirtyPaths={dirtyPaths}
              onSelect={openFile}
              onDelete={deleteEntry}
            />
          ))
        )}
      </div>
    </aside>
  );

  return (
    <div className="p-3 sm:p-4">
      <div className="relative flex h-[calc(100dvh-8rem)] min-h-[520px] flex-col overflow-hidden rounded-2xl border border-[#231b3d] bg-[#07050f] bg-[image:radial-gradient(ellipse_at_top_left,rgba(88,28,135,0.28),transparent_55%),radial-gradient(ellipse_at_bottom_right,rgba(112,26,117,0.18),transparent_50%)] shadow-[0_0_80px_-30px_rgba(168,85,247,.35)]">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#231b3d] bg-[#0b0816]/80 px-3 py-2 backdrop-blur">
          <div className="flex items-center gap-1.5">
            <IconButton label="Toggle explorer" onClick={() => setSidebarOpen((o) => !o)}>
              <Icon name="sidebar" className="h-4 w-4" />
            </IconButton>
            <span className="ml-1 rounded-full border border-[#2f2552] bg-[#0f0b1d] px-3 py-1 text-xs font-medium text-[#cfcae6]">
              Project #{projectId}
            </span>
            {previewLive && (
              <button
                type="button"
                onClick={onOpenPreview}
                className="hidden items-center gap-1.5 rounded-full border border-[#34d399]/40 bg-[#34d399]/10 px-3 py-1 text-xs font-semibold text-[#34d399] transition hover:bg-[#34d399]/20 sm:flex"
                title="Open preview"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-[#34d399]" />
                Live
              </button>
            )}
            {previewStarting && (
              <button
                type="button"
                onClick={onOpenPreview}
                className="hidden items-center gap-1.5 rounded-full border border-[#ffb35c]/40 bg-[#ffb35c]/10 px-3 py-1 text-xs font-semibold text-[#ffb35c] transition hover:bg-[#ffb35c]/20 sm:flex"
                title="Open preview"
              >
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#ffb35c]" />
                Starting...
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setQuickOpen(true)}
              className="hidden items-center gap-2 rounded-lg border border-[#231b3d] bg-[#07050f] px-3 py-1.5 text-xs text-[#8b86a8] transition hover:border-[#a78bfa]/50 hover:text-[#e4e0f5] md:flex"
            >
              <Icon name="search" className="h-3.5 w-3.5" />
              Go to file
              <kbd className="rounded-md border border-[#2f2552] px-1.5 font-mono text-[10px] text-[#a29dbf]">
                Ctrl P
              </kbd>
            </button>

            <button
              type="button"
              onClick={saveActive}
              disabled={!activeBuffer || anySaving}
              className={ghostBtn}
              title="Save (Ctrl+S)"
            >
              {anySaving ? <Spinner /> : <Icon name="save" className="h-3.5 w-3.5" />}
              Save
            </button>

            <button
              type="button"
              onClick={() => saveAll()}
              disabled={dirtyPaths.size === 0 || anySaving}
              className={`${ghostBtn} hidden sm:flex`}
              title="Save all (Ctrl+Shift+S)"
            >
              Save all
            </button>

            <button
              type="button"
              onClick={() => fileCommand && sendToTerminal(fileCommand)}
              disabled={!fileCommand}
              className={ghostBtn}
              title={fileCommand ? `Run in terminal: ${fileCommand}` : "Open a .js, .ts, .py or .sh file to run it"}
            >
              <Icon name="play" className="h-3 w-3" />
              Run file
            </button>

            <div className="mx-1 hidden h-5 w-px bg-[#231b3d] sm:block" />

            {previewLive && (
              <button
                type="button"
                onClick={() => preview.stop()}
                disabled={preview.busy}
                className="flex items-center gap-1.5 rounded-lg border border-[#f87171]/50 px-2.5 py-1.5 text-xs font-medium text-[#fca5a5] transition hover:bg-[#f87171]/10 disabled:opacity-50"
                title="Stop the running project"
              >
                <Icon name="stop" className="h-3 w-3" />
                Stop
              </button>
            )}

            <button
              type="button"
              onClick={runProject}
              disabled={previewStarting || anySaving}
              className="flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-[#d946ef] to-[#8b5cf6] px-3.5 py-1.5 text-xs font-semibold text-white shadow-[0_0_24px_-6px_rgba(217,70,239,.7)] transition hover:brightness-110 disabled:opacity-50 disabled:shadow-none"
              title="Save all, run the whole project and open the preview"
            >
              {previewStarting ? (
                <Spinner />
              ) : previewLive ? (
                <Icon name="refresh" className="h-3.5 w-3.5" />
              ) : (
                <Icon name="sparkle" className="h-3.5 w-3.5" />
              )}
              {previewStarting ? "Starting..." : previewLive ? "Restart" : "Run project"}
            </button>

            <IconButton label="Toggle terminal (Ctrl+`)" onClick={() => setTerminalOpen((o) => !o)}>
              <Icon name="terminal" className="h-4 w-4" />
            </IconButton>
          </div>
        </div>

        <div className="flex min-h-0 flex-1">
          {sidebarOpen && explorer}

          {/* Editor column */}
          <section className="flex min-w-0 flex-1 flex-col">
            {/* Tabs */}
            {openTabs.length > 0 && (
              <div
                className="flex shrink-0 gap-1 overflow-x-auto border-b border-[#231b3d] bg-[#0b0816]/80 px-2 pt-1.5"
                role="tablist"
              >
                {openTabs.map((path) => {
                  const buf = buffers[path];
                  const name = buf?.name ?? path.split("/").pop() ?? path;
                  const active = path === activePath;
                  const dirty = dirtyPaths.has(path);

                  return (
                    <div
                      key={path}
                      role="tab"
                      aria-selected={active}
                      onAuxClick={(e) => {
                        if (e.button === 1) {
                          e.preventDefault();
                          closeTab(path);
                        }
                      }}
                      className={`group flex shrink-0 items-center gap-2 rounded-t-lg px-3 py-2 text-xs ${
                        active
                          ? "bg-[#07050f] text-white shadow-[inset_0_2px_0_0_#c084fc]"
                          : "text-[#8b86a8] hover:bg-[#14102a] hover:text-[#e4e0f5]"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setActivePath(path)}
                        title={path}
                        className="flex items-center gap-2"
                      >
                        <FileBadge name={name} />
                        <span className="max-w-[10rem] truncate">{name}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => closeTab(path)}
                        aria-label={`Close ${name}`}
                        className="flex h-4 w-4 items-center justify-center rounded text-[#5e5880] hover:bg-white/10 hover:text-white"
                      >
                        {dirty ? (
                          <>
                            <span className="h-2 w-2 rounded-full bg-[#ffb35c] group-hover:hidden" />
                            <Icon name="close" className="hidden h-3 w-3 group-hover:block" />
                          </>
                        ) : (
                          <Icon name="close" className="h-3 w-3" />
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Breadcrumb */}
            {activePath && (
              <div className="shrink-0 truncate border-b border-[#231b3d]/70 bg-[#07050f] px-4 py-1.5 text-[11px] text-[#5e5880]">
                {activePath.split("/").join("  ›  ")}
              </div>
            )}

            {/* Editor area */}
            <div className="relative min-h-0 flex-1 bg-[#07050f]">
              {activePath && activeBuffer ? (
                <MonacoEditor
                  key="monaco"
                  height="100%"
                  path={activePath}
                  language={languageFor(activeBuffer.name)}
                  value={activeBuffer.content}
                  theme="prompt2web"
                  beforeMount={handleBeforeMount}
                  onMount={handleMount}
                  onChange={(value) => updateContent(activePath, value ?? "")}
                  options={{
                    fontSize,
                    minimap: { enabled: minimap },
                    wordWrap: wordWrap ? "on" : "off",
                    automaticLayout: true,
                    scrollBeyondLastLine: false,
                    smoothScrolling: true,
                    tabSize: 2,
                    padding: { top: 12 },
                    renderWhitespace: "selection",
                    bracketPairColorization: { enabled: true },
                    fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                  }}
                />
              ) : activePath && loadingPaths[activePath] ? (
                <div className="flex h-full items-center justify-center gap-2 text-sm text-[#8b86a8]" role="status">
                  <Spinner className="h-4 w-4" /> Opening file...
                </div>
              ) : (
                <div className="flex h-full items-center justify-center px-6">
                  <div className="max-w-md text-center">
                    <span className="inline-flex items-center gap-2 rounded-full border border-[#2f2552] bg-[#0f0b1d] px-3.5 py-1.5 text-xs font-medium text-[#e4e0f5]">
                      <Icon name="sparkle" className="h-3.5 w-3.5 text-[#c084fc]" />
                      Code editor
                    </span>

                    <h3 className="mt-5 text-4xl font-extrabold leading-tight tracking-tight text-white">
                      Pick a file
                      <br />
                      <span className="bg-gradient-to-r from-[#e0b0d0] via-[#f0b0a0] to-[#ffb35c] bg-clip-text text-transparent">
                        to start editing.
                      </span>
                    </h3>
                    <p className="mt-3 text-sm text-[#8b86a8]">
                      Choose one from the explorer, or jump straight to it.
                    </p>

                    <dl className="mx-auto mt-7 grid max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-2.5 rounded-2xl border border-[#231b3d] bg-[#0f0b1d]/70 p-4 text-left text-xs">
                      {[
                        ["Go to file", "Ctrl P"],
                        ["Save", "Ctrl S"],
                        ["Save all", "Ctrl Shift S"],
                        ["Toggle terminal", "Ctrl `"],
                        ["New terminal", "Ctrl Shift `"],
                      ].map(([label, keys]) => (
                        <div key={label} className="contents">
                          <dt className="text-[#a29dbf]">{label}</dt>
                          <dd>
                            <kbd className="rounded-md border border-[#2f2552] bg-[#07050f] px-1.5 py-0.5 font-mono text-[10px] text-[#c4b5fd]">
                              {keys}
                            </kbd>
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                </div>
              )}

              {toast && (
                <div
                  role={toast.kind === "error" ? "alert" : "status"}
                  className={`absolute bottom-3 right-3 z-20 flex max-w-sm items-start gap-2 rounded-xl border px-3 py-2.5 text-xs shadow-xl backdrop-blur ${
                    toast.kind === "error"
                      ? "border-[#f87171]/50 bg-[#2a0f16]/95 text-[#fecdd3]"
                      : toast.kind === "success"
                      ? "border-[#34d399]/40 bg-[#0a2a20]/95 text-[#bbf7d0]"
                      : "border-[#2f2552] bg-[#0f0b1d]/95 text-[#e4e0f5]"
                  }`}
                >
                  <Icon name={toast.kind === "success" ? "check" : "alert"} className="mt-px h-4 w-4 shrink-0" />
                  <span className="min-w-0 break-words">{toast.text}</span>
                  <button
                    type="button"
                    onClick={() => setToast(null)}
                    className="shrink-0 opacity-70 hover:opacity-100"
                    aria-label="Dismiss"
                  >
                    <Icon name="close" className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>

            {/* Terminals: every shell stays mounted while hidden so it keeps running, like VS Code. */}
            <div className={terminalOpen ? "block" : "hidden"}>
              {/* Terminal tab strip */}
              <div
                className="flex shrink-0 items-center gap-1 overflow-x-auto border-t border-[#231b3d] bg-[#0b0816]/80 px-2 pt-1.5"
                role="tablist"
              >
                {terminals.map((t) => {
                  const isActive = t.id === activeTerminalId;
                  return (
                    <div
                      key={t.id}
                      role="tab"
                      aria-selected={isActive}
                      onAuxClick={(e) => {
                        if (e.button === 1) {
                          e.preventDefault();
                          closeTerminal(t.id);
                        }
                      }}
                      className={`group flex shrink-0 items-center gap-2 rounded-t-lg px-3 py-1.5 text-xs ${
                        isActive
                          ? "bg-[#07050f] text-white shadow-[inset_0_2px_0_0_#c084fc]"
                          : "text-[#8b86a8] hover:bg-[#14102a] hover:text-[#e4e0f5]"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setActiveTerminalId(t.id)}
                        className="flex items-center gap-1.5"
                      >
                        <Icon name="terminal" className="h-3.5 w-3.5" />
                        {t.title}
                      </button>
                      <button
                        type="button"
                        onClick={() => closeTerminal(t.id)}
                        aria-label={`Close ${t.title}`}
                        className="flex h-4 w-4 items-center justify-center rounded text-[#5e5880] hover:bg-white/10 hover:text-white"
                      >
                        <Icon name="close" className="h-3 w-3" />
                      </button>
                    </div>
                  );
                })}
                <IconButton
                  label="New terminal (Ctrl+Shift+`)"
                  onClick={createTerminal}
                  disabled={terminals.length >= MAX_TERMINALS}
                >
                  <Icon name="plus" className="h-4 w-4" />
                </IconButton>
              </div>

              {terminals.map((t) => (
                <div key={`${projectId}:${t.id}`} className={t.id === activeTerminalId ? "block" : "hidden"}>
                  <TerminalPanel
                    ref={(handle) => {
                      terminalRefs.current[t.id] = handle;
                    }}
                    projectId={projectId}
                    open={terminalOpen && t.id === activeTerminalId}
                    presets={RUN_PRESETS}
                    onClose={() => setTerminalOpen(false)}
                  />
                </div>
              ))}
            </div>
          </section>
        </div>

        {/* Status bar */}
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-t border-[#231b3d] bg-[#0b0816]/80 px-3 py-1.5 text-[11px] text-[#a29dbf]">
          <div className="flex items-center gap-3">
            <span
              className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-medium ${
                anySaving
                  ? "border-[#a78bfa]/40 bg-[#a78bfa]/10 text-[#c4b5fd]"
                  : dirtyPaths.size > 0
                  ? "border-[#ffb35c]/40 bg-[#ffb35c]/10 text-[#ffb35c]"
                  : "border-[#34d399]/40 bg-[#34d399]/10 text-[#34d399]"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  anySaving ? "animate-pulse bg-[#c4b5fd]" : dirtyPaths.size > 0 ? "bg-[#ffb35c]" : "bg-[#34d399]"
                }`}
              />
              {anySaving
                ? "Saving..."
                : dirtyPaths.size > 0
                ? `${dirtyPaths.size} unsaved file${dirtyPaths.size > 1 ? "s" : ""}`
                : "All changes saved"}
            </span>
          </div>

          <div className="flex items-center gap-3">
            {activeBuffer && (
              <>
                <span className="font-mono">
                  Ln {cursor.line}, Col {cursor.col}
                </span>
                <span className="capitalize">{languageFor(activeBuffer.name)}</span>
              </>
            )}
            <button
              type="button"
              onClick={() => setWordWrap((w) => !w)}
              className={`rounded-md px-2 py-0.5 transition hover:text-white ${
                wordWrap ? "bg-[#a78bfa]/20 text-[#c4b5fd]" : ""
              }`}
              aria-pressed={wordWrap}
            >
              Wrap
            </button>
            <button
              type="button"
              onClick={() => setMinimap((m) => !m)}
              className={`rounded-md px-2 py-0.5 transition hover:text-white ${
                minimap ? "bg-[#a78bfa]/20 text-[#c4b5fd]" : ""
              }`}
              aria-pressed={minimap}
            >
              Minimap
            </button>
            <span className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setFontSize((s) => Math.max(10, s - 1))}
                className="rounded-md px-1.5 py-0.5 hover:bg-white/10 hover:text-white"
                aria-label="Decrease font size"
              >
                A−
              </button>
              <span>{fontSize}px</span>
              <button
                type="button"
                onClick={() => setFontSize((s) => Math.min(24, s + 1))}
                className="rounded-md px-1.5 py-0.5 hover:bg-white/10 hover:text-white"
                aria-label="Increase font size"
              >
                A+
              </button>
            </span>
          </div>
        </div>

        {quickOpen && (
          <QuickOpen files={flatFiles} onPick={openFile} onClose={() => setQuickOpen(false)} />
        )}
      </div>
    </div>
  );
}