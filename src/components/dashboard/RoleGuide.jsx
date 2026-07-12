import { Link } from 'react-router-dom';
import Icon from '../Icon.jsx';

/**
 * RoleGuide — a compact "what you can do here" explainer so every role
 * dashboard is self-describing. Lists capabilities with icons and (optionally)
 * a link per item. This is the component that makes each workspace obvious at a
 * glance — show it near the top of a role home, especially for new users.
 *
 * Item shape: { icon, title, desc?, to?, href? }.
 *
 * @param {React.ReactNode} [title='What you can do here']
 * @param {React.ReactNode} [intro]    Optional lead-in sentence.
 * @param {{ icon: string, title: React.ReactNode, desc?: React.ReactNode,
 *           to?: string, href?: string }[]} items
 * @param {boolean} [dismissible]      Render a dismiss button (caller handles).
 * @param {() => void} [onDismiss]
 * @param {string} [className]
 */
export default function RoleGuide({ title = 'What you can do here', intro, items = [], dismissible = false, onDismiss, className = '' }) {
  if (!items.length) return null;
  return (
    <div className={`dash-guide ${className}`.trim()}>
      <div className="dash-guide-head">
        <span className="dash-guide-spark" aria-hidden="true"><Icon name="sparkles" size={16} /></span>
        <div className="dash-guide-headings">
          <h3 className="dash-guide-title">{title}</h3>
          {intro && <p className="dash-guide-intro">{intro}</p>}
        </div>
        {dismissible && (
          <button type="button" className="dash-guide-dismiss" onClick={onDismiss} aria-label="Dismiss guide">
            <Icon name="x" size={16} />
          </button>
        )}
      </div>
      <ul className="dash-guide-list">
        {items.map((it, i) => {
          const body = (
            <>
              <span className="dash-guide-ico" aria-hidden="true"><Icon name={it.icon} size={18} /></span>
              <span className="dash-guide-text">
                <span className="dash-guide-item-title">{it.title}</span>
                {it.desc && <span className="dash-guide-item-desc">{it.desc}</span>}
              </span>
              {(it.to || it.href) && <span className="dash-guide-arrow" aria-hidden="true"><Icon name="arrow-right" size={15} /></span>}
            </>
          );
          if (it.to) {
            return <li key={i}><Link className="dash-guide-item dash-guide-item-link" to={it.to}>{body}</Link></li>;
          }
          if (it.href) {
            return <li key={i}><a className="dash-guide-item dash-guide-item-link" href={it.href} target="_blank" rel="noopener noreferrer">{body}</a></li>;
          }
          return <li key={i}><div className="dash-guide-item">{body}</div></li>;
        })}
      </ul>
    </div>
  );
}
