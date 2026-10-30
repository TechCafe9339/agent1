/**
 * Real-time server for Prompt2Web (Express + Socket.IO).
 * Put this file in your BACKEND folder (not in the frontend).
 *
 * Install:  npm i socket.io
 *
 * 1) Start Socket.IO on the same HTTP server as Express. Use server.listen,
 *    not app.listen, because app.listen creates a server you cannot reach:
 *
 *      const http = require("http");
 *      const { initSocket } = require("./socket");
 *
 *      const server = http.createServer(app);
 *      initSocket(server, { origin: process.env.FRONTEND_ORIGIN || "http://localhost:3000" });
 *      server.listen(PORT);
 *
 * 2) Call these from the code that plans and generates a project:
 *
 *      const { realtime } = require("./socket");
 *
 *      realtime.status(project.id, "generating");
 *      realtime.activity(project.id, "Planning the page layout", "planning");
 *      realtime.task(project.id, { id: task.id, title: task.title, status: "running" },
 *                    { completed: 2, total: 6 });
 *      realtime.file(project.id, "index.html", "created");
 *
 * 3) And from the chat code, right after a message is saved:
 *
 *      realtime.chatStatus(project.id, true);              // the reply is being written
 *      realtime.chatMessage(project.id, savedMessage);     // { id, role, content, timestamp }
 *      realtime.chatStatus(project.id, false);             // done (also send this if it fails)
 *
 * Every call is safe before initSocket() has run: it simply does nothing.
 */

const { Server } = require("socket.io");

/** @type {import("socket.io").Server | null} */
let io = null;

/**
 * @param {import("http").Server} httpServer
 * @param {{ origin?: string }} [options]
 */
function initSocket(httpServer, options = {}) {
  const server = new Server(httpServer, {
    cors: { origin: options.origin || "http://localhost:3000", methods: ["GET", "POST"] },
  });
  io = server;

  server.on("connection", (socket) => {
    // The home page follows every project.
    socket.on("subscribe:all", () => socket.join("projects"));
    socket.on("unsubscribe:all", () => socket.leave("projects"));

    // A project page follows only its own project.
    socket.on("subscribe:project", (/** @type {unknown} */ id) => {
      const projectId = Number(id);
      if (Number.isInteger(projectId)) socket.join(`project:${projectId}`);
    });
    socket.on("unsubscribe:project", (/** @type {unknown} */ id) => {
      const projectId = Number(id);
      if (Number.isInteger(projectId)) socket.leave(`project:${projectId}`);
    });
  });

  return server;
}

/**
 * A client that is in both rooms still receives each event once.
 * `alsoHome` sends the event to the home page too.
 *
 * @param {number | string} projectId
 * @param {string} event
 * @param {Record<string, unknown>} payload
 * @param {{ alsoHome?: boolean }} [options]
 */
function send(projectId, event, payload, options = {}) {
  if (!io) return;
  const alsoHome = options.alsoHome !== false;
  const id = Number(projectId);
  const target = alsoHome ? io.to("projects").to(`project:${id}`) : io.to(`project:${id}`);
  target.emit(event, { projectId: id, ...payload });
}

const realtime = {
  /**
   * The project's overall status changed (planning, generating, ready, failed ...).
   * @param {number | string} projectId
   * @param {string} status
   */
  status(projectId, status) {
    send(projectId, "project:status", { status });
  },

  /**
   * A plan task started or finished.
   * @param {number | string} projectId
   * @param {{ id: number | string, title?: string, status: string }} task
   * @param {{ completed?: number, total?: number }} [progress]
   */
  task(projectId, task, progress = {}) {
    send(projectId, "task:update", {
      taskId: task.id,
      title: task.title,
      status: task.status,
      completed: progress.completed,
      total: progress.total,
    });
  },

  /**
   * A line for the live activity feed, for example "Writing styles.css".
   * @param {number | string} projectId
   * @param {string} message
   * @param {string} [stage]
   */
  activity(projectId, message, stage) {
    send(projectId, "generation:activity", { message, stage, at: new Date().toISOString() });
  },

  /**
   * A generated file was created, changed or removed. Project page only.
   * @param {number | string} projectId
   * @param {string} path
   * @param {"created" | "updated" | "deleted"} [action]
   */
  file(projectId, path, action = "updated") {
    send(projectId, "file:changed", { path, action }, { alsoHome: false });
  },

  /**
   * A chat message was saved (the user's message or the assistant's reply). Project page only.
   * @param {number | string} projectId
   * @param {{ id: number, role: "user" | "assistant", content: string, timestamp: string }} message
   */
  chatMessage(projectId, message) {
    send(projectId, "chat:message", { message }, { alsoHome: false });
  },

  /**
   * The assistant started (true) or finished (false) writing a reply. Project page only.
   * @param {number | string} projectId
   * @param {boolean} generating
   */
  chatStatus(projectId, generating) {
    send(projectId, "chat:status", { generating }, { alsoHome: false });
  },
};

module.exports = { initSocket, realtime };