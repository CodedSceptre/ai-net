import ModalFocusTrap from '../common/ModalFocusTrap';
import { forwardRef } from 'react'
import { useTranslation } from 'react-i18next'
import { motion, PanInfo } from 'framer-motion'
import { NAV_GROUPS, NAV_ITEMS, isNavItemActive } from './navigation'
import { backdrop } from '../../utils/animationPresets'
import './MobileDrawer.css'

export { NAV_ITEMS }

interface MobileDrawerProps {
  onClose: () => void
  currentPath: string
  onNavigate: (path: string) => void
}

/**
 * Slide-over navigation for viewports below the desktop breakpoint.
 *
 * Enters from the left edge, mirroring where the sidebar sits on desktop, so
 * the same navigation appears in the same place at every width. Drag it left
 * (or flick) to dismiss.
 */
const MobileDrawer = forwardRef<HTMLDivElement, MobileDrawerProps>(
  ({ onClose, currentPath, onNavigate }, ref) => {
    const { t } = useTranslation()
    // Dragging toward the edge the drawer came from dismisses it.
    const handleDragEnd = (_: unknown, info: PanInfo) => {
      if (info.offset.x < -80 || info.velocity.x < -500) {
        onClose()
      }
    }

    return (
      <>
        <motion.div
          data-modal-backdrop className="drawer-backdrop"
          variants={backdrop}
          initial="hidden"
          animate="visible"
          exit="exit"
          onClick={onClose}
          aria-hidden="true"
        />
        <ModalFocusTrap>
          <motion.div
            ref={ref}
            className="mobile-drawer trap-focus"
            initial={{ x: '-100%' }}
            animate={{ x: 0 }}
            exit={{ x: '-100%' }}
            transition={{ type: 'spring', damping: 32, stiffness: 420 }}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.2}
            onDragEnd={handleDragEnd}
            role="dialog"
            aria-modal="true"
            aria-label={t('a11y.mobileNavigationMenu')}
          >
            <div className="drawer-header">
              <h2>{t('nav.navigation')}</h2>
              <button
                className="close-btn"
                onClick={onClose}
                aria-label={t('a11y.closeNavigationMenu')}
              >
                ✕
              </button>
            </div>

            <nav className="drawer-nav" aria-label={t('a11y.mobileNavigationMenu')}>
              {NAV_GROUPS.map((group) => (
                <div className="nav-group" key={group.id}>
                  <h3 className="nav-group-label" id={`drawer-group-${group.id}`}>
                    {t(group.labelKey)}
                  </h3>
                  <ul aria-labelledby={`drawer-group-${group.id}`}>
                    {group.items.map((item) => {
                      const isActive = isNavItemActive(currentPath, item.path)
                      const Icon = item.icon
                      return (
                        <li key={item.path}>
                          <button
                            className={`nav-item ${isActive ? 'active' : ''}`}
                            onClick={() => onNavigate(item.path)}
                            aria-current={isActive ? 'page' : undefined}
                          >
                            <span className="nav-icon">
                              <Icon size={20} />
                            </span>
                            <span className="nav-label">{t(item.labelKey)}</span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </nav>

            <div className="drawer-drag-handle" aria-hidden="true" />
          </motion.div>
        </ModalFocusTrap>
      </>
    )
  },
)

MobileDrawer.displayName = 'MobileDrawer'

export default MobileDrawer
