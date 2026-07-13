import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: '/login',
        destination: '/auth/id-entry',
        permanent: false,
      },
    ]
  },
};

export default nextConfig;
