import React, { useState } from 'react'
import { useWallet } from '../../context/WalletContext'
import styles from './WalletConnectModal.module.css'

export interface WalletConnectModalProps {
  isOpen: boolean
  onClose: () => void
}

/** Returns true when the current browser appears to be a mobile device. */
function isMobileDevice(): boolean {
  return /Mobi|Android/i.test(navigator.userAgent)
}

/** Truncates a Stellar public key to first 8 + "..." + last 8 characters. */
function truncateKey(key: string): string {
  if (key.length <= 20) return key
  return `${key.slice(0, 8)}...${key.slice(-8)}`
}

const WalletConnectModal: React.FC<WalletConnectModalProps> = ({ isOpen, onClose }) => {
  const { publicKey, connected, freighterAvailable, connectFreighter, disconnect } = useWallet()

  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  if (!isOpen) return null

  const mobile = isMobileDevice()

  const handleConnectFreighter = async () => {
    setError(null)
    setConnecting(true)
    try {
      await connectFreighter()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect Freighter.')
    } finally {
      setConnecting(false)
    }
  }

  const handleCopy = async () => {
    if (!publicKey) return
    try {
      await navigator.clipboard.writeText(publicKey)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Could not copy to clipboard.')
    }
  }

  const handleDisconnect = () => {
    disconnect()
    onClose()
  }

  const handleRetry = () => {
    setError(null)
    handleConnectFreighter()
  }

  const freighterDeepLink = `freighter://connect?origin=${encodeURIComponent(window.location.origin)}`

  return (
    <div className={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="wcm-title">
      <div className={styles.modal}>
        {/* Header */}
        <div className={styles.header}>
          <h2 className={styles.title} id="wcm-title">
            {connected ? 'Wallet Connected' : 'Connect Wallet'}
          </h2>
          <button className={styles.closeButton} onClick={onClose} aria-label="Close modal">
            {/* ✕ icon */}
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <path
                d="M14 4L4 14M4 4l10 10"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        <div className={styles.body}>
          {/* ── CONNECTED STATE ── */}
          {connected && publicKey && (
            <>
              <p className={styles.description}>Your wallet is connected via Freighter.</p>

              <div className={styles.publicKeyRow}>
                <code className={styles.publicKeyText}>{truncateKey(publicKey)}</code>
                <button
                  className={styles.iconButton}
                  onClick={handleCopy}
                  aria-label="Copy public key"
                  title={copied ? 'Copied!' : 'Copy public key'}
                >
                  {copied ? (
                    /* Checkmark */
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <path
                        d="M3 8l3.5 3.5L13 5"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : (
                    /* Copy icon */
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <rect x="5" y="5" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="1.5" />
                      <path
                        d="M3 11V3h8"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </button>
              </div>

              <hr className={styles.divider} />

              <button className={styles.dangerButton} onClick={handleDisconnect}>
                Disconnect
              </button>
            </>
          )}

          {/* ── NOT CONNECTED ── */}
          {!connected && (
            <>
              {/* Error state */}
              {error && (
                <div className={styles.errorMessage} role="alert">
                  <span>{error}</span>
                  <button className={styles.secondaryButton} onClick={handleRetry}>
                    Retry
                  </button>
                </div>
              )}

              {/* Mobile deep link */}
              {mobile && !error && (
                <>
                  <p className={styles.description}>
                    Open the Freighter mobile app to connect your wallet.
                  </p>
                  <a
                    href={freighterDeepLink}
                    className={styles.deepLinkButton}
                    aria-label="Open Freighter app"
                  >
                    Open Freighter App
                  </a>
                  <hr className={styles.divider} />
                </>
              )}

              {/* Extension not installed */}
              {!mobile && !freighterAvailable && !error && (
                <>
                  <p className={styles.description}>
                    The Freighter browser extension is required to connect. Install it and reload the
                    page.
                  </p>
                  <a
                    href="https://freighter.app"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.primaryButton}
                    aria-label="Install Freighter extension"
                  >
                    Install Freighter
                  </a>
                </>
              )}

              {/* Extension available, not yet connected */}
              {!mobile && freighterAvailable && !error && (
                <>
                  <p className={styles.description}>
                    Click below to connect your Freighter wallet.
                  </p>
                  <button
                    className={styles.primaryButton}
                    onClick={handleConnectFreighter}
                    disabled={connecting}
                    aria-label="Connect with Freighter"
                  >
                    {connecting && <span className={styles.spinner} role="status" aria-label="Connecting" />}
                    {connecting ? 'Connecting…' : 'Connect Freighter'}
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default WalletConnectModal
