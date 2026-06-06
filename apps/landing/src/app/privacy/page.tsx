import type { Metadata } from "next"
import Nav from "@/components/Nav"
import Footer from "@/components/Footer"

export const metadata: Metadata = {
  title: "Privacy Policy",
}

export default function PrivacyPage() {
  return (
    <>
      <Nav />
      <main className="bg-[#050914] pt-16">
        <div className="mx-auto max-w-3xl px-6 py-24">
          <p className="mb-3 font-mono text-xs uppercase tracking-widest text-sky-100/50">Legal</p>
          <h1 className="mb-2 font-accent text-5xl font-medium text-[#eaf4ff]">Privacy Policy</h1>
          <p className="mb-16 text-sm text-white/40">Last updated: May 2025</p>

          <div className="max-w-none space-y-10 text-sm leading-7 text-white/55">
            <Section title="Overview">
              <p>
                Yomi is designed to be private by default. Screenshots are sent to our LLM proxy
                only when you trigger a query — never stored, never used for training. Audio is
                transcribed via cloud STT and discarded immediately after.
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
                <li>
                  Prompt content or conversation history (unless you explicitly enable cloud memory)
                </li>
                <li>Content from blocklisted apps (password managers, banking apps)</li>
              </ul>
            </Section>

            <Section title="Data handling during queries">
              <p>
                When you trigger a query, your screenshot and transcribed voice text are sent to our
                LLM proxy to generate a response. Neither is stored after the request completes.
                Yomi never captures your screen or microphone in the background.
              </p>
            </Section>

            <Section title="Third-party services">
              <p>We use the following third-party services:</p>
              <ul>
                <li>
                  <strong className="text-label">AI Credits / OpenAI-compatible API</strong> — LLM
                  inference via our proxy. Prompts sent to these providers are subject to their
                  respective privacy policies. We do not enable training data use.
                </li>
                <li>
                  <strong className="text-label">ElevenLabs</strong> — cloud STT and TTS for voice
                  features.
                </li>
                <li>
                  <strong className="text-label">Razorpay</strong> — payment processing. We never
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
                <a href="mailto:contact.arkagarai@gmail.com" className="text-accent">
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
                effect. The latest version is always at yomi.app/privacy.
              </p>
            </Section>

            <Section title="Contact">
              <p>
                Questions? Email{" "}
                <a href="mailto:contact.arkagarai@gmail.com" className="text-accent">
                  contact.arkagarai@gmail.com
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
      <h2 className="font-accent text-2xl font-medium text-[#eaf4ff]">{title}</h2>
      <div className="space-y-3 [&_a]:text-sky-100 [&_a]:transition-colors [&_a]:hover:text-white [&_li]:relative [&_li]:pl-4 [&_li]:before:absolute [&_li]:before:left-0 [&_li]:before:text-xs [&_li]:before:text-sky-100 [&_li]:before:content-['›'] [&_strong]:font-medium [&_strong]:text-white/80 [&_ul]:list-none [&_ul]:space-y-1.5">
        {children}
      </div>
    </div>
  )
}
