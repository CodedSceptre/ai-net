import React, { useEffect, useState } from 'react';
import { Bell, CheckCheck, Trash2, Inbox } from 'lucide-react';
import { AnimatePresence } from 'framer-motion';
import { useNotifications } from '../hooks/useNotifications';
import NotificationItem from '../components/notifications/NotificationItem';
import { notificationService } from '../services/notificationService';
import { useWallet } from '../hooks/useWallet';
import '../components/notifications/NotificationCenter.css';

/**
 * Full-page notifications center.
 *
 * Shows the notification list, unread count badge, mark-all-read and
 * clear-all actions, and the push permission prompt banner (shown once
 * per wallet session if the user has not yet decided).
 */
const NotificationsPage: React.FC = () => {
  const {
    notifications,
    unreadCount,
    markAsRead,
    markAllRead,
    clearAll,
    isLoading,
  } = useNotifications();

  const { publicKey } = useWallet();

  // Push permission prompt banner state
  const [showPermissionBanner, setShowPermissionBanner] = useState(false);

  useEffect(() => {
    if (!publicKey) return;
    setShowPermissionBanner(notificationService.shouldShowPermissionPrompt(publicKey));
  }, [publicKey]);

  const handleEnablePush = async () => {
    const permission = await notificationService.requestPermission();
    if (permission === 'granted') {
      await notificationService.registerServiceWorker();
    }
    // Hide banner regardless of outcome — user has made a decision
    if (publicKey) {
      notificationService.dismissPermissionPrompt(publicKey);
    }
    setShowPermissionBanner(false);
  };

  const handleDismissBanner = () => {
    if (publicKey) {
      notificationService.dismissPermissionPrompt(publicKey);
    }
    setShowPermissionBanner(false);
  };

  // Sort notifications newest first
  const sortedNotifications = [...notifications].sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  return (
    <div className="notifications-page" data-testid="notifications-page">
      {/* Push permission banner */}
      {showPermissionBanner && (
        <div
          className="push-permission-banner"
          role="alert"
          data-testid="push-permission-banner"
        >
          <div className="push-permission-banner-content">
            <Bell size={18} className="push-permission-banner-icon" />
            <span>
              Enable browser notifications to get real-time alerts for task
              completions, payments, and agent events — even when this tab is in
              the background.
            </span>
          </div>
          <div className="push-permission-banner-actions">
            <button
              type="button"
              className="push-permission-enable-btn"
              onClick={handleEnablePush}
              data-testid="enable-push-btn"
            >
              Enable notifications
            </button>
            <button
              type="button"
              className="push-permission-dismiss-btn"
              onClick={handleDismissBanner}
              aria-label="Dismiss notification prompt"
              data-testid="dismiss-push-btn"
            >
              Not now
            </button>
          </div>
        </div>
      )}

      {/* Page header */}
      <div className="notifications-page-header">
        <div className="notifications-page-title-group">
          <h1 className="notifications-page-title">
            Notifications
            {unreadCount > 0 && (
              <span
                className="notification-unread-count-pill"
                data-testid="page-unread-badge"
              >
                {unreadCount} new
              </span>
            )}
          </h1>
          {isLoading && (
            <span className="notifications-loading-indicator" aria-live="polite">
              Refreshing…
            </span>
          )}
        </div>

        <div className="notifications-page-actions">
          {unreadCount > 0 && (
            <button
              type="button"
              className="mark-all-read-btn"
              onClick={markAllRead}
              aria-label="Mark all notifications as read"
              data-testid="mark-all-read-btn"
            >
              <CheckCheck size={15} />
              <span>Mark all as read</span>
            </button>
          )}
          {notifications.length > 0 && (
            <button
              type="button"
              className="clear-all-btn"
              onClick={clearAll}
              aria-label="Clear all notifications"
              title="Clear all"
              data-testid="clear-all-btn"
            >
              <Trash2 size={14} />
              <span>Clear all</span>
            </button>
          )}
        </div>
      </div>

      {/* Notification list */}
      <div
        className="notifications-page-body"
        role="feed"
        aria-label="Notifications"
        aria-busy={isLoading}
      >
        {sortedNotifications.length === 0 && !isLoading ? (
          <div
            className="notification-empty-state"
            data-testid="notifications-empty-state"
          >
            <div className="empty-state-icon-wrapper">
              <Inbox size={36} className="empty-state-icon" />
            </div>
            <p className="empty-state-title">No notifications yet</p>
            <p className="empty-state-subtitle">
              We'll alert you when tasks update, payments settle, or agents go
              offline.
            </p>
          </div>
        ) : (
          <div className="notification-list">
            <AnimatePresence initial={false}>
              {sortedNotifications.map((notification) => (
                <NotificationItem
                  key={notification.id}
                  notification={notification}
                  onMarkAsRead={markAsRead}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
};

export default NotificationsPage;
