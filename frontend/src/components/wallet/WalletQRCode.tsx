import React, { useEffect, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { X } from 'lucide-react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import styles from './WalletQRCode.module.css';

export interface WalletQRCodeProps {
  /** Full Stellar public key to render as QR */
  publicKey: string;
  /** Called when the user closes the modal */
  onClose: () => void;
}

/**
 * Modal that renders a scannable QR code of the full Stellar public key for
 * mobile wallet import. Traps focus while open; Escape closes it.
 */
export const WalletQRCode: React.FC<WalletQRCodeProps> = ({ publicKey, onClose }) => {
  const containerRef = useFocusTrap<HTMLDivElement>(true);
  const closeBtnRef = useRef<HTMLButtonElement>(null);

  // Move focus to close button on mount
  useEffect(() => {
    closeBtnRef.current?.focus();
  }, []);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div
      className={styles.overlay}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Wallet QR Code"
    >
      <div
        ref={containerRef}
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.header}>
          <h3 className={styles.title}>Scan Wallet Address</h3>
          <button
            ref={closeBtnRef}
            className={styles.closeBtn}
            onClick={onClose}
            aria-label="Close QR code modal"
          >
            <X size={18} />
          </button>
        </div>

        <div className={styles.qrWrapper} aria-label={`QR code for ${publicKey}`}>
          <QRCodeSVG
            value={publicKey}
            size={200}
            bgColor="transparent"
            fgColor="#f1f5f9"
            level="M"
          />
        </div>

        <p className={styles.keyLabel}>Public Key</p>
        <p className={styles.keyValue}>{publicKey}</p>
        <p className={styles.hint}>
          Scan with a Stellar-compatible mobile wallet to import this address.
        </p>
      </div>
    </div>
  );
};

export default WalletQRCode;
