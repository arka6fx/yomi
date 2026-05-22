import type { Metadata } from "next"
import Nav from "@/components/Nav"
import Footer from "@/components/Footer"

export const metadata: Metadata = {
  title: "Privacy Policy — Yomi",
}

export default function PrivacyPage() {
  return (
    <>
      <Nav />
      <main className="pt-16">
        <div className="max-w-3xl mx-auto px-6 py-24">
          <p className="font-mono text-xs text-caption uppercase tracking-widest mb-3">
            Legal
          </p>
          <h1 className="font-display text-4xl font-extrabold mb-2">Privacy Policy</h1>
          <p className="text-caption text-sm mb-16">Last updated: May 2025</p>

          <div className="prose prose-sm max-w-none space-y-10 text-caption leading-relaxed">
            <Section title="Overview">
              <p>
                Yomi is designed to be private by default. Screen and audio data is processed
                locally on your device whenever possible. Only the distilled prompt — never raw
                screenshots or audio recordings — leaves your machine when using cloud features.
              </p>
            </Section>

            <Section title="Data we collect">
              <p>We collect the minimum data needed to operate the service:</p>
              <ul>
                <li>
                  <strong className="text-label">Account data</strong> — email address, OAuth
                  provider identifier (Google or GitHub). No passwords stored.
                </li>
                <li>
                  <strong className="text-label">Usage events</strong> — query count, agent runs,
                  token usage, and cost. Used for metering and billing. No prompt content stored.
                </li>
                <li>
                  <strong className="text-label">Device metadata</strong> — OS, app version,
                  last-seen timestamp. Used for support and compatibility.
                </li>
                <li>
                  <strong className="text-label">Memory blobs</strong> — if cloud sync is enabled,
                  your Yomi notepad is encrypted and synced. You can delete it at any time.
                </li>
              </ul>
            </Section>

            <Section title="Data we never collect">
              <ul>
                <li>Raw screenshots or screen recordings</li>
                <li>Raw audio recordings</li>
                <li>Prompt content or conversation history (unless you explicitly enable cloud memory)</li>
                <li>Content from blocklisted apps (password managers, banking apps)</li>
              </ul>
            </Section>

            <Section title="Local processing">
              <p>
                By default, STT transcription and screen analysis happen on-device. Only a
                structured description of your screen and transcribed text are sent to our LLM
                proxy when processing a query. On the Free plan, all speech processing is local.
              </p>
            </Section>

            <Section title="Third-party services">
              <p>We use the following third-party services:</p>
              <ul>
                <li>
                  <strong className="text-label">Anthropic / OpenAI / Groq</strong> — LLM
                  inference via our proxy. Prompts sent to these providers are subject to their
                  respective privacy policies. We do not enable training data use.
                </li>
                <li>
                  <strong className="text-label">ElevenLabs</strong> — cloud STT and TTS on Pro+
                  plans.
                </li>
                <li>
                  <strong className="text-label">Stripe</strong> — payment processing. We never
                  store card details.
                </li>
                <li>
                  <strong className="text-label">Neon (Postgres)</strong> — encrypted database
                  hosting.
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
                <a href="mailto:privacy@yomi.app" className="text-accent">
                  privacy@yomi.app
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
                We will notify users of material changes via email at least 14 days before they
                take effect. The latest version is always at yomi.app/privacy.
              </p>
            </Section>

            <Section title="Contact">
              <p>
                Questions? Email{" "}
                <a href="mailto:privacy@yomi.app" className="text-accent">
                  privacy@yomi.app
                </a>{" "}
                or open an issue on{" "}
                <a
                  href="https://github.com/arka6fx/yomi"
                  className="text-accent"
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
      <Footer />
    </>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h2 className="font-display text-lg font-semibold text-label">{title}</h2>
      <div className="space-y-3 [&_ul]:list-none [&_ul]:space-y-1.5 [&_li]:pl-4 [&_li]:relative [&_li]:before:content-['▸'] [&_li]:before:absolute [&_li]:before:left-0 [&_li]:before:text-accent [&_li]:before:text-xs [&_a]:text-accent [&_a]:hover:text-accent/80 [&_a]:transition-colors">
        {children}
      </div>
    </div>
  )
}
