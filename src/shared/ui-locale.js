/**
 * Locale primitives shared by every Binance userscript. They live apart from the
 * orderbook copy map so a change to that map never alters the other bundles.
 */
export const UI_LOCALE_ZH_CN = 'zh-CN';
export const UI_LOCALE_EN = 'en';

export const SUPPORTED_UI_LOCALES = Object.freeze([
  UI_LOCALE_ZH_CN,
  UI_LOCALE_EN,
]);

export function localizedText(zhCN, en) {
  if (typeof zhCN !== 'string' || zhCN === '' || typeof en !== 'string' || en === '') {
    throw new Error('Localized UI text requires non-empty Chinese and English values');
  }
  return Object.freeze({ zhCN, en });
}

export function isLocalizedText(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && typeof value.zhCN === 'string'
    && typeof value.en === 'string',
  );
}

export function formatLocalizedText(value, locale) {
  if (typeof value === 'string') return value;
  if (!isLocalizedText(value)) throw new Error('Invalid localized UI text');
  if (locale === UI_LOCALE_ZH_CN) return value.zhCN;
  if (locale === UI_LOCALE_EN) return value.en;
  throw new Error(`Unsupported UI locale: ${locale}`);
}

export function combineLocalizedText(parts, separator = '') {
  if (!Array.isArray(parts) || typeof separator !== 'string') {
    throw new Error('Invalid localized UI text composition');
  }
  return localizedText(
    parts.map((part) => formatLocalizedText(part, UI_LOCALE_ZH_CN)).join(separator),
    parts.map((part) => formatLocalizedText(part, UI_LOCALE_EN)).join(separator),
  );
}

export function resolveUiLocaleFromPathname(pathname) {
  const firstSegment = String(pathname || '').split(/[?#]/, 1)[0].split('/').filter(Boolean)[0];
  return firstSegment?.toLowerCase() === 'zh-cn' ? UI_LOCALE_ZH_CN : UI_LOCALE_EN;
}
