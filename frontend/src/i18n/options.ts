import type { InitOptions } from 'i18next'

// Namespaces (Issue #661)
import enCommon from './en/common.json'
import enAgents from './en/agents.json'
import enTasks from './en/tasks.json'
import enWallet from './en/wallet.json'
import enPayments from './en/payments.json'

import esCommon from './es/common.json'
import esAgents from './es/agents.json'
import esTasks from './es/tasks.json'
import esWallet from './es/wallet.json'
import esPayments from './es/payments.json'

// Legacy flat bundles for backward compatibility
import enLegacy from './locales/en.json'
import esLegacy from './locales/es.json'
import zhLegacy from './locales/zh.json'

export const SUPPORTED_LANGUAGES = ['en', 'es'] as const
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

export const NAMESPACES = ['common', 'agents', 'tasks', 'wallet', 'payments'] as const
export type Namespace = (typeof NAMESPACES)[number]

/**
 * Options shared by the browser app and the vitest setup, so tests resolve keys
 * exactly the way the browser does.
 */
export const i18nBaseOptions: InitOptions = {
  resources: {
    en: {
      common: enCommon,
      agents: enAgents,
      tasks: enTasks,
      wallet: enWallet,
      payments: enPayments,
      translation: enLegacy,
    },
    es: {
      common: esCommon,
      agents: esAgents,
      tasks: esTasks,
      wallet: esWallet,
      payments: esPayments,
      translation: esLegacy,
    },
    zh: {
      translation: zhLegacy,
    },
  },
  defaultNS: 'common',
  fallbackNS: 'translation',
  fallbackLng: 'en',
  supportedLngs: ['en', 'es', 'zh'],
  load: 'languageOnly',
  keySeparator: false,
  interpolation: {
    escapeValue: false,
  },
}
