import { describe, expect, it } from 'vitest';
import { en } from './messages/en';
import { ru } from './messages/ru';
import { LOCALES } from './locale';

/**
 * Localization completeness.
 *
 * `ru` is declared `satisfies MessageDict`, so a *missing* key is already a
 * compile error. These tests cover what the type system cannot:
 *   • an extra key in one dictionary that nothing reads;
 *   • a key that exists but is empty, or was left as the English text;
 *   • a placeholder (`{name}`) that one language dropped, which silently ships a
 *     sentence with a hole in it.
 *
 * Every new feature adds strings, so this is the gate that stops a release from
 * going out half-translated.
 */

type Node = Record<string, unknown>;

function flatten(node: Node, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(node)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') out.set(path, value);
    else if (value && typeof value === 'object') {
      for (const [k, v] of flatten(value as Node, path)) out.set(k, v);
    }
  }
  return out;
}

const enFlat = flatten(en as unknown as Node);
const ruFlat = flatten(ru as unknown as Node);

/**
 * Pluralized entries are deliberately NOT key-identical across locales: English
 * needs `one`/`other`, Russian needs `one`/`few`/`many`. They get their own
 * assertion below instead of being forced into the same shape.
 */
const isPlural = (key: string) => key.startsWith('plural.');
const enKeys = [...enFlat.keys()].filter((k) => !isPlural(k)).sort();
const ruKeys = [...ruFlat.keys()].filter((k) => !isPlural(k)).sort();

/** `{placeholder}` names used by a template, sorted for comparison. */
function placeholders(template: string): string[] {
  return [...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
}

describe('locale dictionaries', () => {
  it('covers exactly the same keys in every locale', () => {
    expect(ruKeys).toEqual(enKeys);
  });

  it('provides every plural form its language actually needs', () => {
    // English selects one/other; the Russian rule selects one/few/many. A
    // missing form silently falls back and reads wrong for those counts.
    for (const category of Object.keys(en.plural)) {
      const enForms = Object.keys(en.plural[category as keyof typeof en.plural]);
      expect(enForms, `en.plural.${category}`).toEqual(expect.arrayContaining(['one', 'other']));
      const ruForms = Object.keys(ru.plural[category as keyof typeof ru.plural]);
      expect(ruForms, `ru.plural.${category}`).toEqual(
        expect.arrayContaining(['one', 'few', 'many']),
      );
    }
  });

  it('has both supported locales wired up', () => {
    expect([...LOCALES].sort()).toEqual(['en', 'ru']);
  });

  it('has no empty or whitespace-only strings', () => {
    const empty = [...enFlat, ...ruFlat].filter(([, value]) => value.trim().length === 0);
    expect(empty.map(([key]) => key)).toEqual([]);
  });

  it('uses the same placeholders in every locale', () => {
    const mismatched: string[] = [];
    for (const [key, template] of enFlat) {
      const other = ruFlat.get(key);
      if (other === undefined) continue;
      if (placeholders(template).join(',') !== placeholders(other).join(',')) {
        mismatched.push(key);
      }
    }
    expect(mismatched).toEqual([]);
  });

  it('has actually been translated, not copied', () => {
    // Some strings legitimately match across languages: a bare number/symbol
    // header, or a brand name. Everything with real words must differ.
    const ALLOWED_IDENTICAL = new Set(['daily.leaderboard.header_rank']);
    const copied = [...enFlat]
      .filter(([key, value]) => {
        if (ALLOWED_IDENTICAL.has(key)) return false;
        const other = ruFlat.get(key);
        if (other === undefined) return false;
        // Only flag strings that contain Latin letters — a template that is pure
        // punctuation/placeholder is fine to share.
        if (!/[a-z]{3}/i.test(value)) return false;
        return other === value;
      })
      .map(([key]) => key);
    expect(copied).toEqual([]);
  });

  it('has Cyrillic content wherever the English string has real words', () => {
    // Values that are purely numeric, symbolic or a brand name are fine to share;
    // anything with words in it must actually be in Russian.
    const untranslated = [...ruFlat]
      .filter(([key, value]) => {
        const source = enFlat.get(key);
        if (source === undefined || !/[a-z]{3}/i.test(source)) return false;
        return !/[Ѐ-ӿ]/.test(value);
      })
      .map(([key]) => key);
    expect(untranslated).toEqual([]);
  });
});
