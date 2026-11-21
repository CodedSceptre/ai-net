import React from 'react'
import { useTranslation } from 'react-i18next'
import { motion } from 'framer-motion'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { NAV_GROUPS, isNavItemActive } from './navigation'
import './Sidebar.css'

interface SidebarProps {
  collapsed: boolean
  currentPath: string
  onNavigate: (path: string) => void
  onToggle: () => void
  walletAddress?: string | null
}

const Sidebar: React.FC<SidebarProps> = ({ collapsed, currentPath, onNavigate, onToggle, walletAddress }) => {
  const { t } = useTranslation()

  const handleKeyDown = (e: React.KeyboardEvent, path: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onNavigate(path)
    }
  }

  return (
    <aside
      className={`sidebar ${collapsed ? 'collapsed' : ''}`}
      aria-label={t('a11y.sidebar')}
    >
      <div className="sidebar-header">
        <button
          className="sidebar-toggle-btn"
          onClick={onToggle}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>

      <nav className="sidebar-nav" role="navigation" aria-label={t('a11y.mainNavigation')}>
        {NAV_GROUPS.map((group) => (
          <div className="nav-group" key={group.id}>
            {/*
              The heading is hidden from sight when collapsed but kept in the
              accessibility tree, so screen-reader users keep the grouping that
              sighted users lose to the narrow rail.
            */}
            <h2
              className={`nav-group-label ${collapsed ? 'visually-hidden' : ''}`}
              id={`nav-group-${group.id}`}
            >
              {t(group.labelKey)}
            </h2>
            <ul aria-labelledby={`nav-group-${group.id}`}>
              {group.items.map((item) => {
                const isActive = isNavItemActive(currentPath, item.path)
                const label = t(item.labelKey)
                const Icon = item.icon
                return (
                  <li key={item.path}>
                    <button
                      className={`nav-item ${isActive ? 'active' : ''}`}
                      onClick={() => onNavigate(item.path)}
                      onKeyDown={(e) => handleKeyDown(e, item.path)}
                      aria-current={isActive ? 'page' : undefined}
                      title={collapsed ? label : undefined}
                    >
                      {/*
                        `layoutId` makes the active pill slide between items
                        instead of blinking out and back in. It is shared across
                        every button, so framer-motion animates the one element
                        from its old position to its new one.
                      */}
                      {isActive && (
                        <motion.span
                          className="nav-item-indicator"
                          layoutId="sidebar-active-indicator"
                          transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                          aria-hidden="true"
                        />
                      )}
                      <span className="nav-icon">
                        <Icon size={18} />
                      </span>
                      <span className={`nav-label ${collapsed ? 'visually-hidden' : ''}`}>
                        {label}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>

      {walletAddress && (
        <div className="sidebar-user" title={collapsed ? walletAddress : undefined}>
          <div className="sidebar-user-avatar" aria-hidden="true">
            {walletAddress.slice(0, 2)}
          </div>
          {!collapsed && (
            <div className="sidebar-user-info">
              <span className="sidebar-user-address">
                {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)}
              </span>
              <span className="sidebar-user-label">Connected</span>
            </div>
          )}
        </div>
      )}
    </aside>
  )
}

export default Sidebar
