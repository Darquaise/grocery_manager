/**
 * Registry of supported UI languages. Adding a language is a three-step change:
 *   1. add an entry here (code + native name + flag country code), and
 *   2. add a matching dictionary in `en.ts` / `de.ts` + `loader.ts`, and
 *   3. drop the matching flag SVG into `public/flags/<flag>.svg`.
 * Nothing else in the app hardcodes the language list.
 */
export interface LanguageDef {
  code: string;
  /** The language's name written in that language itself (e.g. "Deutsch"). */
  name: string;
  /** Country/region code of the flag SVG bundled under `public/flags/`. */
  flag: string;
}

export const LANGUAGES: readonly LanguageDef[] = [
  { code: 'en', name: 'English', flag: 'gb' },
  { code: 'de', name: 'Deutsch', flag: 'de' },
];

/** Base-href-relative URL of a language's flag SVG (works under any deploy path). */
export function flagUrl(def: LanguageDef): string {
  return `flags/${def.flag}.svg`;
}

/** The app starts in this language on first open (no account, nothing stored). */
export const DEFAULT_LANGUAGE = 'en';

export function isSupported(code: string | null | undefined): code is string {
  return !!code && LANGUAGES.some((l) => l.code === code);
}

/** The definition for a code, falling back to the first (default) language. */
export function languageDef(code: string): LanguageDef {
  return LANGUAGES.find((l) => l.code === code) ?? LANGUAGES[0];
}
