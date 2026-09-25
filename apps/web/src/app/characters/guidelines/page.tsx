import type { Metadata } from "next"
import Link from "next/link"
import { pageMetadata } from "@/lib/site"
import { SitePage } from "@/components/SitePage"

export const metadata: Metadata = pageMetadata({
  title: "Character guidelines",
  description:
    "What you can and can't make with Yomi characters: fan-made personas, original characters, and the hard lines we enforce.",
  path: "/characters/guidelines",
})

export default function CharacterGuidelinesPage() {
  return (
    <SitePage>
      <div className="mx-auto max-w-3xl px-6 pb-24 pt-16">
        <p className="eyebrow mb-4">Characters</p>
        <h1 className="mb-3 text-5xl font-semibold tracking-[-0.04em] text-foreground sm:text-6xl">
          Character guidelines
        </h1>
        <p className="mb-16 text-sm text-muted-foreground/90">Last updated: September 2026</p>

        <div className="space-y-10 text-sm leading-7 text-muted-foreground">
          <Section title="The short version">
            <p>
              Characters are personas you give Yomi so it texts you in a different voice. They are
              AI, everything they say is made up, and they still follow every Yomi rule: the same
              tools, the same approvals before anything is sent or changed, and the same limits
              below. Characters follow the same age rules as the rest of Yomi (see our{" "}
              <Link href="/terms">terms</Link>).
            </p>
          </Section>

          <Section title="What's welcome">
            <ul>
              <li>Original characters: friends, coaches, tutors, narrators, rivals, mascots.</li>
              <li>
                Fan-made takes on fictional characters, labelled with what they are based on. They
                are unofficial and not endorsed by the people who own that character.
              </li>
              <li>Roleplay, practice partners, study buddies and silly bits.</li>
            </ul>
          </Section>

          <Section title="Hard lines">
            <p>We remove characters, and may close accounts, that:</p>
            <ul>
              <li>Sexualise minors in any way, including characters who look or act young.</li>
              <li>Impersonate a real, private person, or pretend to be a real public figure.</li>
              <li>Pose as Yomi, the Yomi team, or a support agent.</li>
              <li>Promote self-harm, violence against real people, hate, or harassment.</li>
              <li>Are built to scam, collect passwords or payment details, or mislead others.</li>
              <li>Encourage anything illegal where you live.</li>
            </ul>
            <p>
              Some of these are checked automatically when you save a character. The checks are not
              perfect, so the rules apply whether or not a check catches something.
            </p>
          </Section>

          <Section title="Pictures and names">
            <p>
              Only use a picture you have the right to use, and credit where it came from. Gallery
              pictures show their source under the character. If you own a character or picture and
              want it taken down, see our <Link href="/copyright">copyright page</Link>.
            </p>
          </Section>

          <Section title="Safety">
            <p>
              A character never claims to be a real human if you sincerely ask. Say &ldquo;back to
              yomi&rdquo; or send /yomi on Telegram at any time to switch back. If you are in
              crisis, please contact local emergency services; a character is not a substitute for
              real help.
            </p>
          </Section>

          <Section title="Reporting">
            <p>
              Tap <em>report</em> on any character, or email{" "}
              <a href="mailto:contact.arkagarai@gmail.com">contact.arkagarai@gmail.com</a> with the
              character&rsquo;s name and what&rsquo;s wrong. We read every report.
            </p>
          </Section>
        </div>
      </div>
    </SitePage>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h2 className="text-2xl font-semibold text-foreground">{title}</h2>
      <div className="space-y-3 [&_a]:text-primary [&_a]:transition-colors [&_a]:hover:text-foreground [&_li]:relative [&_li]:pl-4 [&_li]:before:absolute [&_li]:before:left-0 [&_li]:before:text-xs [&_li]:before:text-primary [&_li]:before:content-['›'] [&_ul]:list-none [&_ul]:space-y-1.5">
        {children}
      </div>
    </div>
  )
}
