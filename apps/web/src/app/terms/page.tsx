import type { Metadata } from "next"
import { pageMetadata } from "@/lib/site"
import { SitePage } from "@/components/SitePage"
import { Mascot } from "@/components/Mascot"

export const metadata: Metadata = pageMetadata({
  title: "Terms of Service",
  description:
    "Yomi Terms of Service: the agreement between you and Yomi governing your use of the web app, API integrations, and subscription plans.",
  path: "/terms",
})

export default function TermsPage() {
  return (
    <SitePage>
      <div className="mx-auto max-w-3xl px-6 pb-24 pt-16">
        <Mascot pose="reading" float className="float-right -mt-2 ml-4 w-20 sm:w-28" />
        <p className="hero-in eyebrow mb-4">Legal</p>
        <h1 className="hero-in mb-3 text-5xl font-semibold tracking-[-0.04em] text-foreground sm:text-6xl">
          Terms of Service
        </h1>
        <p className="hero-in mb-16 text-sm text-muted-foreground/90">Last updated: July 2026</p>

        <div className="space-y-10 text-sm leading-7 text-muted-foreground">
          <Section title="Acceptance">
            <p>
              By downloading, installing, or using Yomi, you agree to these Terms of Service. If you
              do not agree, do not use Yomi.
            </p>
          </Section>

          <Section title="Description of service">
            <p>
              Yomi is an AI assistant application that integrates with your operating system to
              provide context-aware responses to queries, autonomous task execution, and persistent
              memory. The service includes a web application.
            </p>
          </Section>

          <Section title="Accounts and eligibility">
            <ul>
              <li>You must be 16 years or older to use Yomi.</li>
              <li>You are responsible for maintaining the security of your account.</li>
              <li>One account per person. No account sharing.</li>
              <li>
                Accounts are authenticated via Google or GitHub OAuth. We do not store passwords.
              </li>
            </ul>
          </Section>

          <Section title="Acceptable use">
            <p>You agree not to use Yomi to:</p>
            <ul>
              <li>Violate any applicable law or regulation</li>
              <li>Infringe intellectual property rights of others</li>
              <li>Generate, distribute, or store illegal content</li>
              <li>Circumvent rate limits, quotas, or metering through automated means</li>
              <li>Reverse-engineer or extract model weights or prompts</li>
              <li>Use Yomi to spy on or surveil others without their consent</li>
            </ul>
          </Section>

          <Section title="Subscriptions and billing">
            <ul>
              <li>
                Paid plans are billed monthly via Dodo Payments. Prices are listed at
                getyomi.in/pricing.
              </li>
              <li>
                Chatting is unlimited on every plan; there are no credits. Pro adds the smarter
                engine and unlimited routines.
              </li>
              <li>
                Pro earned through referrals lasts for the stated period and then returns to the
                free plan automatically.
              </li>
              <li>
                Monthly plans can be cancelled at any time from your Yomi dashboard. Access
                continues until the end of the current billing cycle.
              </li>
              <li>
                We reserve the right to change pricing with 30 days notice. Existing subscriptions
                are grandfathered at the locked price for 6 months after a price change.
              </li>
            </ul>
          </Section>

          <Section title="Free plan and fair use">
            <p>
              The free plan is provided as-is and includes up to 3 active routines. Unlimited
              chatting is meant for personal use: automated or abusive traffic (for example,
              scripting the bot or creating multiple accounts to farm referral rewards) may be
              slowed or suspended. We may adjust free plan limits at any time.
            </p>
          </Section>

          <Section title="Connected accounts">
            <p>
              Yomi connects to third-party services on your instruction: Gmail, Google Calendar,
              Google Drive, Google Classroom, Google Tasks, Google Meet, GitHub, Slack, Notion, and
              Linear. You connect each one individually, and you can disconnect any of them at any
              time from your dashboard.
            </p>
            <ul>
              <li>
                You are responsible for having the right to connect an account and to act on the
                data in it. Do not connect an account you are not authorised to use.
              </li>
              <li>
                Yomi acts as your agent. Actions it takes on your instruction — sending an email,
                creating an event, sharing a file — are your actions, and every one of them is shown
                to you for approval before it runs.
              </li>
              <li>
                Your use of each connected service remains governed by that service&apos;s own
                terms. We are not responsible for outages, data loss, or policy changes at a
                third-party provider.
              </li>
              <li>
                AI outputs can be wrong. Review what Yomi proposes before approving it, especially
                anything that leaves your account or changes a shared document.
              </li>
            </ul>
          </Section>

          <Section title="Intellectual property">
            <p>
              Yomi and its source code are proprietary. The application is licensed to you for
              personal or organizational use under your subscription. You may not redistribute or
              sublicense the application.
            </p>
            <p>
              Content you create using Yomi (outputs, generated text, task results) belongs to you.
            </p>
          </Section>

          <Section title="Disclaimer of warranties">
            <p>
              YOMI IS PROVIDED &quot;AS IS&quot; WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED.
              WE DO NOT WARRANT THAT THE SERVICE WILL BE UNINTERRUPTED, ERROR-FREE, OR THAT AI
              OUTPUTS WILL BE ACCURATE. USE AI OUTPUTS AT YOUR OWN JUDGMENT.
            </p>
          </Section>

          <Section title="Limitation of liability">
            <p>
              TO THE MAXIMUM EXTENT PERMITTED BY LAW, YOMI&apos;S LIABILITY IS LIMITED TO THE AMOUNT
              YOU PAID IN THE PAST 12 MONTHS. WE ARE NOT LIABLE FOR INDIRECT, INCIDENTAL, OR
              CONSEQUENTIAL DAMAGES.
            </p>
          </Section>

          <Section title="Termination">
            <p>
              We may suspend or terminate accounts that violate these Terms. You may delete your
              account at any time from Settings → Account → Delete account. Upon deletion, your data
              is purged within 30 days.
            </p>
          </Section>

          <Section title="Changes">
            <p>
              We may update these Terms. Material changes will be emailed to you 14 days in advance.
              Continued use after changes take effect constitutes acceptance.
            </p>
          </Section>

          <Section title="Governing law">
            <p>
              These Terms are governed by the laws of India, and the courts of West Bengal, India
              have exclusive jurisdiction over any dispute arising from them.
            </p>
          </Section>

          <Section title="Contact">
            <p>
              Questions about these Terms? Email{" "}
              <a
                href="mailto:support@getyomi.in"
                className="text-primary underline underline-offset-2 hover:text-foreground"
              >
                support@getyomi.in
              </a>
              .
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
