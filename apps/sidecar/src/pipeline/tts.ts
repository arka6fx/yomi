// Thin wrapper so the fast pipeline can be tested with a process-local mock
// without polluting the speech/ module graph for sibling tests. ESM re-exports
// share bindings with their source, so mock.module() on a re-export bleeds
// into the original module — we wrap in fresh functions to isolate.
import {
  synthesize as resolverSynthesize,
  resolveTts as resolverResolveTts,
  type TtsEngine,
} from "../speech/resolver.js"

export function resolveTts(): TtsEngine {
  return resolverResolveTts()
}

export async function* synthesize(text: string): AsyncGenerator<Uint8Array> {
  yield* resolverSynthesize(text)
}
