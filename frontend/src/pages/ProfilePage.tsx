import React, { useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { QRCodeSVG } from 'qrcode.react';
import { User, LogOut } from 'lucide-react';
import { useWallet } from '../hooks/useWallet';
import { useTheme } from '../hooks/useTheme';
import { useProfile } from '../hooks/useProfile';
import { useToast } from '../hooks/useToast';
import { CopyButton } from '../components/common/CopyButton';
import { ConfirmDialog } from '../components/common/ConfirmDialog';
import { WalletQRCode } from '../components/wallet/WalletQRCode';
import { Skeleton, SkeletonText } from '../components/common/Skeleton';
import styles from './ProfilePage.module.css';

// ── helpers ──────────────────────────────────────────────────────────────────

function truncateAddress(addr: string): string {
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-6)}`;
}

function statusBadgeClass(status: string): string {
  if (status === 'completed') return styles.badgeCompleted;
  if (status === 'running') return styles.badgeRunning;
  if (status === 'failed') return styles.badgeFailed;
  return styles.badgePending;
}

// ── Toggle switch ─────────────────────────────────────────────────────────────

interface ToggleSwitchProps {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  sub?: string;
  disabled?: boolean;
}

const ToggleSwitch: React.FC<ToggleSwitchProps> = ({
  id,
  checked,
  onChange,
  label,
  sub,
  disabled,
}) => (
  <div className={styles.toggleRow}>
    <label htmlFor={id} className={styles.toggleLabel}>
      {label}
      {sub && <span className={styles.toggleSub}>{sub}</span>}
    </label>
    <span className={styles.toggle}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
        aria-label={label}
      />
      <span className={styles.toggleTrack} />
    </span>
  </div>
);

// ── ProfilePage ──────────────────────────────────────────────────────────────

const ProfilePage: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { address, connected, disconnect } = useWallet();
  const { mode, setMode } = useTheme();
  const { showToast } = useToast();

  const { stats, notificationPrefs, loadingStats, savingPrefs, updateNotificationPref } =
    useProfile(address ?? null);

  const [showQR, setShowQR] = useState(false);
  const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);

  // Redirect if wallet not connected
  React.useEffect(() => {
    if (!connected) navigate('/wallet', { replace: true });
  }, [connected, navigate]);

  const handleDisconnect = useCallback(() => {
    disconnect();
    showToast('Wallet disconnected', 'info');
    navigate('/wallet', { replace: true });
  }, [disconnect, navigate, showToast]);

  if (!address) return null;

  const truncated = truncateAddress(address);

  // Mock recent tasks pulled from localStorage optimistic cache
  const recentTasks: Array<{ taskId: string; prompt: string; status: string }> = [];
  try {
    const raw = localStorage.getItem('pending_tasks');
    if (raw) {
      const parsed = JSON.parse(raw) as Array<{ taskId: string; prompt: string; status: string }>;
      recentTasks.push(...parsed.slice(0, 5));
    }
  } catch {
    // ignore
  }

  return (
    <main className={styles.page} data-testid="profile-page">
      {/* ── Header ── */}
      <div className={styles.header}>
        <User size={22} aria-hidden="true" />
        <h1 className={styles.pageTitle}>{t('nav.profile', 'Profile')}</h1>
      </div>

      {/* ── Wallet address card ── */}
      <section className={styles.panel} aria-label="Wallet address">
        <p className={styles.sectionTitle}>Wallet</p>
        <div className={styles.addressCard}>
          {/* QR thumb — click to open full modal */}
          <button
            className={styles.qrThumb}
            onClick={() => setShowQR(true)}
            aria-label="Open QR code modal"
            type="button"
          >
            <QRCodeSVG
              value={address}
              size={56}
              bgColor="transparent"
              fgColor="#f1f5f9"
              level="M"
            />
          </button>

          <div className={styles.addressInfo}>
            <span className={styles.addressLabel}>Public Key</span>
            <div className={styles.addressRow}>
              <span className={styles.addressText}>{truncated}</span>
              <CopyButton text={address} label="Copy" iconSize={14} />
            </div>
            {stats && (
              <>
                <span className={styles.ageMeta}>
                  Account age: {stats.accountAgeDays} days
                </span>
                <span className={styles.tasksMeta}>
                  {stats.totalTasksSubmitted} tasks submitted
                </span>
              </>
            )}
          </div>
        </div>
      </section>

      {/* ── Stats grid ── */}
      <section className={styles.panel} aria-label="Stats">
        <p className={styles.sectionTitle}>Stats</p>
        {loadingStats ? (
          <SkeletonText lines={2} />
        ) : (
          <div className={styles.statsGrid}>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>XLM Spent</span>
              <span className={styles.statValue}>
                {stats ? stats.totalXLMSpent.toFixed(2) : '—'}
              </span>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>Success Rate</span>
              <span className={styles.statValue}>
                {stats ? `${stats.successRate.toFixed(0)}%` : '—'}
              </span>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>Avg Cost</span>
              <span className={styles.statValue}>
                {stats ? `${stats.averageTaskCostXLM.toFixed(2)} XLM` : '—'}
              </span>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statLabel}>Top Agent</span>
              <span className={styles.statValue}>
                {stats?.favoriteCapability ?? '—'}
              </span>
            </div>
          </div>
        )}
      </section>

      {/* ── Recent tasks ── */}
      <section className={styles.panel} aria-label="Recent tasks">
        <p className={styles.sectionTitle}>Recent Tasks</p>
        {loadingStats ? (
          <SkeletonText lines={3} />
        ) : recentTasks.length > 0 ? (
          <ul className={styles.taskList} role="list">
            {recentTasks.map((t) => (
              <li key={t.taskId} className={styles.taskItem}>
                <span className={styles.taskPrompt} title={t.prompt}>
                  {t.prompt}
                </span>
                <span className={`${styles.taskBadge} ${statusBadgeClass(t.status)}`}>
                  {t.status}
                </span>
                <Link
                  to={`/tasks/${t.taskId}`}
                  className={styles.taskLink}
                  aria-label={`View task ${t.taskId}`}
                >
                  View →
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)' }}>
            No recent tasks.{' '}
            <Link to="/tasks/new" style={{ color: 'var(--accent)' }}>
              Submit one
            </Link>
          </p>
        )}
        <Link
          to="/tasks"
          style={{
            display: 'inline-block',
            marginTop: '0.75rem',
            fontSize: '0.8125rem',
            color: 'var(--accent)',
            textDecoration: 'none',
          }}
        >
          View all tasks →
        </Link>
      </section>

      {/* ── Notification preferences ── */}
      <section className={styles.panel} aria-label="Notification preferences">
        <p className={styles.sectionTitle}>Notifications</p>
        <div className={styles.toggleList}>
          <ToggleSwitch
            id="notif-task-completed"
            checked={notificationPrefs.task_completed}
            onChange={(v) => updateNotificationPref('task_completed', v)}
            label="Task completed"
            sub="Notify when a task finishes successfully"
            disabled={savingPrefs}
          />
          <ToggleSwitch
            id="notif-payment-received"
            checked={notificationPrefs.payment_received}
            onChange={(v) => updateNotificationPref('payment_received', v)}
            label="Payment received"
            sub="Notify when XLM is credited to your wallet"
            disabled={savingPrefs}
          />
          <ToggleSwitch
            id="notif-agent-failed"
            checked={notificationPrefs.agent_failed}
            onChange={(v) => updateNotificationPref('agent_failed', v)}
            label="Agent failed"
            sub="Notify when a DAG node encounters an error"
            disabled={savingPrefs}
          />
        </div>
      </section>

      {/* ── App preferences ── */}
      <section className={styles.panel} aria-label="App preferences">
        <p className={styles.sectionTitle}>Preferences</p>
        <div className={styles.toggleList}>
          {/* Theme */}
          <div className={styles.toggleRow}>
            <label htmlFor="pref-theme" className={styles.toggleLabel}>
              Theme
            </label>
            <select
              id="pref-theme"
              className={styles.prefSelect}
              value={mode}
              onChange={(e) => setMode(e.target.value as 'light' | 'dark' | 'system')}
              aria-label="Theme preference"
            >
              <option value="system">System</option>
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </div>

          {/* Language */}
          <div className={styles.toggleRow}>
            <label htmlFor="pref-language" className={styles.toggleLabel}>
              Language
            </label>
            <select
              id="pref-language"
              className={styles.prefSelect}
              value={i18n.language}
              onChange={(e) => i18n.changeLanguage(e.target.value)}
              aria-label="Language preference"
            >
              <option value="en">English</option>
              <option value="zh">中文</option>
              <option value="es">Español</option>
            </select>
          </div>
        </div>
      </section>

      {/* ── Danger zone ── */}
      <section className={`${styles.panel} ${styles.dangerZone}`} aria-label="Danger zone">
        <p className={`${styles.sectionTitle} ${styles.dangerTitle}`}>Danger Zone</p>
        <button
          className={styles.disconnectBtn}
          onClick={() => setShowDisconnectConfirm(true)}
          type="button"
        >
          <LogOut size={15} aria-hidden="true" />
          Disconnect Wallet
        </button>
      </section>

      {/* ── Modals ── */}
      {showQR && (
        <WalletQRCode publicKey={address} onClose={() => setShowQR(false)} />
      )}

      {showDisconnectConfirm && (
        <ConfirmDialog
          open={showDisconnectConfirm}
          title="Disconnect Wallet"
          description="You are about to disconnect your Stellar wallet from ai-net."
          consequence="Any pending task payments will be cancelled and cannot be recovered."
          confirmLabel="Disconnect"
          cancelLabel="Keep Connected"
          onConfirm={handleDisconnect}
          onCancel={() => setShowDisconnectConfirm(false)}
        />
      )}
    </main>
  );
};

export default ProfilePage;
