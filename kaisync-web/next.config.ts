import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: '/login', destination: '/auth/id-entry', permanent: false },
    ]
  },
  async rewrites() {
    // afterFiles: only applied when no Next.js page matches the path.
    // Marketing routes (/about, /features, etc.) have no app pages, so
    // these rewrites serve the static HTML from public/. App routes like
    // /dashboard and /auth/* are handled by Next.js first and never reach
    // these rewrites.
    return [
      { source: '/',          destination: '/index.html' },
      { source: '/about',     destination: '/about.html' },
      { source: '/features',  destination: '/features.html' },
      { source: '/pricing',   destination: '/pricing.html' },
      { source: '/contact',   destination: '/contact.html' },
      { source: '/download',  destination: '/download.html' },
      { source: '/releases',  destination: '/releases.html' },
    ]
  },
};

export default nextConfig;
