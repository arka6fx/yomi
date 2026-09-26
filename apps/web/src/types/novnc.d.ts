// Minimal types for the parts of noVNC's RFB client the computer view uses.
declare module "@novnc/novnc" {
  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, url: string, options?: Record<string, unknown>)
    scaleViewport: boolean
    resizeSession: boolean
    viewOnly: boolean
    focusOnClick: boolean
    background: string
    disconnect(): void
    focus(): void
    sendCtrlAltDel(): void
    clipboardPasteFrom(text: string): void
  }
}
