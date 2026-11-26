import React, { useState, useRef } from 'react';
import { Bell } from 'lucide-react';
import { useNotifications } from '../../hooks/useNotifications';
import NotificationPanel, { NOTIFICATION_PANEL_ID } from './NotificationPanel';
import './NotificationCenter.css';

interface NotificationBellProps {
  className?: string;
}

export const NotificationBell: React.FC<NotificationBellProps> = ({ className = '' }) => {
  const { unreadCount } = useNotifications();
  const [isOpen, setIsOpen] = useState(false);
  const bellButtonRef = useRef<HTMLButtonElement>(null);

  return (
    <div className={`notification-wrapper ${className}`}>
      <button
        ref={bellButtonRef}
        data-modal-backdrop
        type="button"
        className={`notification-bell-btn ${isOpen ? 'active' : ''}`}
        onClick={() => setIsOpen(prev => !prev)}
        aria-label={`Notifications, ${unreadCount} unread`}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-controls={isOpen ? NOTIFICATION_PANEL_ID : undefined}
        id="btn-notifications"
        data-testid="notification-bell-btn"
      >
        <Bell size={20} aria-hidden="true" />
        <span className="sr-only" aria-live="polite">{unreadCount} unread notifications</span>
        {unreadCount > 0 && (
          <span className="notification-badge" data-testid="notification-badge" aria-hidden="true">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      <NotificationPanel
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        anchorRef={bellButtonRef}
      />
    </div>
  );
};

export default NotificationBell;
