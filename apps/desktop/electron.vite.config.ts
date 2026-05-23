import { defineConfig, externalizeDepsPlugin } from "electron-vite"
import react from "@vitejs/plugin-react"
import { loadEnv } from "vite"

export default defineConfig(({ mode }) => {
  // Load .env from apps/desktop/ — makes vars available at compile time for main process
  const env = loadEnv(mode ?? "development", process.cwd(), "")

  const mainDefine = {
    "process.env.YOMI_BACKEND_URL": JSON.stringify(
      env["YOMI_BACKEND_URL"] ?? "http://localhost:3001",
    ),
    "process.env.YOMI_DEV": JSON.stringify(env["YOMI_DEV"] ?? "false"),
  }

  return {
    main: {
      plugins: [externalizeDepsPlugin()],
      define: mainDefine,
    },
    preload: {
      plugins: [externalizeDepsPlugin()],
    },
    renderer: {
      plugins: [react()],
    },
  }
})
