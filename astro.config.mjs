// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: "https://www.hamiltonrock.com",
  output: "static",
  // Webflow's URLs have no trailing slash: /banking, not /banking/
  trailingSlash: "never",
  build: { format: "file" },
  integrations: [sitemap()],
  // Reached through dev-proxy's Traefik (a container), so listen beyond loopback and
  // accept the *.hrock.test names. strictPort: fail loudly rather than drift off 4321.
  server: { host: true, port: 4321, allowedHosts: [".hrock.test"] },
  vite: { server: { strictPort: true } },
  devToolbar: { enabled: false },
});
