import { execSync } from "node:child_process";
import type { NextConfig } from "next";

function resolveBuildId(): string {
  const fromEnv = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA
  if (fromEnv) return fromEnv
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf8" }).trim()
  } catch {
    return "dev"
  }
}

const buildId = resolveBuildId()

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_BUILD_ID: buildId,
  },
  async redirects() {
    return [
      { source: '/login', destination: '/auth/id-entry', permanent: false },
      { source: '/about', destination: '/about.html', permanent: false },
      { source: '/features', destination: '/features.html', permanent: false },
      { source: '/pricing', destination: '/pricing.html', permanent: false },
      { source: '/contact', destination: '/contact.html', permanent: false },
      { source: '/install', destination: '/install.html', permanent: false },
      { source: '/portals', destination: '/portals.html', permanent: false },
      { source: '/download', destination: '/install.html', permanent: true },
      { source: '/download.html', destination: '/install.html', permanent: true },
      { source: '/releases', destination: '/releases.html', permanent: false },
      // Money menu (piece 1): each list has one home; old addresses keep working.
      { source: '/dashboard/finance/invoices', destination: '/dashboard/money/invoices', permanent: false },
      { source: '/dashboard/finance/invoices/:id((?!new$)[^/]+)', destination: '/dashboard/money/invoices/:id', permanent: false },
      { source: '/dashboard/supply/suppliers', destination: '/dashboard/suppliers', permanent: false },
      { source: '/dashboard/supply/suppliers/:id', destination: '/dashboard/suppliers/:id', permanent: false },
      { source: '/dashboard/money/catalogue', destination: '/dashboard/inventory', permanent: false },
      // Money Home (piece 2): the Action Centre's to-dos live on Home.
      { source: '/dashboard/money/action-centre', destination: '/dashboard/money#needs-you', permanent: false },
    ]
  },
};

export default nextConfig;
