import { tmpdir } from "node:os"
import { join } from "node:path"

// bunfig.toml's [test.env] does not actually reach process.env on bun 1.3.14 (verified),
// so this preload sets YOMI_STATE_DIR before any test file runs, keeping conversation
// persistence tests off the real ~/.yomi/state directory.
process.env.YOMI_STATE_DIR ??= join(tmpdir(), "yomi-test-state")
