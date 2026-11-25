/**
 * Push notification service
 *
 * Manages browser push permission state, service worker registration,
 * and per-wallet dismissal persistence for the permission prompt banner.
 */

const PUSH_PROMPT_DISMISSED_KEY = (walletAddress: string) =>
  `push_prompt_dismissed_${walletAddress}`;

export const notificationService = {
  /**
   * Returns true when the browser supports Push Notifications API.
   */
  isPushSupported(): boolean {
    return (
      typeof window !== 'undefined' &&
      'Notification' in window &&
      'serviceWorker' in navigator &&
      'PushManager' in window
    );
  },

  /**
   * Returns the current notification permission state,
   * or 'unsupported' if the browser doesn't support it.
   */
  getPermissionState(): NotificationPermission | 'unsupported' {
    if (!this.isPushSupported()) return 'unsupported';
    return Notification.permission;
  },

  /**
   * Requests push notification permission from the user.
   * Returns the resulting permission state.
   */
  async requestPermission(): Promise<NotificationPermission> {
    if (!this.isPushSupported()) return 'denied';
    return Notification.requestPermission();
  },

  /**
   * Registers the service worker at /sw.js.
   * Returns the registration on success, or null on failure.
   */
  async registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
    if (!('serviceWorker' in navigator)) return null;
    try {
      const registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/',
      });
      return registration;
    } catch (err) {
      console.error('[notificationService] Service worker registration failed:', err);
      return null;
    }
  },

  /**
   * Returns true if the permission prompt should be shown for the given wallet.
   * Will return false if:
   * - The browser doesn't support push
   * - Permission has already been granted or denied
   * - The user has dismissed the prompt for this wallet session
   */
  shouldShowPermissionPrompt(walletAddress: string): boolean {
    if (!this.isPushSupported()) return false;
    const permission = Notification.permission;
    if (permission === 'granted' || permission === 'denied') return false;
    const dismissed = localStorage.getItem(PUSH_PROMPT_DISMISSED_KEY(walletAddress));
    return !dismissed;
  },

  /**
   * Records that the user dismissed the push permission prompt for this wallet.
   * Prevents the prompt from appearing again for this wallet session.
   */
  dismissPermissionPrompt(walletAddress: string): void {
    try {
      localStorage.setItem(PUSH_PROMPT_DISMISSED_KEY(walletAddress), 'true');
    } catch {
      // localStorage unavailable — ignore
    }
  },

  /**
   * Shows a local browser notification if permission is granted.
   */
  showLocalNotification(title: string, options?: NotificationOptions): void {
    if (!this.isPushSupported()) return;
    if (Notification.permission !== 'granted') return;
    try {
      new Notification(title, options);
    } catch (err) {
      console.error('[notificationService] Failed to show notification:', err);
    }
  },
};

export default notificationService;
