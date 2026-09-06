import { localizedText, formatLocalizedText, resolveUiLocaleFromPathname } from '../../binance-orderbook-trade/contracts/panel-copy.js';

export { resolveUiLocaleFromPathname };

export function createStrategy27Translator(locale) {
  formatLocalizedText(localizedText('中文', 'English'), locale);
  return (zhCN, en) => formatLocalizedText(localizedText(zhCN, en), locale);
}

/** Retain both presentations so changing language never requires gateway replay. */
export function createLocalizedAnnotation(build, locale) {
  const localizedCopy = Object.freeze({ 'zh-CN': build('zh-CN'), en: build('en') });
  return localizeAnnotation({ localizedCopy }, locale);
}

export function localizeAnnotation(annotation, locale) {
  createStrategy27Translator(locale);
  return Object.freeze({ ...annotation.localizedCopy[locale], localizedCopy: annotation.localizedCopy });
}
