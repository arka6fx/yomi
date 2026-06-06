function backendBaseUrl(): string {
  return process.env["YOMI_BACKEND_URL"] ?? process.env["BACKEND_URL"] ?? "http://localhost:3001"
}

function sessionToken(): string {
  return process.env["YOMI_SESSION_TOKEN"] ?? ""
}

export function reportUsage(kind: string): void {
  const token = sessionToken()
  if (!token) return

  fetch(`${backendBaseUrl()}/api/usage/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ kind }),
  }).catch(() => {})
}
