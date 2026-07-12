import { useRef } from 'react';
import Icon from '../Icon.jsx';

/**
 * Tabs — accessible tabbed navigation (WAI-ARIA tablist pattern).
 *
 * Controlled component: the parent owns the active id. Supports full keyboard
 * navigation — Left/Right (or Up/Down) move between tabs, Home/End jump to the
 * ends, and roving tabindex keeps focus management correct.
 *
 * Render the matching panel yourself based on `value`; this renders only the
 * tab strip (keeping it flexible for any panel layout).
 *
 * @param {{ id: string, label: React.ReactNode, icon?: string, count?: number }[]} tabs
 * @param {string} value                         Active tab id.
 * @param {(id: string) => void} onChange
 * @param {string} [ariaLabel='Views']           Accessible name for the tablist.
 * @param {string} [className]
 */
export default function Tabs({ tabs = [], value, onChange, ariaLabel = 'Views', className = '' }) {
  const refs = useRef([]);

  const move = (from, dir) => {
    if (!tabs.length) return;
    let i = from;
    do {
      i = (i + dir + tabs.length) % tabs.length;
    } while (tabs[i]?.disabled && i !== from);
    const next = tabs[i];
    if (next) {
      onChange(next.id);
      refs.current[i]?.focus();
    }
  };

  const onKeyDown = (e, idx) => {
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault();
        move(idx, 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault();
        move(idx, -1);
        break;
      case 'Home':
        e.preventDefault();
        move(-1, 1);
        break;
      case 'End':
        e.preventDefault();
        move(0, -1);
        break;
      default:
        break;
    }
  };

  return (
    <div className={`dash-tabs ${className}`.trim()} role="tablist" aria-label={ariaLabel}>
      {tabs.map((t, idx) => {
        const active = t.id === value;
        return (
          <button
            key={t.id}
            ref={(el) => { refs.current[idx] = el; }}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={active}
            aria-controls={`panel-${t.id}`}
            tabIndex={active ? 0 : -1}
            disabled={t.disabled}
            className={`dash-tab ${active ? 'dash-tab-active' : ''}`.trim()}
            onClick={() => onChange(t.id)}
            onKeyDown={(e) => onKeyDown(e, idx)}
          >
            {t.icon && <Icon name={t.icon} size={16} />}
            <span className="dash-tab-label">{t.label}</span>
            {typeof t.count === 'number' && <span className="dash-tab-count">{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
