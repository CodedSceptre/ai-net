import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'

import { i18nBaseOptions } from './options'

export { SUPPORTED_LANGUAGES, NAMESPACES } from './options'
export type { SupportedLanguage, Namespace } from './options'

/**
 * Keeps `<html lang>` in sync with the active language, for accessibility and SEO.
 */
const syncDocumentLanguage = () => {
  document.documentElement.lang = i18n.resolvedLanguage ?? 'en'
}

i18n.on('languageChanged', (lng) => {
  syncDocumentLanguage()
  try {
    localStorage.setItem('ainet_locale', lng)
  } catch {
    // Ignore storage errors in restricted contexts
  }
})

/**
 * Resolves once i18next is initialized.
 *
 * Configured with:
 * - Two primary locales: en (default) and es
 * - Namespace structure: common, agents, tasks, wallet, payments
 * - Language detection order: localStorage > browser language > fallback to en
 * - Persisted under key 'ainet_locale'
 */
export const i18nReady = i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    ...i18nBaseOptions,
    detection: {
      order: ['localStorage', 'navigator'],
      caches: ['localStorage'],
      lookupLocalStorage: 'ainet_locale',
    },
  })
  .then((t) => {
    syncDocumentLanguage()
    return t
  })

export default i18n
