import ModalFocusTrap from '../common/ModalFocusTrap';
import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link } from 'react-router-dom';
import { CheckCheck, Inbox, Trash2, X } from 'lucide-react';
import { useNotifications } from '../../hooks/useNotifications';
import NotificationItem from './NotificationItem';
import type { NotificationType } from '../../types/notification';
import './NotificationCenter.css';

export const NOTIFICATION_PANEL_ID = 'notification-panel';
export const NOTIFICATION_PANEL_TITLE_ID = 'notification-panel-title';
export const MAX_RECENT_NOTIFICATIONS = 5;

type NotificationCategory = 'payment' | 'task' | 'system';
const categories = { payment: 'Payment', task: 'Task', system: 'System' } as const;

/** Maps every notification type to the category it is displayed under. */
export function getNotificationCategory(type: NotificationType): NotificationCategory {
  switch (type) {
    case 'payment_received':
    case 'payment_failed':
    case 'payment_locked':
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

export interface NotificationPanelProps {
  isOpen: boolean;
  onClose: () => void;
  anchorRef?: React.RefObject<HTMLElement>;
}

export type NotificationFilterTab = 'all' | 'payments' | 'tasks' | 'system';

export const NotificationPanel: React.FC<NotificationPanelProps> = ({
  isOpen,
  onClose,
  anchorRef,
}) => {
  const { notifications, unreadCount, markAsRead, markAllAsRead, clearAll } = useNotifications();
  const [activeTab, setActiveTab] = useState<NotificationFilterTab>('all');
  const panelRef = useRef<HTMLDivElement>(null);

  const handleClose = useCallback(() => {
    onClose();
    anchorRef?.current?.focus();
  }, [onClose, anchorRef]);

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

  const recent = useMemo(() => [...notifications]
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
    .slice(0, MAX_RECENT_NOTIFICATIONS), [notifications]);

  const groups = (Object.keys(categories) as NotificationCategory[])
    .filter(category => activeTab === 'all' || activeTab ===
      (category === 'system' ? 'system' : `${category}s`))
    .map(category => ({
      category,
      items: recent.filter(item => getNotificationCategory(item.type) === category),
    }))
    .filter(({ items }) => items.length > 0);

  const filterTabs: { id: NotificationFilterTab; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'payments', label: 'Payments' },
    { id: 'tasks', label: 'Tasks' },
    { id: 'system', label: 'System' },
  ];

  const hasAnyItems = groups.length > 0;

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Mobile slide-over backdrop */}
          <motion.div
            data-modal-backdrop className="notification-panel-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            aria-hidden="true"
          />

          <ModalFocusTrap>
            <motion.div
              ref={panelRef}
              className="notification-panel slide-over"
              initial={{ opacity: 0, x: 20, y: 0 }}
              animate={{ opacity: 1, x: 0, y: 0 }}
              exit={{ opacity: 0, x: 20, y: 0 }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              role="dialog"
              id={NOTIFICATION_PANEL_ID}
              aria-modal="true"
              aria-labelledby={NOTIFICATION_PANEL_TITLE_ID}
              data-testid="notification-panel"
            >
              {/* Header */}
              <div className="notification-panel-header">
                <div className="notification-panel-title-group">
                  <span className="notification-panel-title" id={NOTIFICATION_PANEL_TITLE_ID}>Notifications</span>
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
                  <button
                    type="button"
                    className="notification-close-btn"
                    onClick={onClose}
                    aria-label="Close notifications panel"
                    title="Close"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>

              {/* Filter Tabs */}
              <div className="notification-tabs-bar" role="group" aria-label="Filter notifications">
                {filterTabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    aria-pressed={activeTab === tab.id}
                    className={`notification-tab-btn ${activeTab === tab.id ? 'active' : ''}`}
                    onClick={() => setActiveTab(tab.id)}
                    data-testid={`notification-tab-${tab.id}`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Body */}
              <div className="notification-panel-body">
                {!hasAnyItems ? (
                  <div className="notification-empty-state" data-testid="notification-empty-state">
                    <div className="empty-state-icon-wrapper">
                      <Inbox size={28} className="empty-state-icon" />
                    </div>
                    <p className="empty-state-title">No notifications yet</p>
                    <p className="empty-state-subtitle">We'll alert you when tasks update or payments settle.</p>
                  </div>
                ) : (
                  <div className="notification-groups-container">
                    {groups.map(({ category, items }) => (
                      <section
                        key={category}
                        className="notification-group"
                        aria-label={categories[category]}
                        data-testid={`notification-group-${category}`}
                      >
                        <div className="notification-group-header">
                          <span aria-hidden="true" className={`notification-group-dot ${category}`}
                            data-testid={`notification-group-dot-${category}`} />
                          <span className="notification-group-title">{categories[category]}</span>
                          <span className="notification-group-badge" data-testid={`notification-group-unread-${category}`}>
                            {items.filter(item => !item.read).length} unread
                          </span>
                        </div>
                        <div className="notification-list">
                          {items.map(notification => (
                            <NotificationItem
                              key={notification.id}
                              notification={notification}
                              onMarkAsRead={markAsRead}
                              onClose={handleClose}
                            />
                          ))}
                        </div>
                      </section>
                    ))}
                  </div>
                )}
              </div>
              <Link className="notification-view-all" to="/notifications" onClick={handleClose}
                data-testid="view-all-notifications-link">
                View all notifications
              </Link>
            </motion.div>
          </ModalFocusTrap>
        </>
      )}
    </AnimatePresence>
  );
};

export default NotificationPanel;
