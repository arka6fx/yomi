import type { Context, ErrorHandler } from "hono"

export const errorHandler: ErrorHandler = (err: Error, c: Context) => {
  console.error("[yomi/error]", err.message, err.stack)

  if (err.message?.includes("Unexpected error during authentication")) {
    return c.json({
      error: "internal_server_error",
      message: "An unexpected error occurred during authentication. Check server logs for details.",
    }, 500)
  }

  return c.json({
    error: "internal_server_error",
    message: process.env["YOMI_DEV"] === "true" ? err.message : "An unexpected error occurred",
  }, 500)
}
