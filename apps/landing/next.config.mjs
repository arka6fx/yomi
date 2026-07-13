/** @type {import("next").NextConfig} */
const nextConfig = {
  output: "standalone",
  transpilePackages: ["@yomi/ui-connectors", "@yomi/shared"],
  // /features and /pricing used to render the whole landing page — three URLs, one
  // page. Google treats that as duplicate content, so they are now anchors.
  async redirects() {
    return [
      { source: "/features", destination: "/#features", permanent: true },
      { source: "/pricing", destination: "/#pricing", permanent: true },
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
