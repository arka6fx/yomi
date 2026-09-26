// Regenerates the logo, favicons and app icons from the waving mascot in assets/mascot.
// Run from apps/web after changing the mascot: node scripts/brand-icons.mjs
import { writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import sharp from "sharp"

const here = dirname(fileURLToPath(import.meta.url))
const source = join(here, "../../../assets/mascot/waving.png")
const pub = join(here, "../public")
const SKY = { r: 0x3f, g: 0xb0, b: 0xf0, alpha: 1 }
const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 }

// the mascot fitted into a square, `fill` of the side, on `background`
async function icon(size, fill, background) {
  const inner = Math.round(size * fill)
  const mascot = await sharp(source)
    .trim()
    .resize(inner, inner, { fit: "contain", background: CLEAR })
    .toBuffer()
  return sharp({ create: { width: size, height: size, channels: 4, background } })
    .composite([{ input: mascot, gravity: "center" }])
    .png()
    .toBuffer()
}

// transparent: the nav logo and browser-tab favicons
writeFileSync(join(pub, "brand-mark-128.png"), await icon(128, 1, CLEAR))
const favicons = {}
for (const size of [16, 32, 48]) favicons[size] = await icon(size, 1, CLEAR)
writeFileSync(join(pub, "favicon-16x16.png"), favicons[16])
writeFileSync(join(pub, "favicon-32x32.png"), favicons[32])

// opaque with safe-zone padding: home-screen and maskable app icons
writeFileSync(join(pub, "apple-touch-icon.png"), await icon(180, 0.74, SKY))
writeFileSync(join(pub, "android-chrome-192x192.png"), await icon(192, 0.66, SKY))
writeFileSync(join(pub, "android-chrome-512x512.png"), await icon(512, 0.66, SKY))

// favicon.ico holding PNG-encoded 16, 32 and 48 px images
const images = [16, 32, 48].map((size) => ({ size, data: favicons[size] }))
const header = Buffer.alloc(6 + 16 * images.length)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(images.length, 4)
let offset = header.length
images.forEach(({ size, data }, i) => {
  const at = 6 + 16 * i
  header.writeUInt8(size, at)
  header.writeUInt8(size, at + 1)
  header.writeUInt16LE(1, at + 4)
  header.writeUInt16LE(32, at + 6)
  header.writeUInt32LE(data.length, at + 8)
  header.writeUInt32LE(offset, at + 12)
  offset += data.length
})
writeFileSync(join(pub, "favicon.ico"), Buffer.concat([header, ...images.map((i) => i.data)]))
console.log("brand icons written")
