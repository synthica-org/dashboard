import Icon from '../Icon.jsx';
import { Badge } from '../ui.jsx';

/**
 * DashboardHero — the header for a role home. Communicates, at a glance, *which*
 * workspace the user is in and *what it's for*, then offers the primary actions.
 *
 * @param {React.ReactNode} title              Big heading, e.g. "Lead workspace".
 * @param {React.ReactNode} [subtitle]         One line: what this workspace is for.
 * @param {string} [icon]                      Icon shown in the hero badge.
 * @param {React.ReactNode} [eyebrow]          Small label above the title.
 * @param {{ label: React.ReactNode, tone?: string }[]} [badges]
 *        Role badge(s) — e.g. the user's tags for this view.
 * @param {React.ReactNode} [actions]          Slot for primary actions (Buttons).
 * @param {React.ReactNode} [aside]            Optional right-side content (stats).
 * @param {string} [className]
 */
export default function DashboardHero({ title, subtitle, icon, eyebrow, badges = [], actions, aside, className = '' }) {
  return (
    <header className={`dash-hero ${className}`.trim()}>
      <div className="dash-hero-main">
        {icon && (
          <span className="dash-hero-ico" aria-hidden="true">
            <Icon name={icon} size={24} />
          </span>
        )}
        <div className="dash-hero-text">
          {eyebrow && <div className="dash-hero-eyebrow">{eyebrow}</div>}
          <h1 className="dash-hero-title">{title}</h1>
          {subtitle && <p className="dash-hero-sub">{subtitle}</p>}
          {badges.length > 0 && (
            <div className="dash-hero-badges">
              {badges.map((b, i) => (
                <Badge key={i} tone={b.tone || 'blue'}>{b.label}</Badge>
              ))}
            </div>
          )}
        </div>
      </div>
      {(actions || aside) && (
        <div className="dash-hero-side">
          {aside}
          {actions && <div className="dash-hero-actions">{actions}</div>}
        </div>
      )}
    </header>
  );
}
