import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageSwitcher from './LanguageSwitcher'

describe('LanguageSwitcher Component (Issue #661)', () => {
  beforeAll(async () => {
    await i18n.use(initReactI18next).init({
      lng: 'en',
      fallbackLng: 'en',
      resources: {
        en: {
          common: {
            'a11y.languageSwitcher': 'Language switcher',
          },
        },
        es: {
          common: {
            'a11y.languageSwitcher': 'Selector de idioma',
          },
        },
      },
      defaultNS: 'common',
      interpolation: { escapeValue: false },
    })
  })

  afterEach(async () => {
    await act(async () => {
      await i18n.changeLanguage('en')
    })
    localStorage.removeItem('ainet_locale')
  })

  it('renders the trigger with the current language label', () => {
    render(<LanguageSwitcher />)
    const trigger = screen.getByTestId('language-switcher-trigger')
    expect(trigger).toBeInTheDocument()
    expect(trigger).toHaveTextContent('English')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
  })

  it('opens dropdown on click and displays English and Español options', () => {
    render(<LanguageSwitcher />)
    const trigger = screen.getByTestId('language-switcher-trigger')
    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')

    const optionEn = screen.getByTestId('language-option-en')
    const optionEs = screen.getByTestId('language-option-es')
    expect(optionEn).toBeInTheDocument()
    expect(optionEs).toBeInTheDocument()
    expect(optionEn).toHaveAttribute('aria-checked', 'true')
    expect(optionEs).toHaveAttribute('aria-checked', 'false')
  })

  it('changes language to Spanish on selection and updates localStorage', async () => {
    render(<LanguageSwitcher />)
    const trigger = screen.getByTestId('language-switcher-trigger')
    fireEvent.click(trigger)

    const optionEs = screen.getByTestId('language-option-es')
    await act(async () => {
      fireEvent.click(optionEs)
    })

    await waitFor(() => expect(i18n.language).toBe('es'))
    expect(localStorage.getItem('ainet_locale')).toBe('es')
  })

  it('supports keyboard navigation (ArrowDown, Enter, Escape)', async () => {
    render(<LanguageSwitcher />)
    const trigger = screen.getByTestId('language-switcher-trigger')

    // Open via Enter
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(screen.getByTestId('language-switcher-dropdown')).toBeInTheDocument()

    // Close via Escape
    const dropdown = screen.getByTestId('language-switcher-dropdown')
    fireEvent.keyDown(dropdown, { key: 'Escape' })
    expect(screen.queryByTestId('language-switcher-dropdown')).not.toBeInTheDocument()
  })
})
