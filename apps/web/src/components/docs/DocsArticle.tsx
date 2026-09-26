import Link from "next/link"
import { ArrowLeft, ArrowRight } from "lucide-react"
import { DOCS_CONTENT, Lede } from "./content"
import { docsHref, neighbours, type DocsPage } from "./docs-pages"

// One docs page: the lede, its content, and previous / next links.
export function DocsArticle({ page }: { page: DocsPage }) {
  const Content = DOCS_CONTENT[page.slug]
  const { prev, next } = neighbours(page.slug)
  return (
    <>
      <Lede>{page.summary}</Lede>
      {Content && <Content />}
      <nav
        aria-label="More docs"
        className="mt-16 grid gap-3 border-t border-black/10 pt-8 sm:grid-cols-2"
      >
        {prev ? (
          <Link href={docsHref(prev)} className="docs-pager">
            <span className="flex items-center gap-1 text-[13px] text-[#1d1b18]/55">
              <ArrowLeft size={13} /> previous
            </span>
            <span className="font-medium text-[#1d1b18]">{prev.title}</span>
          </Link>
        ) : (
          <span />
        )}
        {next && (
          <Link href={docsHref(next)} className="docs-pager sm:text-right">
            <span className="flex items-center gap-1 text-[13px] text-[#1d1b18]/55 sm:justify-end">
              next <ArrowRight size={13} />
            </span>
            <span className="font-medium text-[#1d1b18]">{next.title}</span>
          </Link>
        )}
      </nav>
    </>
  )
}
