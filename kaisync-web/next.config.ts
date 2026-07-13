import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      { source: '/login',     destination: '/auth/id-entry', permanent: false },
      { source: '/about',     destination: '/about.html',    permanent: false },
      { source: '/features',  destination: '/features.html', permanent: false },
      { source: '/pricing',   destination: '/pricing.html',  permanent: false },
      { source: '/contact',   destination: '/contact.html',  permanent: false },
      { source: '/download',  destination: '/download.html', permanent: false },
      { source: '/releases',  destination: '/releases.html', permanent: false },
    ]
  },
};

export default nextConfig;
