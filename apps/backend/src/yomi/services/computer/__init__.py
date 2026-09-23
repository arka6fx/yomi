"""Personal computer access via the sandbox gateway worker.

Workspaces are per-user isolated Linux desktops (``workspace`` is the Yomi
user id). The gateway owns sandbox lifecycle; this client only speaks the
computer protocol. Writes are never retried implicitly.
"""
