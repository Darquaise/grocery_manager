import { Injectable } from '@angular/core';
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

/** `@Injectable` so AOT emits a real factory: ngx-translate's
 * `provideTranslateLoader` sniffs classes via `/^class\s/` on `toString()`,
 * which the production minifier breaks (`var x = class{…}`) — the loader is
 * therefore provided explicitly (app.config.ts), never via that heuristic. */
@Injectable()
export class StaticTranslateLoader implements TranslateLoader {
  getTranslation(lang: string): Observable<TranslationObject> {
    return of(DICTIONARIES[lang] ?? {});
  }
}
