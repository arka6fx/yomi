import { and, eq } from "drizzle-orm"
import { db, platformConnections } from "@yomi/db"

// Sends a plain text message directly via the Telegram Bot API — not through
// runAgent(). Used for template-filled, uncharged messages (schedule delivery,
// connector starter-prompt nudges), never for agent-generated replies.
export async function sendTelegram(chatId: string, text: string): Promise<boolean> {
  const token = process.env["TELEGRAM_BOT_TOKEN"]
  if (!token) return false
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(0, 4000) }),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function telegramChatFor(userId: string): Promise<string | null> {
  const [row] = await db
    .select({
      chatId: platformConnections.platformChatId,
      userId: platformConnections.platformUserId,
    })
    .from(platformConnections)
    .where(
      and(eq(platformConnections.userId, userId), eq(platformConnections.platform, "telegram")),
    )
    .limit(1)
  return row?.chatId ?? row?.userId ?? null
}
