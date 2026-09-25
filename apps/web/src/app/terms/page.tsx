import type { Metadata } from "next"
import { pageMetadata } from "@/lib/site"
import { SitePage } from "@/components/SitePage"

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
        <p className="eyebrow mb-4">Legal</p>
        <h1 className="mb-3 text-5xl font-semibold tracking-[-0.04em] text-foreground sm:text-6xl">
          Terms of Service
        </h1>
        <p className="mb-16 text-sm text-muted-foreground/90">Last updated: July 2026</p>

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

          <Section title="Subscriptions, credits, and billing">
            <ul>
              <li>
                Paid plans are billed monthly via Dodo Payments. Prices are listed at
                getyomi.in/pricing.
              </li>
              <li>
                Usage is metered in credits. Each plan includes a monthly credit allowance that
                resets each billing cycle; unused monthly credits do not roll over.
              </li>
              <li>
                Pro and Max may purchase one-time credit packs. Credit packs and consumed credits
                are non-refundable.
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

          <Section title="Explore plan and limits">
            <p>
              Explore is a free plan with a monthly credit allowance that renews automatically,
              provided as-is. We may adjust its limits at any time. Sustained abuse (for example,
              creating multiple accounts to circumvent the credit allowance) may result in
              suspension.
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
                href="mailto:contact.arkagarai@gmail.com"
                className="text-primary underline underline-offset-2 hover:text-foreground"
              >
                contact.arkagarai@gmail.com
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
    <div className="space-y-3">
      <h2 className="text-2xl font-semibold text-foreground">{title}</h2>
      <div className="space-y-3 [&_a]:text-primary [&_a]:transition-colors [&_a]:hover:text-foreground [&_li]:relative [&_li]:pl-4 [&_li]:before:absolute [&_li]:before:left-0 [&_li]:before:text-xs [&_li]:before:text-primary [&_li]:before:content-['›'] [&_ul]:list-none [&_ul]:space-y-1.5">
        {children}
      </div>
    </div>
  )
}
