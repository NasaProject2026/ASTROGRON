import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  distDir: process.env.ASTRAGRON_NEXT_DIST_DIR || '.next',
  reactStrictMode: true,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
