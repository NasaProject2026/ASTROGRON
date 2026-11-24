export const PUBLIC_BASE_PATH = (process.env.NEXT_PUBLIC_BASE_PATH || '').replace(/\/+$/, '');

export const IS_STATIC_SHOWCASE = process.env.NEXT_PUBLIC_STATIC_SHOWCASE === '1';

/**
 * Prefixes public/ asset URLs with Next's static deployment basePath (e.g. '/ASTROGRON'
 * on GitHub Pages) while leaving absolute http(s) URLs untouched.
 */
export function withBasePath(assetPath: string): string {
  if (!assetPath) return PUBLIC_BASE_PATH || '/';
  if (/^https?:\/\//i.test(assetPath)) return assetPath;
  const normalized = assetPath.startsWith('/') ? assetPath : `/${assetPath}`;
  return PUBLIC_BASE_PATH ? `${PUBLIC_BASE_PATH}${normalized}` : normalized;
}
