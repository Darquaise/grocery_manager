import { TranslateLoader, TranslationObject } from '@ngx-translate/core';
import { Observable, of } from 'rxjs';

import { de } from './de';
import { en } from './en';

/** Dictionaries are bundled with the app (no HTTP fetch), so translations are
 * available instantly and fully offline. Register new languages here. */
const DICTIONARIES: Record<string, TranslationObject> = {
  en: en as unknown as TranslationObject,
  de: de as unknown as TranslationObject,
};

export class StaticTranslateLoader implements TranslateLoader {
  getTranslation(lang: string): Observable<TranslationObject> {
    return of(DICTIONARIES[lang] ?? {});
  }
}
