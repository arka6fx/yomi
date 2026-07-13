/** @type {import("next").NextConfig} */
const nextConfig = {
  output: "standalone",
  transpilePackages: ["@yomi/ui-connectors", "@yomi/shared"],
  // These routes each re-rendered a page that already existed elsewhere, so Google saw
  // duplicate content. A redirect is the strongest canonicalisation signal there is.
  async redirects() {
    return [
      { source: "/features", destination: "/#features", permanent: true },
      { source: "/pricing", destination: "/#pricing", permanent: true },
      { source: "/contact", destination: "/support", permanent: true },
    ]
  },
  async rewrites() {
    const backend = process.env.BACKEND_URL ?? "http://localhost:3001"
    return [
      {
        source: "/api/:path*",
        destination: `${backend}/api/:path*`,
      },
    ]
  },
}

export default nextConfig
