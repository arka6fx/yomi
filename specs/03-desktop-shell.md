# Spec 03 - Desktop Shell

The desktop shell is a thin Electron app.

Responsibilities:

- Show the tray/notch UI and chat surface.
- Handle global hotkeys for voice, text, and screen analysis.
- Capture microphone audio only after explicit user action.
- Capture screenshots only for local desktop turns initiated by the user.
- Launch and supervise the local sidecar binary.
- Forward authenticated requests to the sidecar.

The desktop does not execute remote Telegram requests. Telegram is handled by the backend agent.
