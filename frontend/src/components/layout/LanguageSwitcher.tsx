import React, { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Globe, Check, ChevronDown } from 'lucide-react'
import styles from './LanguageSwitcher.module.css'

interface LanguageOption {
  code: 'en' | 'es'
  label: string
}

const LANGUAGES: LanguageOption[] = [
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
]

export const LanguageSwitcher: React.FC = () => {
  const { i18n, t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([])

  const currentLang = (i18n.resolvedLanguage?.startsWith('es') ? 'es' : 'en') as 'en' | 'es'

  const handleSelect = (lang: 'en' | 'es') => {
    void i18n.changeLanguage(lang)
    try {
      localStorage.setItem('ainet_locale', lang)
    } catch {
      // Ignore localStorage write failures
    }
    setIsOpen(false)
    buttonRef.current?.focus()
  }

  // Handle click outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isOpen])

  // Sync focused index when opening
  useEffect(() => {
    if (isOpen) {
      const activeIdx = LANGUAGES.findIndex((l) => l.code === currentLang)
      const targetIdx = activeIdx >= 0 ? activeIdx : 0
      setFocusedIndex(targetIdx)
      optionRefs.current[targetIdx]?.focus()
    }
  }, [isOpen, currentLang])

  // Keyboard navigation on trigger
  const handleTriggerKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
/**
 * LanguageSwitcher component
 *
 * Standalone dropdown for switching between supported languages.
 * - Calls i18n.changeLanguage() on selection
 * - Persists to localStorage under key 'ainet_locale'
 * - Shows active language with a checkmark
 * - Keyboard accessible (Enter/Space to open, Escape to close, ArrowDown to open)
 */
import React, { useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { SUPPORTED_LANGUAGES } from '../../i18n/options'
import type { SupportedLanguage } from '../../i18n/options'

const LOCALE_STORAGE_KEY = 'ainet_locale'

/**
 * Display metadata for each supported language. Keeping names in their own
 * language is a UI convention — they are intentionally not run through t().
 */
const LANGUAGE_DISPLAY: Record<SupportedLanguage, { nativeName: string }> = {
  en: { nativeName: 'English' },
  es: { nativeName: 'Español' },
  zh: { nativeName: '中文' },
}

export const LanguageSwitcher: React.FC = () => {
  const { i18n, t } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const currentLang = (i18n.resolvedLanguage ?? 'en') as SupportedLanguage
  const currentDisplay = LANGUAGE_DISPLAY[currentLang] ?? LANGUAGE_DISPLAY.en

  const handleSelect = async (code: SupportedLanguage) => {
    await i18n.changeLanguage(code)
    localStorage.setItem(LOCALE_STORAGE_KEY, code)
    setIsOpen(false)
  }

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const handleTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsOpen(false)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      setIsOpen((prev) => !prev)
    } else if (e.key === 'ArrowDown' && !isOpen) {
      e.preventDefault()
      setIsOpen(true)
    }
  }

  // Keyboard navigation within dropdown
  const handleDropdownKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      setIsOpen(false)
      buttonRef.current?.focus()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFocusedIndex((prev) => {
        const next = (prev + 1) % LANGUAGES.length
        optionRefs.current[next]?.focus()
        return next
      })
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setFocusedIndex((prev) => {
        const next = (prev - 1 + LANGUAGES.length) % LANGUAGES.length
        optionRefs.current[next]?.focus()
        return next
      })
    } else if (e.key === 'Tab') {
  const handleOptionKeyDown = (e: React.KeyboardEvent, code: SupportedLanguage) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      void handleSelect(code)
    } else if (e.key === 'Escape') {
      setIsOpen(false)
    }
  }

  const activeLabel = LANGUAGES.find((l) => l.code === currentLang)?.label ?? 'English'

  return (
    <div className={styles.container} ref={containerRef} id="language-switcher-container">
      <button
        ref={buttonRef}
        type="button"
        id="language-switcher-trigger"
        className={styles.trigger}
        onClick={() => setIsOpen((prev) => !prev)}
        onKeyDown={handleTriggerKeyDown}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label={t('a11y.languageSwitcher', { defaultValue: 'Language switcher' })}
        data-testid="language-switcher-trigger"
      >
        <Globe size={15} className={styles.globe} aria-hidden="true" />
        <span>{activeLabel}</span>
        <ChevronDown
          size={14}
          className={`${styles.chevron} ${isOpen ? styles.chevronOpen : ''}`}
          aria-hidden="true"
        />
      </button>

      {isOpen && (
        <div
          role="menu"
          aria-label={t('a11y.languageSwitcher', { defaultValue: 'Language switcher' })}
          className={styles.dropdown}
          onKeyDown={handleDropdownKeyDown}
          data-testid="language-switcher-dropdown"
        >
          {LANGUAGES.map((lang, index) => {
            const isSelected = lang.code === currentLang
            return (
              <button
                key={lang.code}
                ref={(el) => {
                  optionRefs.current[index] = el
                }}
                type="button"
                role="menuitemradio"
                aria-checked={isSelected}
                tabIndex={focusedIndex === index ? 0 : -1}
                className={`${styles.option} ${isSelected ? styles.optionActive : ''} ${
                  focusedIndex === index ? styles.optionFocused : ''
                }`}
                onClick={() => handleSelect(lang.code)}
                data-testid={`language-option-${lang.code}`}
              >
                <span>{lang.label}</span>
                {isSelected && <Check size={14} className={styles.check} aria-hidden="true" />}
              </button>
            )
          })}
        </div>
  return (
    <div
      ref={containerRef}
      style={{ position: 'relative', display: 'inline-block' }}
      data-testid="language-switcher"
    >
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        onKeyDown={handleTriggerKeyDown}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={t('a11y.languageSwitcher') + ': ' + currentDisplay.nativeName}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.25rem',
          padding: '0.25rem 0.5rem',
          background: 'transparent',
          border: '1px solid currentColor',
          borderRadius: '0.25rem',
          cursor: 'pointer',
          fontSize: '0.875rem',
          color: 'inherit',
        }}
      >
        <span>{currentDisplay.nativeName}</span>
        <span aria-hidden="true">{isOpen ? '▲' : '▼'}</span>
      </button>

      {isOpen && (
        <ul
          role="listbox"
          aria-label={t('a11y.languageSwitcher')}
          style={{
            position: 'absolute',
            top: '100%',
            right: 0,
            marginTop: '0.25rem',
            padding: '0.25rem 0',
            background: 'var(--panel-bg, #1e293b)',
            border: '1px solid var(--panel-border, #334155)',
            borderRadius: '0.5rem',
            listStyle: 'none',
            minWidth: '8rem',
            zIndex: 1000,
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
          }}
        >
          {SUPPORTED_LANGUAGES.map((code) => {
            const option = LANGUAGE_DISPLAY[code]
            const isActive = code === currentLang
            return (
              <li
                key={code}
                role="option"
                aria-selected={isActive}
                tabIndex={0}
                onClick={() => void handleSelect(code)}
                onKeyDown={(e) => handleOptionKeyDown(e, code)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '0.5rem 1rem',
                  cursor: 'pointer',
                  fontSize: '0.875rem',
                  fontWeight: isActive ? 600 : 400,
                  color: 'inherit',
                }}
              >
                <span>{option.nativeName}</span>
                {isActive && <span aria-hidden="true">✓</span>}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export default LanguageSwitcher
