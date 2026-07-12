import DashboardHero from './DashboardHero.jsx';
import RoleGuide from './RoleGuide.jsx';
import StatCard from './StatCard.jsx';
import QuickAction from './QuickAction.jsx';

/**
 * RoleHome — the standard composition for a role dashboard landing page. It
 * stitches together the pieces every workspace should have, in a consistent
 * order, so all roles feel like one product:
 *
 *   1. DashboardHero   — who/what/why + primary actions
 *   2. RoleGuide       — "what you can do here" (optional, great for new users)
 *   3. Stats grid      — headline metrics (optional)
 *   4. Quick actions   — common shortcuts (optional)
 *   5. children        — the role-specific sections (use <Section/>)
 *
 * Everything except `hero` is optional; pass only what a given role needs.
 *
 * @param {object} hero                          Props for <DashboardHero/>.
 * @param {object} [guide]                       Props for <RoleGuide/>.
 * @param {object[]} [stats]                     Array of <StatCard/> props.
 * @param {object[]} [quickActions]             Array of <QuickAction/> props.
 * @param {React.ReactNode} [quickActionsTitle='Quick actions']
 * @param {React.ReactNode} children            Role-specific sections.
 * @param {string} [className]
 */
export default function RoleHome({ hero, guide, stats, quickActions, quickActionsTitle = 'Quick actions', children, className = '' }) {
  return (
    <div className={`dash-home ${className}`.trim()}>
      {hero && <DashboardHero {...hero} />}

      {guide && guide.items?.length > 0 && <RoleGuide {...guide} />}

      {stats && stats.length > 0 && (
        <div className="dash-stat-grid">
          {stats.map((s, i) => <StatCard key={s.id ?? i} {...s} />)}
        </div>
      )}

      {quickActions && quickActions.length > 0 && (
        <section className="dash-section dash-quick">
          <div className="dash-section-head">
            <div className="dash-section-headings">
              <h2 className="dash-section-title">{quickActionsTitle}</h2>
            </div>
          </div>
          <div className="dash-action-grid">
            {quickActions.map((a, i) => <QuickAction key={a.id ?? i} {...a} />)}
          </div>
        </section>
      )}

      {children}
    </div>
  );
}
