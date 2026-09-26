import type { Metadata } from "next"
import Link from "next/link"
import { Check, Shield } from "lucide-react"
import { Mascot } from "@/components/Mascot"
import { SitePage } from "@/components/SitePage"
import { pageMetadata } from "@/lib/site"

export const metadata: Metadata = pageMetadata({
  title: "How Yomi uses Google data",
  description:
    "Why Yomi asks for Google Sign-In, which Google scopes it requests, and how that data is handled under the Google API Services User Data Policy.",
  path: "/google-data",
})

// Google OAuth verification: app purpose, requested scopes and data handling, linked
// from the footer on every page. Keep it accurate and don't remove it.
export default function GoogleDataPage() {
  return (
    <SitePage>
      <div className="pt-10">
        <Mascot pose="laptop" float className="mx-auto w-24 sm:w-28" />
        {/* ── What is Yomi? ────────────────────────────────────────────────── */}
        <section id="about" className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
          <p className="eyebrow">about</p>
          <h2 className="mt-3 text-4xl font-semibold sm:text-5xl">what is yomi?</h2>
          <div className="mt-6 space-y-4 text-[15px] leading-relaxed text-muted-foreground">
            <p>
              Yomi is an AI productivity assistant that connects to the apps you already use so you
              can query, analyze, and act on your work using natural language, without switching
              apps or copy-pasting context.
            </p>
            <p>
              Ask Yomi to find a file, summarize a document, or pull context from your workspace,
              all from a single interface or via Telegram. Yomi only accesses your data when you ask
              a question, and for no other purpose.
            </p>
          </div>
        </section>

        {/* ── How Yomi Uses Google Data ─────────────────────────────────────── */}
        <section id="google-data" className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
          <div className="mx-auto max-w-3xl">
            <p className="eyebrow">Google Sign-In &amp; Data Policy</p>
            <h2 className="mt-3 text-4xl font-semibold sm:text-5xl">
              why yomi needs google sign-in
            </h2>
            <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">
              Yomi uses Google Sign-In to authenticate your identity and to request permission to
              access your Drive data. Below you will find exactly why sign-in is required and how
              your data is handled.
            </p>
          </div>

          <div className="mx-auto mt-10 max-w-3xl space-y-5">
            <div className="surface p-7 text-[15px] leading-relaxed text-muted-foreground">
              <p className="eyebrow mb-4">app purpose</p>
              <p>
                Yomi is a personal AI assistant. It accesses your Google Drive, with your explicit
                permission, to answer questions you ask in natural language. For example:
                &ldquo;Find the Q3 report in my Drive.&rdquo; or &ldquo;What does the product spec
                say about pricing?&rdquo; Yomi reads data on-demand per request and never stores it.
              </p>
              <p className="mt-3 text-sm">
                Yomi&apos;s use of Google API data complies with the{" "}
                <a
                  href="https://developers.google.com/terms/api-services-user-data-policy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-foreground underline underline-offset-2"
                >
                  Google API Services User Data Policy
                </a>
                , including the Limited Use requirements.
              </p>
            </div>

            <div className="surface p-7 text-[15px] leading-relaxed text-muted-foreground">
              <p className="eyebrow mb-5">why google sign-in is required</p>
              <div className="space-y-5">
                <p>
                  <strong className="font-semibold text-foreground">
                    To verify your identity.
                  </strong>{" "}
                  Yomi uses Google&apos;s authentication system to confirm who you are, so it can
                  securely associate your connected apps, settings, and preferences with your
                  account. Anonymous access is not possible because Yomi operates on your personal
                  file data, so it cannot function without knowing which Google account to query.
                </p>
                <p>
                  <strong className="font-semibold text-foreground">
                    To request permission to access your Drive.
                  </strong>{" "}
                  Google&apos;s OAuth consent screen lets you choose exactly which services Yomi may
                  access. Yomi cannot retrieve your Drive files without your explicit authorization.
                  Each permission is granted individually and can be revoked at any time from your
                  Yomi dashboard or from{" "}
                  <a
                    href="https://myaccount.google.com/permissions"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-foreground underline underline-offset-2"
                  >
                    Google Account settings
                  </a>
                  .
                </p>
                <p>
                  <strong className="font-semibold text-foreground">
                    Your data is never stored, sold, or shared.
                  </strong>{" "}
                  When you ask a question, Yomi fetches only the data needed to answer it and
                  discards it immediately after responding. No Drive files are retained on
                  Yomi&apos;s servers between requests. Your Google data is never sold, never used
                  to train AI models, and is not shared with third parties except the providers
                  required to deliver the features you use: our AI inference provider, and — for
                  connected apps routed through Composio — Composio, which manages those
                  integrations on our behalf.
                </p>
              </div>
            </div>

            <div className="surface p-7 text-[15px] leading-relaxed text-muted-foreground">
              <p>
                Yomi only accesses Google data after you explicitly authorize access through
                Google&apos;s OAuth consent flow. You may revoke access at any time.
              </p>
              <p className="mt-4 font-semibold text-foreground">
                Depending on the integrations you enable, Yomi may request:
              </p>
              <div className="mt-3 flex items-start gap-3">
                <Check size={16} className="mt-1 shrink-0 text-brand" />
                <div>
                  <p className="font-semibold text-foreground">Google Drive</p>
                  <p className="font-mono text-xs">drive.file</p>
                  <p className="mt-1">
                    <strong className="font-semibold text-foreground">Purpose:</strong> To search,
                    read, and navigate files you choose to share with Yomi. For example: &ldquo;Find
                    the Q3 budget spreadsheet&rdquo; or &ldquo;What does the product spec say about
                    pricing?&rdquo;
                  </p>
                </div>
              </div>
              <p className="mt-4">
                Yomi does not sell user data. Google API data is used only to respond to your
                current request and is discarded immediately after.
              </p>
            </div>
          </div>
        </section>

        {/* ── Data & Integrations transparency ─────────────────────────────── */}
        <section id="data-use" className="mx-auto max-w-5xl px-4 py-16 sm:px-6">
          <div className="mx-auto max-w-3xl">
            <p className="eyebrow">Transparency</p>
            <h2 className="mt-3 text-4xl font-semibold sm:text-5xl">what yomi accesses, and why</h2>
            <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground">
              Yomi only reads data when you ask a question. Nothing is stored between queries. You
              can revoke any integration at any time.
            </p>
          </div>

          <div className="surface mx-auto mt-10 max-w-3xl overflow-hidden !p-0">
            {[
              {
                provider: "Google Drive",
                scopes: "drive.file",
                why: "To list and read files you choose to share with Yomi, so you can ask questions about their content.",
              },
              {
                provider: "Notion",
                scopes: "Public integration",
                why: "To search pages, read content, and create or update pages and database entries.",
              },
            ].map((row, i) => (
              <div
                key={row.provider}
                className={`flex flex-col gap-1 px-7 py-5 text-[15px] sm:flex-row sm:gap-4 ${
                  i < 1 ? "border-b border-border" : ""
                }`}
              >
                <div className="w-44 shrink-0 font-semibold">{row.provider}</div>
                <div className="flex flex-1 flex-col gap-1">
                  <p className="font-mono text-xs text-muted-foreground">{row.scopes}</p>
                  <p className="text-muted-foreground">{row.why}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="surface mx-auto mt-5 max-w-3xl p-7 text-[15px] leading-relaxed text-muted-foreground">
            <p className="mb-3 font-semibold text-foreground">How your data is protected</p>
            <p className="mb-3">
              Data from integrations is used only to answer your current query and is never stored
              after the request completes. OAuth tokens are encrypted at rest using AES-256-GCM and
              are never shared with third parties.
            </p>
            <p className="mb-3">
              Yomi&apos;s use of Google API data complies with the{" "}
              <Link
                href="https://developers.google.com/terms/api-services-user-data-policy"
                className="font-medium text-foreground underline underline-offset-2"
                target="_blank"
                rel="noopener noreferrer"
              >
                Google API Services User Data Policy
              </Link>
              , including the Limited Use requirements. You can disconnect any integration instantly
              from your dashboard or from{" "}
              <Link
                href="https://myaccount.google.com/permissions"
                className="font-medium text-foreground underline underline-offset-2"
                target="_blank"
                rel="noopener noreferrer"
              >
                Google Account settings
              </Link>
              .
            </p>
            <p>
              Read our full{" "}
              <Link
                href="/privacy"
                className="font-medium text-foreground underline underline-offset-2"
              >
                Privacy Policy
              </Link>{" "}
              for details on data handling and your rights.
            </p>
          </div>

          <div className="mx-auto mt-6 flex max-w-3xl flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link href="/privacy" className="btn-key px-5 py-2.5 text-sm">
              <Shield size={14} />
              View Privacy Policy
            </Link>
            <Link href="/terms" className="btn-key px-5 py-2.5 text-sm">
              View Terms of Service
            </Link>
          </div>
        </section>
      </div>
    </SitePage>
  )
}
