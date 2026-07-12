import Icon from '../Icon.jsx';

/**
 * StatCard — a single headline metric for a role dashboard.
 *
 * Pure presentation: pass already-computed numbers. Renders a label, a large
 * value, an optional icon, an optional sub-line, and an optional trend chip.
 *
 * @param {React.ReactNode} label              Metric name, e.g. "Open listings".
 * @param {React.ReactNode} value              The number/figure to feature.
 * @param {string} [icon]                       Icon name (from shared/icons).
 * @param {React.ReactNode} [sub]               Muted line under the value.
 * @param {{ dir?: 'up'|'down'|'flat', label: React.ReactNode }} [trend]
 *        Optional trend indicator; `dir` colours the chip (up=positive).
 * @param {boolean} [hot]                       Use the gold "highlight" variant.
 * @param {string} [to]                         If set, the whole card is a link
 *                                              (caller wraps with router Link).
 * @param {() => void} [onClick]
 * @param {string} [className]
 */
export default function StatCard({ label, value, icon, sub, trend, hot = false, onClick, className = '' }) {
  const interactive = typeof onClick === 'function';
  const trendIcon = trend?.dir === 'down' ? 'trending-up' : 'trending-up';
  return (
    <div
      className={`dash-stat ${hot ? 'dash-stat-hot' : ''} ${interactive ? 'dash-stat-link' : ''} ${className}`.trim()}
      onClick={onClick}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onKeyDown={interactive ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } } : undefined}
    >
      <div className="dash-stat-top">
        <span className="dash-stat-label">{label}</span>
        {icon && <span className="dash-stat-ico" aria-hidden="true"><Icon name={icon} size={18} /></span>}
      </div>
      <div className="dash-stat-value">{value}</div>
      {(sub || trend) && (
        <div className="dash-stat-foot">
          {trend && (
            <span className={`dash-stat-trend dash-stat-trend-${trend.dir || 'flat'}`}>
              <Icon name={trendIcon} size={12} className={trend.dir === 'down' ? 'dash-trend-down' : ''} />
              {trend.label}
            </span>
          )}
          {sub && <span className="dash-stat-sub">{sub}</span>}
        </div>
      )}
    </div>
  );
}
