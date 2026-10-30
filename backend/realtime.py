"""
Real-time updates for Prompt2Web (Django + python-socketio).

Put this file next to manage.py (any importable place works).

SETUP
-----
1. Install:

       pip install python-socketio uvicorn

2. Open the asgi.py inside your Django project folder (the one with settings.py)
   and change it to this. Keep your own settings module name:

       import os
       from django.core.asgi import get_asgi_application
       import socketio

       os.environ.setdefault("DJANGO_SETTINGS_MODULE", "YOUR_PROJECT.settings")
       django_app = get_asgi_application()

       from realtime import sio
       application = socketio.ASGIApp(sio, django_app)

3. Start the backend with uvicorn instead of "manage.py runserver":

       uvicorn YOUR_PROJECT.asgi:application --reload --port 8000

   The API stays on http://127.0.0.1:8000/api and the sockets are served from
   the same address, so the frontend needs no extra setting.

4. Allowed frontends. By default http://localhost:3000 and http://127.0.0.1:3000.
   To change that, set FRONTEND_ORIGINS="http://localhost:3000,https://my.site".

SENDING EVENTS
--------------
Call these from the code that plans and generates a project, and from the chat
code. They work from normal (synchronous) Django views and from background
threads, never raise, and do nothing when nobody is connected:

    import realtime

    realtime.status(project.id, "generating")
    realtime.activity(project.id, "Writing index.html", "generating")
    realtime.task(project.id, task.id, task.title, "running", completed=2, total=6)
    realtime.file(project.id, "index.html", "created")

    realtime.chat_status(project.id, True)       # the reply is being written
    realtime.chat_message(project.id, {          # a message was saved
        "id": msg.id, "role": msg.role, "content": msg.content, "timestamp": msg.timestamp,
    })
    realtime.chat_status(project.id, False)      # done (also send this if it fails)
"""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import date, datetime, timezone
from typing import Any, Iterable, Optional

import socketio

logger = logging.getLogger(__name__)

_origins = [
    origin.strip()
    for origin in os.environ.get(
        "FRONTEND_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000"
    ).split(",")
    if origin.strip()
]

sio = socketio.AsyncServer(async_mode="asgi", cors_allowed_origins=_origins)

ALL_ROOM = "projects"  # the home page follows every project

# The server's event loop. Set when the first browser connects; until then there
# is nobody to send to, so events are simply skipped.
_loop: Optional[asyncio.AbstractEventLoop] = None

# Sends go out one at a time, in the order they were queued, so a browser never
# sees "ready" before the last task update.
_lock: Optional[asyncio.Lock] = None


def _project_room(project_id: int) -> str:
    return f"project:{project_id}"


def _as_project_id(value: Any) -> Optional[int]:
    if isinstance(value, bool):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


# ----------------------------------------------------------------------------
# Browser side: which events a connection wants
# ----------------------------------------------------------------------------


@sio.event
async def connect(sid, environ, auth=None):
    global _loop, _lock
    loop = asyncio.get_running_loop()
    if loop is not _loop:
        _loop = loop
        _lock = asyncio.Lock()


@sio.on("subscribe:all")
async def _subscribe_all(sid):
    await sio.enter_room(sid, ALL_ROOM)


@sio.on("unsubscribe:all")
async def _unsubscribe_all(sid):
    await sio.leave_room(sid, ALL_ROOM)


@sio.on("subscribe:project")
async def _subscribe_project(sid, project_id=None):
    pid = _as_project_id(project_id)
    if pid is not None:
        await sio.enter_room(sid, _project_room(pid))


@sio.on("unsubscribe:project")
async def _unsubscribe_project(sid, project_id=None):
    pid = _as_project_id(project_id)
    if pid is not None:
        await sio.leave_room(sid, _project_room(pid))


# ----------------------------------------------------------------------------
# Server side: sending
# ----------------------------------------------------------------------------


def _clean(value: Any) -> Any:
    """Make a payload JSON-safe (Django gives us datetime objects)."""
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(key): _clean(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [_clean(item) for item in value]
    return value


def _participants(room: str) -> list[str]:
    try:
        return [
            participant[0] if isinstance(participant, tuple) else participant
            for participant in list(sio.manager.get_participants("/", room))
        ]
    except KeyError:
        return []  # nobody has joined this room yet


async def _send(event: str, payload: dict, rooms: Iterable[str]) -> None:
    lock = _lock
    if lock is None:
        return

    async with lock:
        # A connection that is in several of the rooms still receives the event once.
        seen: set[str] = set()
        for room in rooms:
            for sid in _participants(room):
                if sid in seen:
                    continue
                seen.add(sid)
                await sio.emit(event, payload, to=sid)


def _log_failure(future) -> None:
    if future.cancelled():
        return
    error = future.exception()
    if error is not None:
        logger.warning("realtime: could not send an event: %r", error)


def _dispatch(project_id: Any, event: str, data: dict, *, home: bool = True) -> None:
    """Thread-safe: callable from sync views, background threads and async code."""
    try:
        pid = _as_project_id(project_id)
        loop = _loop
        if pid is None or loop is None or loop.is_closed():
            return

        rooms = [_project_room(pid)]
        if home:
            rooms.insert(0, ALL_ROOM)

        payload = _clean({"projectId": pid, **data})
        future = asyncio.run_coroutine_threadsafe(_send(event, payload, rooms), loop)
        future.add_done_callback(_log_failure)
    except Exception:  # never break the request that is generating the project
        logger.exception("realtime: could not queue an event")


def status(project_id: Any, status: str) -> None:
    """The project's overall status changed (planning, generating, ready, failed ...)."""
    _dispatch(project_id, "project:status", {"status": status})


def task(
    project_id: Any,
    task_id: Any,
    title: Optional[str],
    status: str,
    completed: Optional[int] = None,
    total: Optional[int] = None,
) -> None:
    """A plan task started or finished. completed/total feed the progress bar."""
    data: dict = {"taskId": task_id, "title": title, "status": status}
    if completed is not None:
        data["completed"] = completed
    if total is not None:
        data["total"] = total
    _dispatch(project_id, "task:update", data)


def activity(project_id: Any, message: str, stage: Optional[str] = None) -> None:
    """A line for the live activity feed, for example "Writing styles.css"."""
    _dispatch(
        project_id,
        "generation:activity",
        {"message": message, "stage": stage, "at": datetime.now(timezone.utc)},
    )


def file(project_id: Any, path: str, action: str = "updated") -> None:
    """A generated file was created, updated or deleted. Project page only."""
    _dispatch(project_id, "file:changed", {"path": path, "action": action}, home=False)


def chat_message(project_id: Any, message: dict) -> None:
    """A chat message was saved (the user's message or the assistant's reply)."""
    _dispatch(project_id, "chat:message", {"message": message}, home=False)


def chat_status(project_id: Any, generating: bool) -> None:
    """The assistant started (True) or finished (False) writing a reply."""
    _dispatch(project_id, "chat:status", {"generating": bool(generating)}, home=False)