import { enMessages, type EnMessages } from '@/messages/en';

/**
 * Active product UI ships strictly in English (`en`) while preserving full
 * locale/direction/Intl formatting abstractions for future multi-language expansion.
 */
export type SupportedLocale = 'en';
export type LocaleDirection = 'ltr' | 'rtl';

const RTL_LANGUAGE_CODES = new Set(['ar', 'he', 'fa', 'ur']);

export function getLocaleDirection(locale: string = 'en'): LocaleDirection {
  const baseLang = locale.split('-')[0]?.toLowerCase() ?? 'en';
  return RTL_LANGUAGE_CODES.has(baseLang) ? 'rtl' : 'ltr';
}

export function getMessages(locale: SupportedLocale = 'en'): EnMessages {
  switch (locale) {
    case 'en':
    default:
      return enMessages;
  }
}

export function useMessages(): EnMessages {
  return enMessages;
}

export function formatNumber(
  value: number | null | undefined,
  options?: Intl.NumberFormatOptions,
  fallback = 'Missing / Null',
  locale: SupportedLocale = 'en'
): string {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return fallback;
  }
  const bcp47 = locale === 'en' ? 'en-US' : locale;
  return new Intl.NumberFormat(bcp47, options).format(value);
}

export function formatDate(
  value: string | Date | null | undefined,
  options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: '2-digit' },
  fallback = 'Unspecified',
  locale: SupportedLocale = 'en'
): string {
  if (!value) return fallback;
  const dateObj = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(dateObj.getTime())) return fallback;
  const bcp47 = locale === 'en' ? 'en-US' : locale;
  return new Intl.DateTimeFormat(bcp47, options).format(dateObj);
}

export function formatPercent(
  fractionOrPct: number | null | undefined,
  decimals = 1,
  alreadyPercent = true,
  fallback = 'Missing / Null',
  locale: SupportedLocale = 'en'
): string {
  if (fractionOrPct === null || fractionOrPct === undefined || Number.isNaN(fractionOrPct)) {
    return fallback;
  }
  const value = alreadyPercent ? fractionOrPct / 100 : fractionOrPct;
  const bcp47 = locale === 'en' ? 'en-US' : locale;
  return new Intl.NumberFormat(bcp47, {
    style: 'percent',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

export function formatCoordinates([lon, lat]: [number, number]): string {
  const lonDir = lon >= 0 ? 'E' : 'W';
  const latDir = lat >= 0 ? 'N' : 'S';
  return `[${lon.toFixed(4)}° (${Math.abs(lon).toFixed(4)}°${lonDir}), ${lat.toFixed(4)}° (${Math.abs(lat).toFixed(4)}°${latDir})]`;
}
