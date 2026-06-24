export { scanForThreats, firstThreatMessage, type ThreatScope } from "./threat-patterns.js"

export { isBlockedUrl, isBinaryExtension } from "./path-security.js"

export {
  ToolCallGuardrailController,
  DEFAULT_GUARDRAIL_CONFIG,
  classifyToolFailure,
  canonicalToolArgs,
  signatureFor,
  syntheticBlockedResult,
  appendGuidance,
  decisionToMetadata,
  type ToolCallGuardrailConfig,
  type ToolGuardrailDecision,
  type ToolCallSignature,
  type GuardrailAction,
} from "./controller.js"
