// ── Messaging gateway — will provide later ──────────────────────────────────
// import type { GatewayMessage, SseEvent } from "@yomi/shared"
// import { classifyIntent } from "../router/intent.js"
// import { fastPipeline } from "../pipeline/fast.js"
// import { agentPipeline } from "../pipeline/agent.js"
// 
// const BACKEND_URL = process.env.YOMI_BACKEND_URL ?? process.env.BACKEND_URL ?? "http://localhost:3001"
// 
// let polling = false
// let pollTimer: ReturnType<typeof setInterval> | null = null
// 
// export function startGatewayPoll(): void {
//   if (!process.env.YOMI_SESSION_TOKEN) {
//     console.warn("[gateway/poll] no YOMI_SESSION_TOKEN — skipping poll")
//     return
//   }
//   if (polling) return
//   polling = true
//   console.warn("[gateway/poll] started")
//   poll()
//   pollTimer = setInterval(poll, 2_000)
// }
// 
// export function stopGatewayPoll(): void {
//   polling = false
//   if (pollTimer) { clearInterval(pollTimer); pollTimer = null }
//   console.warn("[gateway/poll] stopped")
// }
// 
// async function poll(): Promise<void> {
//   // ... polling logic
// }
// 
// export async function handleGatewayMessage(msg: GatewayMessage): Promise<void> {
//   // ... message handling
// }

export function startGatewayPoll(): void {}
export function stopGatewayPoll(): void {}
export function handleGatewayMessage(): void {}
