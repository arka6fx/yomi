import type { Metadata } from "next"
import Nav from "@/components/Nav"
import LandingFooter from "@/components/landing/LandingFooter"

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "Read Yomi's Privacy Policy: how we handle your data, what Google API scopes we request, and your rights to access, export, or delete your information.",
  alternates: { canonical: "https://getyomi.in/privacy" },
}

export default function PrivacyPage() {
  return (
    <div className="landing-light site-texture-bg-light min-h-screen text-foreground">
      <Nav />
      <main className="pt-16">
        <div className="mx-auto max-w-3xl px-6 py-24">
          <p className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
            Legal
          </p>
          <h1 className="mb-2 font-accent text-5xl text-foreground">Privacy Policy</h1>
          <p className="mb-16 text-sm text-muted-foreground/70">Last updated: July 19, 2026</p>

          <div className="max-w-none space-y-10 text-sm leading-7 text-muted-foreground">
            <Section title="Overview">
              <p>
                Yomi is an AI assistant you talk to on Telegram — by text, voice, or images — and
                that connects to your apps: Gmail, Google Calendar, Google Drive, Google Classroom, Google Tasks,
                Google Meet, GitHub, Notion, Slack, and Linear. It is designed to
                be private by default: data from your connected apps is used only to answer your
                direct queries and is not stored, shared, or used to train AI models.
              </p>
              <p>
                Two rules govern everything below.{" "}
                <strong className="text-foreground">Nothing is accessed unless you ask.</strong> Yomi
                acts on your own data, in response to your own request, and never crawls your
                accounts in the background.{" "}
                <strong className="text-foreground">
                  Every action that changes something is approved by you first
                </strong>{" "}
                — sending an email, creating an event, or saving a file shows you
                exactly what will happen before it happens.
              </p>
            </Section>

            <Section title="Google API Services: User Data">
              <p>
                Each Google service below is a separate connector that you connect individually from
                your Yomi dashboard. You are never asked for access to a service you have not chosen
                to connect. When you connect one, Yomi may request the following access:
              </p>
              <ul>
                <li>
                  <strong className="text-foreground">Gmail</strong> (
                  <code className="text-primary">gmail.modify</code>,{" "}
                  <code className="text-primary">gmail.send</code>) to read, search, organize,
                  and send emails when you ask Yomi a question about your inbox.
                </li>
                <li>
                  <strong className="text-foreground">Google Calendar</strong> (
                  <code className="text-primary">calendar</code>) to answer schedule queries
                  such as &ldquo;What&apos;s on my calendar today?&rdquo; and to create, update, or
                  delete events when you ask — every change requires your approval first.
                </li>
                <li>
                  <strong className="text-foreground">Google Drive</strong> (
                  <code className="text-primary">drive</code>) to search and read your Drive
                  files when you ask about them, and to create or convert documents,
                  spreadsheets, and presentations on your request.
                </li>
                <li>
                  <strong className="text-foreground">Google Classroom</strong> (
                  <code className="text-primary">classroom.courses.readonly</code>,{" "}
                  <code className="text-primary">classroom.coursework.me</code>,{" "}
                  <code className="text-primary">classroom.announcements.readonly</code>) to
                  list your classes, assignments, and announcements and check your own submission
                  status.
                </li>
                <li>
                  <strong className="text-foreground">Google Tasks</strong> (
                  <code className="text-primary">tasks</code>) to read your to-do lists and
                  create, edit, complete, or delete tasks on your request.
                </li>
                <li>
                  <strong className="text-foreground">Google Meet</strong> (
                  <code className="text-primary">meetings.space.created</code>,{" "}
                  <code className="text-primary">meetings.space.readonly</code>,{" "}
                  <code className="text-primary">meetings.space.settings</code>) to create
                  meeting links on your request and read your past calls — who attended and, where
                  your plan produces one, the transcript — so we can summarise a meeting you ask
                  about.
                </li>
              </ul>
              <p>
                <strong className="text-foreground">Limited Use.</strong> Yomi&apos;s use and transfer of
                information received from Google APIs to any other app will adhere to the{" "}
                <a
                  href="https://developers.google.com/terms/api-services-user-data-policy"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Google API Services User Data Policy
                </a>
                , including the Limited Use requirements. Specifically, this data is used{" "}
                <strong className="text-foreground">only</strong> to provide or improve user-facing
                features that are prominent in Yomi&apos;s interface. It is{" "}
                <strong className="text-foreground">not</strong> sold, <strong className="text-foreground">not</strong>{" "}
                transferred to third parties except as needed to provide those features or as
                required by law, <strong className="text-foreground">not</strong> used for advertising,
                and <strong className="text-foreground">not</strong> used to develop, improve, or train
                generalised AI or machine-learning models.
              </p>
              <p>
                <strong className="text-foreground">Human access.</strong> No human at Yomi reads your
                Google data. The only exceptions are the ones the policy allows: with your explicit
                consent (for example if you send us a message to debug a problem), where necessary
                for security purposes such as investigating abuse, or where required by law.
              </p>
              <p>
                <strong className="text-foreground">Scopes we deliberately do not request.</strong> Yomi
                does not request <code className="text-primary">https://mail.google.com/</code>,
                so it can never permanently delete a message — the most it can do is move mail to
                trash, which you can undo. Yomi also never submits coursework on your behalf; it
                prepares the file and hands it back to you to attach.
              </p>
              <p>
                <strong className="text-foreground">Retention.</strong> Content fetched from a Google API
                to answer a request is held in memory for that request and discarded once the
                response is returned. The exception is a file you explicitly ask Yomi to save, which
                lives in your own Drive under your control.
              </p>
              <p>
                You can revoke Yomi&apos;s access to your Google account at any time from{" "}
                <a
                  href="https://myaccount.google.com/permissions"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  myaccount.google.com/permissions
                </a>{" "}
                or by disconnecting the integration from your Yomi dashboard.
              </p>
            </Section>

            <Section title="Data we collect">
              <p>We collect the minimum data needed to operate the service:</p>
              <ul>
                <li>
                  <strong className="text-foreground">Account data</strong>: email address, OAuth
                  provider identifier (Google or GitHub). No passwords stored.
                </li>
                <li>
                  <strong className="text-foreground">Usage events</strong>: query count, agent runs,
                  token usage, and cost. Used for metering and billing. No prompt content stored.
                </li>
                <li>
                  <strong className="text-foreground">Device metadata</strong>: OS, app version,
                  last-seen timestamp. Used for support and compatibility.
                </li>
                <li>
                  <strong className="text-foreground">Memory blobs</strong>: if cloud sync is enabled,
                  your Yomi notepad is encrypted and synced. You can delete it at any time.
                </li>
              </ul>
            </Section>

            <Section title="Data we never collect">
              <ul>
                <li>Screen recordings or background screen captures</li>
                <li>Raw audio recordings</li>
                <li>
                  Prompt content or conversation history (unless you explicitly enable cloud memory)
                </li>
                <li>Content from blocklisted apps (password managers, banking apps)</li>
              </ul>
            </Section>

            <Section title="Data handling during queries">
              <p>
                When you send a message, any image you attach and your transcribed voice text are
                sent to our LLM proxy to generate a response. Neither is stored after the request
                completes. Yomi only processes what you send it — it never captures your screen or
                microphone in the background.
              </p>
            </Section>

            <Section title="Third-party services">
              <p>We use the following third-party services:</p>
              <ul>
                <li>
                  <strong className="text-foreground">Composio</strong>: integration provider for
                  select connected apps (currently all Google connectors — Gmail,
                  Calendar, Drive, Classroom, Tasks, Meet — plus Linear,
                  GitHub, Slack, and Notion). When you
                  use a Composio-backed connector, your requests to that app and their results
                  transit Composio&apos;s servers on the way to and from the provider. Composio
                  manages authentication and tool access and holds the connection on our behalf.
                  For Composio-backed connectors, Yomi stores only a reference to the connection,
                  not your access tokens. Governed by{" "}
                  <a
                    href="https://composio.dev/legal/privacy"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Composio&apos;s Privacy Policy
                  </a>
                  .
                </li>
                <li>
                  <strong className="text-foreground">Google APIs</strong>: Gmail, Calendar, Drive,
                  Classroom, Tasks, and Meet data accessed on your behalf when you ask
                  Yomi to do something. Governed by Google&apos;s{" "}
                  <a
                    href="https://policies.google.com/privacy"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Privacy Policy
                  </a>
                  . Yomi&apos;s use complies with the Google API Services User Data Policy,
                  including Limited Use requirements.
                </li>
                <li>
                  <strong className="text-foreground">OpenAI</strong>: LLM inference via our proxy, plus
                  speech-to-text for voice messages you send (Yomi always replies in text). Query
                  content (including excerpts from connected apps) is sent only to generate a
                  response, and is subject to their privacy policy. We do not enable training data
                  use.
                </li>
                <li>
                  <strong className="text-foreground">Telegram</strong>: if you link your Telegram
                  account, the messages you send the Yomi bot pass through Telegram&apos;s
                  infrastructure and are subject to their privacy policy. Linking is optional and
                  can be undone from your dashboard.
                </li>
                <li>
                  <strong className="text-foreground">Dodo Payments</strong>: payment processing. We
                  never store card details.
                </li>
                <li>
                  <strong className="text-foreground">AWS RDS (Postgres)</strong>: encrypted database
                  hosting for account data, usage events, and encrypted OAuth tokens.
                </li>
              </ul>
            </Section>

            <Section title="Data retention">
              <p>
                Usage events are retained for 12 months for billing purposes then deleted. Account
                data is retained while your account is active. You can delete your account and all
                associated data at any time from Settings → Account → Delete account.
              </p>
            </Section>

            <Section title="Your rights">
              <p>You have the right to:</p>
              <ul>
                <li>Access a copy of all data we hold about you</li>
                <li>Delete your account and all associated data</li>
                <li>Export your memory/notepad data</li>
                <li>Opt out of cloud sync (use local-only mode)</li>
              </ul>
              <p>
                To exercise these rights, contact us at{" "}
                <a
                  href="mailto:contact.arkagarai@gmail.com"
                  className="text-primary underline underline-offset-2 hover:text-foreground"
                >
                  contact.arkagarai@gmail.com
                </a>
                .
              </p>
            </Section>

            <Section title="Security">
              <p>
                Memory blobs are encrypted at rest using AES-256. OAuth tokens for MCP connectors
                are encrypted. We use HTTPS for all data in transit. We conduct regular security
                reviews.
              </p>
            </Section>

            <Section title="Changes to this policy">
              <p>
                We will notify users of material changes via email at least 14 days before they take
                effect. The latest version is always at getyomi.in/privacy.
              </p>
            </Section>

            <Section title="Contact">
              <p>
                Questions? Email{" "}
                <a
                  href="mailto:contact.arkagarai@gmail.com"
                  className="text-primary underline underline-offset-2 hover:text-foreground"
                >
                  contact.arkagarai@gmail.com
                </a>{" "}
                or open an issue on{" "}
                <a
                  href="https://github.com/arka6fx/yomi-feedback"
                  className="text-primary underline underline-offset-2 hover:text-foreground"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  GitHub
                </a>
                .
              </p>
            </Section>
          </div>
        </div>
      </main>
      <LandingFooter />
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h2 className="font-accent text-2xl text-foreground">{title}</h2>
      <div className="space-y-3 [&_a]:text-primary [&_a]:transition-colors [&_a]:hover:text-foreground [&_li]:relative [&_li]:pl-4 [&_li]:before:absolute [&_li]:before:left-0 [&_li]:before:text-xs [&_li]:before:text-primary [&_li]:before:content-['›'] [&_strong]:font-medium [&_ul]:list-none [&_ul]:space-y-1.5">
        {children}
      </div>
    </div>
  )
}
