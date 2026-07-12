import Icon from '../Icon.jsx';

/**
 * Section — a titled content block used to structure a role dashboard.
 *
 * Provides a consistent header (optional eyebrow badge, title, description, and
 * a right-aligned action slot) above arbitrary children. Use it instead of
 * hand-rolling `.section-head` markup so every page lines up.
 *
 * @param {React.ReactNode} [eyebrow]      Small uppercase label above the title.
 * @param {React.ReactNode} [title]        Section heading.
 * @param {string} [icon]                  Optional icon shown before the title.
 * @param {React.ReactNode} [description]  Muted line under the title.
 * @param {React.ReactNode} [action]       Right-aligned slot (e.g. a Button).
 * @param {React.ReactNode} children       Section body.
 * @param {string} [className]
 * @param {object} [bodyProps]             Forwarded to the body wrapper.
 */
export default function Section({ eyebrow, title, icon, description, action, children, className = '', bodyProps }) {
  const hasHeader = eyebrow || title || description || action;
  return (
    <section className={`dash-section ${className}`.trim()}>
      {hasHeader && (
        <div className="dash-section-head">
          <div className="dash-section-headings">
            {eyebrow && <div className="section-badge dash-section-eyebrow">{eyebrow}</div>}
            {title && (
              <h2 className="dash-section-title">
                {icon && <Icon name={icon} size={20} className="dash-section-title-ico" />}
                {title}
              </h2>
            )}
            {description && <p className="dash-section-desc">{description}</p>}
          </div>
          {action && <div className="dash-section-action">{action}</div>}
        </div>
      )}
      <div className="dash-section-body" {...bodyProps}>{children}</div>
    </section>
  );
}
