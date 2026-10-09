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
    ]
  },
};

export default nextConfig;
