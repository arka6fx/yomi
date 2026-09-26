import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { DocsArticle } from "@/components/docs/DocsArticle"
import { DOCS_PAGES, getDocsPage } from "@/components/docs/docs-pages"
import { pageMetadata } from "@/lib/site"

export const dynamicParams = false

export function generateStaticParams() {
  return DOCS_PAGES.filter((p) => p.slug).map((p) => ({ slug: p.slug }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const page = getDocsPage((await params).slug)
  if (!page) return {}
  return pageMetadata({
    title: `${page.title[0]!.toUpperCase()}${page.title.slice(1)} · Docs`,
    description: `${page.summary[0]!.toUpperCase()}${page.summary.slice(1)}.`,
    path: `/docs/${page.slug}`,
  })
}

export default async function DocsSlugPage({ params }: { params: Promise<{ slug: string }> }) {
  const page = getDocsPage((await params).slug)
  if (!page) notFound()
  return <DocsArticle page={page} />
}
