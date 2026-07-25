import type { Locale } from './locale';
import { DEFAULT_LOCALE } from './locale';
import { en } from './messages/en';
import type { MessageDict } from './messages/en';
import { ru } from './messages/ru';

const DICTS: Record<Locale, MessageDict> = { en, ru };

// ── Typed dot-path keys, derived from the English dictionary's shape ───────
type PathsOf<T> = T extends string
  ? []
  : { [K in Extract<keyof T, string>]: [K, ...PathsOf<T[K]>] }[Extract<keyof T, string>];
type Join<T extends readonly string[]> = T extends readonly [infer F extends string, ...infer R extends string[]]
  ? R extends readonly [] ? F : `${F}.${Join<R>}`
  : never;

export type TranslationKey = Join<PathsOf<Omit<MessageDict, 'plural'>>>;
export type PluralKey = keyof MessageDict['plural'];

type PluralForm = 'one' | 'few' | 'many' | 'other';

function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((node, key) => {
    if (node && typeof node === 'object' && key in node) {
      return (node as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match,
  );
}

/** Translate a key for `locale`, falling back to English then to the raw key. */
export function t(locale: Locale, key: TranslationKey, params?: Record<string, string | number>): string {
  const primary = getPath(DICTS[locale] ?? DICTS[DEFAULT_LOCALE], key);
  const value = typeof primary === 'string' ? primary : getPath(DICTS[DEFAULT_LOCALE], key);
  if (typeof value !== 'string') return key;
  return interpolate(value, params);
}

function pluralFormEn(n: number): PluralForm {
  return n === 1 ? 'one' : 'other';
}

/** Standard Russian plural rule (one/few/many by the last one/two digits). */
function pluralFormRu(n: number): PluralForm {
  const abs = Math.abs(n);
  const mod10 = abs % 10;
  const mod100 = abs % 100;
  if (mod10 === 1 && mod100 !== 11) return 'one';
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return 'few';
  return 'many';
}

/** Translate a pluralized key (see messages/*.ts `plural` section) for `count`. */
export function tPlural(locale: Locale, key: PluralKey, count: number): string {
  const dict = DICTS[locale] ?? DICTS[DEFAULT_LOCALE];
  const forms = dict.plural[key];
  const form = locale === 'ru' ? pluralFormRu(count) : pluralFormEn(count);
  const template = forms[form] ?? forms.other ?? forms.many ?? forms.one ?? '{count}';
  return interpolate(template, { count });
}
