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
      )}
    </div>
  )
}

export default LanguageSwitcher
