import type { NextConfig } from 'next';

const isPagesExport = process.env.GITHUB_PAGES_EXPORT === '1';
const basePath = (process.env.NEXT_PUBLIC_BASE_PATH || '').replace(/\/+$/, '');

const nextConfig: NextConfig = {
  ...(isPagesExport ? {} : { distDir: process.env.ASTRAGRON_NEXT_DIST_DIR || '.next' }),
  reactStrictMode: true,
  images: {
    unoptimized: true,
  },
  ...(isPagesExport
    ? {
        output: 'export' as const,
        trailingSlash: true,
        ...(basePath ? { basePath } : {}),
      }
    : {}),
};

export default nextConfig;
