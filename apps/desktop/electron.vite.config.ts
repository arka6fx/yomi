import { defineConfig, externalizeDepsPlugin } from "electron-vite"
import react from "@vitejs/plugin-react"
import { loadEnv } from "vite"

export default defineConfig(({ mode }) => {
  // Load .env from apps/desktop/ — makes vars available at compile time for main process
  const env = loadEnv(mode ?? "development", process.cwd(), "")
  const isDev = mode === "development"
  const defaultBackendUrl = isDev ? "http://localhost:3001" : "https://getyomi.in"

  const mainDefine = {
    "process.env.YOMI_BACKEND_URL": JSON.stringify(env["YOMI_BACKEND_URL"] ?? defaultBackendUrl),
    "process.env.YOMI_DEV": JSON.stringify(isDev ? "true" : "false"),
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
