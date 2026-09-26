import type { Metadata } from "next"
import { DocsArticle } from "@/components/docs/DocsArticle"
import { DOCS_PAGES } from "@/components/docs/docs-pages"
import { pageMetadata } from "@/lib/site"

export const metadata: Metadata = pageMetadata({
  title: "Docs",
  description:
    "Meet Yomi, the personal AI that lives in your Telegram: what it does, how to start, and every feature explained.",
  path: "/docs",
})

export default function DocsHome() {
  return <DocsArticle page={DOCS_PAGES[0]!} />
}
