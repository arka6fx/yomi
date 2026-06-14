import type { MetadataRoute } from "next"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/dashboard", "/device", "/link", "/api/"],
      },
      {
        // Prevent AI training crawlers from scraping
        userAgent: ["GPTBot", "Google-Extended", "CCBot", "anthropic-ai", "Claude-Web"],
        disallow: "/",
      },
    ],
    sitemap: "https://yomi.arka6fx.com/sitemap.xml",
    host: "https://yomi.arka6fx.com",
  }
}
