import { cp, mkdir, readdir, rm } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const scriptsDir = dirname(fileURLToPath(import.meta.url))
const root = join(scriptsDir, "..")
const nextAppDir = join(root, ".next", "server", "app")
const staticDir = join(root, ".next", "static")
const publicDir = join(root, "public")
const assetsDir = join(root, ".worker-assets")

async function copySelectedFiles(sourceDir, destDir, predicate) {
  await mkdir(destDir, { recursive: true })
  const entries = await readdir(sourceDir, { withFileTypes: true })

  for (const entry of entries) {
    const sourcePath = join(sourceDir, entry.name)
    const destPath = join(destDir, entry.name)

    if (entry.isDirectory()) {
      await copySelectedFiles(sourcePath, destPath, predicate)
      continue
    }

    if (predicate(sourcePath)) {
      await mkdir(dirname(destPath), { recursive: true })
      await cp(sourcePath, destPath)
    }
  }
}

async function main() {
  await rm(assetsDir, { recursive: true, force: true })
  await mkdir(assetsDir, { recursive: true })

  await copySelectedFiles(nextAppDir, assetsDir, (sourcePath) => {
    return sourcePath.endsWith(".html") || sourcePath.endsWith(".rsc") || sourcePath.endsWith(".meta")
  })

  await cp(staticDir, join(assetsDir, "_next", "static"), { recursive: true })
  await cp(publicDir, assetsDir, { recursive: true })
  await cp(join(root, ".next", "BUILD_ID"), join(assetsDir, "BUILD_ID"))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
