import type { Metadata } from "next"
import Link from "next/link"
import { pageMetadata } from "@/lib/site"
import { SitePage } from "@/components/SitePage"
import { Mascot } from "@/components/Mascot"

export const metadata: Metadata = pageMetadata({
  title: "Copyright and takedowns",
  description:
    "How to ask Yomi to remove a character, name or picture you own, and what to do if your character was removed.",
  path: "/copyright",
})

export default function CopyrightPage() {
  return (
    <SitePage>
      <div className="mx-auto max-w-3xl px-6 pb-24 pt-16">
        <Mascot pose="thinking" float className="float-right -mt-2 ml-4 w-20 sm:w-28" />
        <p className="hero-in eyebrow mb-4">Legal</p>
        <h1 className="hero-in mb-3 text-5xl font-semibold tracking-[-0.04em] text-foreground sm:text-6xl">
          Copyright and takedowns
        </h1>
        <p className="hero-in mb-16 text-sm text-muted-foreground/90">
          Last updated: September 2026
        </p>

        <div className="space-y-10 text-sm leading-7 text-muted-foreground">
          <Section title="Our approach">
            <p>
              Yomi characters can be original or fan-made. Fan-made characters are labelled
              &ldquo;based on &hellip;&rdquo;, are unofficial, and are not affiliated with or
              endorsed by the owners of the original work. Pictures carry a credit to their source.
              We respect creators&rsquo; rights and act quickly on valid requests.
            </p>
          </Section>

          <Section title="Asking us to remove something">
            <p>
              If you own, or are authorised to act for the owner of, a character, name, picture or
              other work used on Yomi, email{" "}
              <a href="mailto:support@getyomi.in?subject=Copyright%20takedown">
                support@getyomi.in
              </a>{" "}
              with the subject &ldquo;Copyright takedown&rdquo; and include:
            </p>
            <ul>
              <li>Your name, organisation (if any) and contact details.</li>
              <li>The work you own, and the character or picture on Yomi that uses it.</li>
              <li>A statement that you believe in good faith the use is not authorised.</li>
              <li>
                A statement that the information is accurate and that you are the owner or
                authorised to act for them.
              </li>
              <li>Your physical or electronic signature.</li>
            </ul>
            <p>
              We usually respond within a few business days. When a request is valid we remove or
              change the material and, where it applies, tell the person who made it.
            </p>
          </Section>

          <Section title="If your character was removed">
            <p>
              If you believe a character you made was removed by mistake, or you have the rights to
              it, reply to our notice or email us with the details. We may restore it or pass your
              reply on to the person who complained.
            </p>
          </Section>

          <Section title="Repeat problems">
            <p>
              Accounts that repeatedly upload material they don&rsquo;t have the rights to may lose
              access to characters or to Yomi. See also our{" "}
              <Link href="/characters/guidelines">character guidelines</Link> and{" "}
              <Link href="/terms">terms</Link>.
            </p>
          </Section>
        </div>
      </div>
    </SitePage>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div data-reveal className="space-y-3">
      <h2 className="text-2xl font-semibold text-foreground">{title}</h2>
      <div className="space-y-3 [&_a]:text-primary [&_a]:transition-colors [&_a]:hover:text-foreground [&_li]:relative [&_li]:pl-4 [&_li]:before:absolute [&_li]:before:left-0 [&_li]:before:text-xs [&_li]:before:text-primary [&_li]:before:content-['›'] [&_ul]:list-none [&_ul]:space-y-1.5">
        {children}
      </div>
    </div>
  )
}
