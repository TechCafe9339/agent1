class WorkspaceError(Exception):
    """Base workspace exception."""


class WorkspaceAlreadyExistsError(WorkspaceError):
    """Workspace already exists."""


class WorkspaceNotFoundError(WorkspaceError):
    """Workspace does not exist."""


class InvalidWorkspacePathError(WorkspaceError):
    """Attempted access outside the workspace."""


class CommandTimeoutError(Exception):
    """Command execution exceeded the timeout."""


class InvalidCommandError(Exception):
    """Command is not permitted."""

class SandboxUnavailableError(Exception):
    """Docker sandbox is unavailable."""