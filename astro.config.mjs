import { defineConfig } from "astro/config";
import node from "@astrojs/node";

export default defineConfig({
  site: "https://scharade.jp",
  output: "server",
  adapter: node({
    mode: "standalone",
    bodySizeLimit: 21 * 1024 * 1024,
  }),
  security: {
    checkOrigin: true,
    csp: {
      directives: [
        "default-src 'self'", "base-uri 'none'", "object-src 'none'", "frame-ancestors 'self'", "form-action 'self'",
        "img-src 'self' data: blob: https://*.microcms-assets.io https://maps.googleapis.com https://maps.gstatic.com https://*.googleusercontent.com https://streetviewpixels-pa.googleapis.com https://p.typekit.net",
        "font-src 'self' data: https://fonts.gstatic.com https://*.typekit.net",
        "connect-src 'self' blob: https://maps.googleapis.com https://maps.gstatic.com https://*.googleapis.com https://*.typekit.net",
        "frame-src 'self' https://www.google.com https://maps.google.com",
      ],
      scriptDirective: { resources: ["'self'", "https://use.typekit.net", "https://maps.googleapis.com", "https://maps.gstatic.com"] },
      styleDirective: { resources: ["'self'", "https://fonts.googleapis.com", "https://use.typekit.net", "https://p.typekit.net", { resource: "'unsafe-inline'", kind: "attribute" }] },
    },
    allowedDomains: [
      { protocol: "https", hostname: "scharade.jp" },
      { protocol: "https", hostname: "www.scharade.jp" },
      // Exact loopback origin for the isolated browser harness. The production
      // proxy accepts only the two site hosts and production cookies require TLS.
      { protocol: "http", hostname: "127.0.0.1", port: "4329" },
    ],
  },
});
