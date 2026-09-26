// Regenerates public/mascot/<pose>.webp from the source PNGs in assets/mascot.
// Run from apps/web after adding or changing a pose: node scripts/optimize-mascots.mjs
import { readdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import sharp from "sharp"

const here = dirname(fileURLToPath(import.meta.url))
const source = join(here, "../../../assets/mascot")
const target = join(here, "../public/mascot")

for (const file of readdirSync(source).filter((f) => f.endsWith(".png"))) {
  const pose = file.replace(/\.png$/, "")
  const info = await sharp(join(source, file))
    .webp({ quality: 88, alphaQuality: 95, effort: 6 })
    .toFile(join(target, `${pose}.webp`))
  console.log(`${pose}: ${info.width}x${info.height}, ${Math.round(info.size / 1024)} KB`)
}
