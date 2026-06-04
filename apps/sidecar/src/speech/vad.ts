// VAD moved to @yomi/shared so the desktop renderer can reuse it for live
// mic end-of-speech detection. Re-exported here to keep existing imports stable.
export { EnergyVad, detectSpeechEnd } from "@yomi/shared"
export type { VadResult, VadOptions } from "@yomi/shared"
