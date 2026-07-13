import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: '/login', destination: '/auth/id-entry', permanent: false },
    ]
  },
  async rewrites() {
    return {
      // beforeFiles: runs before Next.js page routing, so these static HTML
      // files take priority over the app-router page at '/'
      beforeFiles: [
        { source: '/',          destination: '/index.html' },
        { source: '/about',     destination: '/about.html' },
        { source: '/features',  destination: '/features.html' },
        { source: '/pricing',   destination: '/pricing.html' },
        { source: '/contact',   destination: '/contact.html' },
        { source: '/download',  destination: '/download.html' },
        { source: '/releases',  destination: '/releases.html' },
      ],
      afterFiles: [],
      fallback: [],
    }
  },
};

export default nextConfig;
