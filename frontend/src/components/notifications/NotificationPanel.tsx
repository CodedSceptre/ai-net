import React, { useCallback, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCheck, ChevronRight, Inbox, Trash2 } from 'lucide-react';
import { useNotifications } from '../../hooks/useNotifications';
import NotificationItem from './NotificationItem';
import type { AppNotification, NotificationType } from '../../types/notification';
import './NotificationCenter.css';

export const NOTIFICATION_PANEL_ID = 'notification-panel';
export const NOTIFICATION_PANEL_TITLE_ID = 'notification-panel-title';
export const MAX_RECENT_NOTIFICATIONS = 5;

type NotificationCategory = 'payment' | 'task' | 'system';

const GROUP_ORDER: NotificationCategory[] = ['payment', 'task', 'system'];

const GROUP_LABELS: Record<NotificationCategory, string> = {
  payment: 'Payment',
  task: 'Task',
  system: 'System',
};

/** Maps every notification type to the category it is displayed under. */
export function getNotificationCategory(type: NotificationType): NotificationCategory {
  switch (type) {
    case 'payment_received':
    case 'payment':
      return 'payment';
    case 'task_completed':
    case 'task_failed':
    case 'task':
      return 'task';
    case 'agent_registered':
    case 'agent':
    case 'system':
    default:
      return 'system';
  }
}

interface NotificationGroup {
  category: NotificationCategory;
  label: string;
  notifications: AppNotification[];
  unreadCount: number;
}

export interface NotificationPanelProps {
  isOpen: boolean;
  onClose: () => void;
  anchorRef?: React.RefObject<HTMLElement>;
}

export const NotificationPanel: React.FC<NotificationPanelProps> = ({
  isOpen,
  onClose,
  anchorRef,
}) => {
  const { notifications, unreadCount, markAsRead, markAllAsRead, clearAll } = useNotifications();
  const panelRef = useRef<HTMLDivElement>(null);

  const handleClose = useCallback(() => {
    onClose();
    anchorRef?.current?.focus();
  }, [onClose, anchorRef]);

  useEffect(() => {
    if (!isOpen) return;

    // Move focus into the dialog so keyboard and screen-reader users land in
    // the panel as soon as it opens.
    panelRef.current?.focus();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current && !panelRef.current.contains(target)) {
        if (anchorRef?.current && anchorRef.current.contains(target)) {
          return;
        }
        handleClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, handleClose, anchorRef]);

  // Sort notifications newest first, then cap the dropdown at the most recent
  // five before grouping. The full history lives on /notifications.
  const sortedNotifications = [...notifications].sort((a, b) => {
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });
  const recentNotifications = sortedNotifications.slice(0, MAX_RECENT_NOTIFICATIONS);

  const groups: NotificationGroup[] = GROUP_ORDER.map((category) => {
    const groupNotifications = recentNotifications.filter(
      (notification) => getNotificationCategory(notification.type) === category,
    );
    return {
      category,
      label: GROUP_LABELS[category],
      notifications: groupNotifications,
      unreadCount: groupNotifications.filter((notification) => !notification.read).length,
    };
  }).filter((group) => group.notifications.length > 0);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          ref={panelRef}
          id={NOTIFICATION_PANEL_ID}
          className="notification-panel"
          initial={{ opacity: 0, y: 10, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 8, scale: 0.98 }}
          transition={{ duration: 0.15 }}
          role="dialog"
          aria-modal="true"
          aria-labelledby={NOTIFICATION_PANEL_TITLE_ID}
          tabIndex={-1}
          data-testid="notification-panel"
        >
          {/* Header */}
          <div className="notification-panel-header">
            <div className="notification-panel-title-group">
              <span className="notification-panel-title" id={NOTIFICATION_PANEL_TITLE_ID}>
                Notifications
              </span>
              {unreadCount > 0 && (
                <span className="notification-unread-count-pill" data-testid="panel-unread-badge">
                  {unreadCount} new
                </span>
              )}
            </div>

            <div className="notification-panel-actions">
              {unreadCount > 0 && (
                <button
                  type="button"
                  className="mark-all-read-btn"
                  onClick={markAllAsRead}
                  aria-label="Mark all as read"
                  data-testid="mark-all-read-btn"
                >
                  <CheckCheck size={14} />
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
                  <Trash2 size={13} />
                </button>
              )}
            </div>
          </div>

          {/* Body */}
          <div className="notification-panel-body">
            {sortedNotifications.length === 0 ? (
              <div className="notification-empty-state" data-testid="notification-empty-state">
                <div className="empty-state-icon-wrapper">
                  <Inbox size={28} className="empty-state-icon" />
                </div>
                <p className="empty-state-title">No notifications yet</p>
                <p className="empty-state-subtitle">We'll alert you when tasks update or payments settle.</p>
              </div>
            ) : (
              <div className="notification-groups" role="feed" aria-label="Notifications list">
                {groups.map((group) => (
                  <section
                    key={group.category}
                    className="notification-group"
                    aria-labelledby={`notification-group-label-${group.category}`}
                    data-testid={`notification-group-${group.category}`}
                  >
                    <div className="notification-group-header">
                      <span
                        className={`notification-group-dot ${group.category}`}
                        data-testid={`notification-group-dot-${group.category}`}
                        aria-hidden="true"
                      />
                      <span
                        className="notification-group-label"
                        id={`notification-group-label-${group.category}`}
                      >
                        {group.label}
                      </span>
                      <span
                        className="notification-group-unread"
                        data-testid={`notification-group-unread-${group.category}`}
                      >
                        <span className="notification-group-unread-count">{group.unreadCount}</span>{' '}
                        unread
                      </span>
                    </div>

                    <div className="notification-group-items">
                      <AnimatePresence initial={false}>
                        {group.notifications.map(notification => (
                          <NotificationItem
                            key={notification.id}
                            notification={notification}
                            onMarkAsRead={markAsRead}
                            onClose={handleClose}
                          />
                        ))}
                      </AnimatePresence>
                    </div>
                  </section>
                ))}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="notification-panel-footer">
            <Link
              to="/notifications"
              className="notification-view-all-link"
              onClick={handleClose}
              data-testid="view-all-notifications-link"
            >
              <span>View All</span>
              <ChevronRight size={14} aria-hidden="true" />
            </Link>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default NotificationPanel;
