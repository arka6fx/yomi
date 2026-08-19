export function truncate(text: string, max: number) {
  const trimmed = text.trim()
  return trimmed.length > max ? `${trimmed.slice(0, max).trim()}…` : trimmed
}

export function relativePast(value: string) {
  const minutes = Math.round((Date.now() - new Date(value).getTime()) / 60_000)
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}
