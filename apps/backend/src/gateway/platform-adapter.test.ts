import { describe, expect, it } from "bun:test"
import { removeMarkdown } from "./platform-adapter.js"

describe("removeMarkdown", () => {
  // Drive file IDs and generated filenames routinely contain underscores. Treating
  // every underscore as an emphasis marker deleted them, which silently corrupted
  // links (a dead "unable to open the file" page) and renamed files in the chat.
  it("leaves a url with underscores intact", () => {
    const url = "https://drive.google.com/file/d/1jyc_HIIY_KGcPycb_Hiukju/view?usp=drivesdk"
    expect(removeMarkdown(`Your PDF: ${url}`)).toContain(url)
  })

  it("keeps underscores inside a filename", () => {
    expect(removeMarkdown("Created Arka_Garai_29_PS2.pdf")).toContain("Arka_Garai_29_PS2.pdf")
    expect(removeMarkdown("Physics 101_Arka Garai_RenewableEnergy")).toContain(
      "Physics 101_Arka Garai_RenewableEnergy",
    )
  })

  it("still strips real emphasis", () => {
    expect(removeMarkdown("this is _important_ text")).toBe("this is important text")
    expect(removeMarkdown("this is **bold** text")).toBe("this is bold text")
  })

  it("keeps the contents of inline code rather than deleting them", () => {
    // The old rule replaced `code` with "", so anything backticked vanished.
    expect(removeMarkdown("run `bun test` now")).toBe("run bun test now")
    expect(removeMarkdown("file `Arka_Garai_29_PS2.pdf` is ready")).toContain(
      "Arka_Garai_29_PS2.pdf",
    )
  })

  it("keeps the url when unwrapping a markdown link", () => {
    expect(removeMarkdown("[the PDF](https://drive.google.com/file/d/abc_123/view)")).toContain(
      "https://drive.google.com/file/d/abc_123/view",
    )
  })
})
