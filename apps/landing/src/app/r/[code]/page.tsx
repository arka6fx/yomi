import { redirect } from "next/navigation"

// worker.ts now serves /r/<code> directly (see the referralMatch check there) since
// this app deploys as a Cloudflare Worker with no live Next.js server at runtime —
// a dynamic segment with no generateStaticParams has no prebuilt asset and 404s in
// production. This page only exists for `next dev` parity.
export default async function ReferralRedirectPage({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const { code } = await params
  redirect(`/signup?ref=${encodeURIComponent(code)}`)
}
