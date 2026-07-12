import { Link } from 'react-router-dom';
import Icon from '../Icon.jsx';

/**
 * QuickAction — a single icon + label tile for a row of common shortcuts on a
 * role home (e.g. "New project", "Browse hub", "Invite a member").
 *
 * Renders the right element automatically:
 *  - `to`   → react-router <Link> (internal navigation)
 *  - `href` → <a> (external; opens safely in a new tab)
 *  - else   → <button> calling `onClick`
 *
 * @param {string} icon                  Icon name (from shared/icons).
 * @param {React.ReactNode} label        Action label.
 * @param {React.ReactNode} [desc]       Optional one-line description.
 * @param {string} [to]                  Internal route.
 * @param {string} [href]                External URL.
 * @param {() => void} [onClick]
 * @param {boolean} [primary]            Emphasise as the suggested action.
 * @param {boolean} [disabled]
 * @param {string} [className]
 */
export default function QuickAction({ icon, label, desc, to, href, onClick, primary = false, disabled = false, className = '' }) {
  const cls = `dash-action ${primary ? 'dash-action-primary' : ''} ${disabled ? 'dash-action-disabled' : ''} ${className}`.trim();
  const inner = (
    <>
      <span className="dash-action-ico" aria-hidden="true"><Icon name={icon} size={20} /></span>
      <span className="dash-action-text">
        <span className="dash-action-label">{label}</span>
        {desc && <span className="dash-action-desc">{desc}</span>}
      </span>
      <span className="dash-action-arrow" aria-hidden="true"><Icon name="chevron-right" size={16} /></span>
    </>
  );

  if (disabled) {
    return <span className={cls} aria-disabled="true">{inner}</span>;
  }
  if (to) {
    return <Link className={cls} to={to}>{inner}</Link>;
  }
  if (href) {
    return <a className={cls} href={href} target="_blank" rel="noopener noreferrer">{inner}</a>;
  }
  return (
    <button type="button" className={cls} onClick={onClick}>{inner}</button>
  );
}
