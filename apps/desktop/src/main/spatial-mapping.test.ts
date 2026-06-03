import { describe, expect, it } from "bun:test"
import type { PointTarget } from "@yomi/shared"
import type { ScreenCapture } from "./capture"
import { displayForScreen, mapGuideElementToScreen, mapPointTargetToScreen } from "./spatial-mapping"

const capture: ScreenCapture = {
  screenshot_b64: "primary",
  screen_width: 1920,
  screen_height: 1080,
  displays: [
    {
      screen: 1,
      displayId: "primary",
      isCursorScreen: false,
      is_cursor_screen: false,
      screenshot_b64: "primary",
      width: 1280,
      height: 720,
      imageWidth: 1280,
      imageHeight: 720,
      scaleFactor: 1.5,
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    },
    {
      screen: 2,
      displayId: "left",
      isCursorScreen: true,
      is_cursor_screen: true,
      screenshot_b64: "left",
      width: 1600,
      height: 900,
      imageWidth: 1600,
      imageHeight: 900,
      scaleFactor: 1,
      bounds: { x: -1600, y: 120, width: 1600, height: 900 },
    },
  ],
}

describe("spatial mapping", () => {
  it("maps screenshot pixel POINT tags onto the requested monitor bounds", () => {
    const target: PointTarget = {
      x: 800,
      y: 450,
      label: "search bar",
      screen: 2,
      coordinateSpace: "screenshot_pixels",
    }

    expect(mapPointTargetToScreen(target, capture)).toEqual({
      x: -800,
      y: 570,
      label: "search bar",
    })
  })

  it("defaults missing screen numbers to the cursor screen", () => {
    const target: PointTarget = {
      x: 640,
      y: 360,
      label: "center",
      coordinateSpace: "screenshot_pixels",
    }

    expect(mapPointTargetToScreen(target, capture)).toEqual({
      x: -960,
      y: 480,
      label: "center",
    })
  })

  it("maps normalized guide bounding boxes to the element center", () => {
    expect(mapGuideElementToScreen({
      label: "save",
      bbox: { x: 0.25, y: 0.2, width: 0.1, height: 0.2 },
    }, capture)).toEqual({
      x: -1120,
      y: 390,
      label: "save",
    })
  })

  it("maps pixel guide bounding boxes to the element center", () => {
    expect(mapGuideElementToScreen({
      label: "file",
      bbox: { x: 20, y: 10, width: 80, height: 30 },
    }, capture)).toEqual({
      x: -1540,
      y: 145,
      label: "file",
    })
  })

  it("falls back to the first display for unknown screen numbers", () => {
    expect(displayForScreen(capture, 99)?.screen).toBe(1)
  })

  it("returns null when no displays are available", () => {
    const emptyCapture: ScreenCapture = {
      screenshot_b64: "",
      screen_width: 0,
      screen_height: 0,
      displays: [],
    }
    expect(mapPointTargetToScreen({
      x: 0,
      y: 0,
      label: "missing",
      coordinateSpace: "normalized",
    }, emptyCapture)).toBeNull()
  })
})
