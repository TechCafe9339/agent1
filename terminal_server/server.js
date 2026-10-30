/**
 * Terminal server: one real shell (pty) per browser terminal, over a WebSocket.
 * The browser can open several terminals per project; each one is its own
 * WebSocket connection and therefore its own shell.
 *
 *   npm install ws node-pty
 *   WORKSPACES_ROOT=/path/to/generated/projects node server.js
 *
 * WARNING: this gives whoever connects a full shell as the user running this
 * process. Run it on your own machine (it binds to 127.0.0.1), or put it in a
 * per-project container and add real authentication before exposing it.
 */
const http = require("http");
const path = require("path");
const fs = require("fs");
const { WebSocketServer } = require("ws");
const pty = require("node-pty");

const PORT = Number(process.env.TERMINAL_PORT || 4001);
const HOST = process.env.TERMINAL_HOST || "127.0.0.1";
const TOKEN = process.env.TERMINAL_TOKEN || "";
const ORIGINS = (process.env.TERMINAL_ORIGINS || "http://localhost:3000,http://127.0.0.1:3000").split(",").map((s) => s.trim());

// Upper bound on simultaneous shells per project (the UI allows 6 by default).
const MAX_PER_PROJECT = Number(process.env.TERMINAL_MAX_PER_PROJECT || 8);
const live = new Map(); // projectId -> number of open shells

if (!process.env.WORKSPACES_ROOT) {
  console.error("Set WORKSPACES_ROOT to the folder that holds your generated projects.");
  process.exit(1);
}
const ROOT = path.resolve(process.env.WORKSPACES_ROOT);

/**
 * Map a project id to its workspace folder. ADJUST THIS to match how your
 * backend lays projects out on disk (here: <ROOT>/project_<id>).
 */
function workspaceFor(id) {
  if (!/^\d+$/.test(id || "")) return null;
  const dir = path.resolve(ROOT, `project_${id}`);
  if (!dir.startsWith(ROOT + path.sep)) return null;
  return fs.existsSync(dir) ? dir : null;
}

const server = http.createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("terminal server");
});

const wss = new WebSocketServer({ noServer: true });

function reject(socket, code, text, extra = "") {
  console.log(`Rejected: ${code} ${text} ${extra}`);
  socket.write(`HTTP/1.1 ${code} ${text}\r\n\r\n`);
  socket.destroy();
}

server.on("upgrade", (req, socket, head) => {
  const url = new URL(req.url, "http://localhost");
  const origin = req.headers.origin || "";

  if (!ORIGINS.includes(origin)) return reject(socket, 403, "Forbidden", `origin="${origin}" allowed=${ORIGINS.join(",")}`);
  if (TOKEN && url.searchParams.get("token") !== TOKEN) return reject(socket, 401, "Unauthorized");

  const projectId = url.searchParams.get("project");
  const cwd = workspaceFor(projectId);
  if (!cwd) return reject(socket, 404, "Not Found", `project="${projectId}" looked in ${ROOT}`);

  if ((live.get(projectId) || 0) >= MAX_PER_PROJECT) {
    return reject(socket, 429, "Too Many Requests", `project="${projectId}" limit=${MAX_PER_PROJECT}`);
  }

  wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, cwd, projectId));
});

wss.on("connection", (ws, cwd, projectId) => {
  live.set(projectId, (live.get(projectId) || 0) + 1);

  const shell = process.platform === "win32" ? "powershell.exe" : process.env.SHELL || "bash";
  const env = { ...process.env, TERM: "xterm-256color", COLORTERM: "truecolor" };
  delete env.TERMINAL_TOKEN; // don't hand the token to user commands

  const term = pty.spawn(shell, [], { name: "xterm-256color", cols: 80, rows: 24, cwd, env });

  term.onData((data) => {
    if (ws.readyState === ws.OPEN) ws.send(data);
  });
  term.onExit(() => ws.close());

  ws.on("message", (raw) => {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (message.type === "input" && typeof message.data === "string" && message.data.length < 100000) {
      term.write(message.data);
    } else if (message.type === "resize") {
      const cols = Math.max(2, Math.min(500, message.cols | 0));
      const rows = Math.max(2, Math.min(200, message.rows | 0));
      try {
        term.resize(cols, rows);
      } catch {
        /* shell already exited */
      }
    }
  });

  ws.on("close", () => {
    live.set(projectId, Math.max(0, (live.get(projectId) || 1) - 1));
    try {
      term.kill();
    } catch {
      /* already gone */
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Terminal server on ws://${HOST}:${PORT} (workspaces: ${ROOT})`);
});