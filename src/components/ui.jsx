// Small set of brand-styled UI primitives shared across both dashboards.
//
// Backward-compatibility contract: every export below keeps the exact call
// signature that existing pages rely on (Card/Badge/Button/SectionTitle/
// EmptyState/Field/Modal/IconLabel/Pfp). New optional props and new exports
// (Spinner/Loading/Skeleton/ErrorState/Stat) are additive — existing usage is
// untouched.
import { useEffect, useState } from 'react';
import Icon from './Icon.jsx';

/**
 * Card — the standard white surface used everywhere in the dashboards.
 * @param {React.ReactNode} children
 * @param {string} [className]  Extra classes (e.g. "paper-card").
 * @param {object} [rest]       Forwarded to the root <div> (style, onClick, …).
 */
export function Card({ children, className = '', ...rest }) {
  return (
    <div className={`card ${className}`.trim()} {...rest}>
      {children}
    </div>
  );
}

/**
 * Badge — small status pill.
 * @param {React.ReactNode} children
 * @param {'blue'|'gold'|'green'|'red'|'gray'} [tone='blue']
 * @param {object} [rest]  Forwarded to the <span> (title, etc.).
 */
export function Badge({ children, tone = 'blue', className = '', ...rest }) {
  return <span className={`badge badge-${tone} ${className}`.trim()} {...rest}>{children}</span>;
}

/**
 * Button — brand button. Renders a <button> (default) or, when `as="a"`/`href`
 * is given, an <a> styled identically so links and buttons match.
 * @param {React.ReactNode} children
 * @param {'primary'|'secondary'|'ghost'|'approve'|'reject'} [variant='primary']
 * @param {string} [size='']     Pass 'btn-sm' for the compact size.
 * @param {string} [icon]        Optional leading icon name (from shared/icons).
 * @param {'button'|'a'} [as]    Element to render; inferred as 'a' when href set.
 * @param {object} [rest]        Forwarded (onClick, type, disabled, href, …).
 */
export function Button({ children, variant = 'primary', size = '', icon, as, ...rest }) {
  // btn is always present; variant + size + caller className compose on top.
  const classes = [
    'btn',
    `btn-${variant}`,
    size,
    rest.className || '',
  ].filter(Boolean).join(' ');
  // Strip className from rest so it isn't also applied as a raw attribute.
  const { className: _unused, ...restProps } = rest;
  const Tag = as || (restProps.href ? 'a' : 'button');
  const body = (
    <>
      {icon && <Icon name={icon} size={size === 'btn-sm' ? 14 : 16} />}
      {children}
    </>
  );
  return (
    <Tag className={classes} {...restProps}>
      {body}
    </Tag>
  );
}

/**
 * SectionTitle — eyebrow badge + heading, optionally with a highlighted suffix.
 * @param {React.ReactNode} [badge]      Small eyebrow label above the title.
 * @param {React.ReactNode} children     Heading text.
 * @param {React.ReactNode} [highlight]  Gold-accented trailing word.
 */
export function SectionTitle({ badge, children, highlight }) {
  return (
    <div className="section-head">
      {badge && <div className="section-badge">{badge}</div>}
      <h2 className="section-title">
        {children} {highlight && <span className="yellow-text">{highlight}</span>}
      </h2>
    </div>
  );
}

/**
 * EmptyState — friendly placeholder for "nothing here yet".
 * Backward compatible: `<EmptyState>text</EmptyState>` still works. When `icon`,
 * `title`, or `action` are provided it renders the richer centered layout.
 * @param {React.ReactNode} children     Body / description.
 * @param {string} [icon]                Icon name to show above the title.
 * @param {React.ReactNode} [title]      Bold headline.
 * @param {React.ReactNode} [action]     Slot for a primary action (e.g. Button).
 */
export function EmptyState({ children, icon, title, action }) {
  const rich = icon || title || action;
  if (!rich) return <div className="empty-state">{children}</div>;
  return (
    <div className="empty-state empty-state-rich">
      {icon && (
        <span className="empty-state-ico" aria-hidden="true">
          <Icon name={icon} size={26} />
        </span>
      )}
      {title && <h3 className="empty-state-title">{title}</h3>}
      {children && <p className="empty-state-body">{children}</p>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}

/**
 * Field — labelled form control wrapper.
 * Backward compatible: `<Field label="x"><input/></Field>` is unchanged. The
 * optional `hint` and `error` render helper / validation text below the input.
 * @param {React.ReactNode} label
 * @param {React.ReactNode} children     The control (input/select/textarea).
 * @param {React.ReactNode} [hint]       Muted helper text.
 * @param {React.ReactNode} [error]      Error message (also tints the row).
 */
export function Field({ label, children, hint, error }) {
  return (
    <label className={`field ${error ? 'field-invalid' : ''}`.trim()}>
      <span className="field-label">{label}</span>
      {children}
      {error ? (
        <span className="field-error">{error}</span>
      ) : hint ? (
        <span className="field-hint">{hint}</span>
      ) : null}
    </label>
  );
}

/**
 * Modal — centered dialog. Closes on overlay click and Escape, traps the
 * page from scrolling while open, and labels itself for assistive tech.
 * @param {React.ReactNode} title
 * @param {() => void} onClose
 * @param {React.ReactNode} children
 * @param {boolean} [wide]   Use the wider max-width variant.
 */
export function Modal({ title, onClose, children, wide }) {
  // Close on Escape and lock body scroll while the dialog is mounted.
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className={`modal ${wide ? 'modal-wide' : ''}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3>{title}</h3>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

/**
 * IconLabel — inline icon followed by text, vertically aligned.
 * @param {string} icon            Icon name (from shared/icons).
 * @param {React.ReactNode} children
 * @param {number} [size=16]
 * @param {string} [className]
 */
export function IconLabel({ icon, children, size = 16, className = '' }) {
  return (
    <span className={`icon-label ${className}`.trim()}>
      <Icon name={icon} size={size} />
      {children}
    </span>
  );
}

/**
 * Pfp — profile picture with graceful fallback: broken/missing URLs show
 * initials on the brand gradient instead of a broken-image icon.
 * @param {string} [name]
 * @param {string} [url]
 * @param {'xs'|'lg'} [size]
 */
export function Pfp({ name, url, size }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [url]);
  const initials = String(name || '?').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('') || '?';
  const cls = `pfp ${size === 'lg' ? 'pfp-lg' : size === 'xs' ? 'pfp-xs' : ''}`.trim();
  return (
    <span className={cls}>
      {url && !broken ? <img src={url} alt={name || ''} onError={() => setBroken(true)} /> : initials}
    </span>
  );
}

/**
 * Spinner — small inline brand spinner. Use inside buttons or beside text.
 * @param {number} [size=18]
 * @param {string} [className]
 * @param {string} [label]   Accessible label; when set the spinner is a status.
 */
export function Spinner({ size = 18, className = '', label }) {
  return (
    <span
      className={`ui-spinner ${className}`.trim()}
      style={{ width: size, height: size }}
      role={label ? 'status' : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : true}
    />
  );
}

/**
 * Loading — centered loading state with a spinner and message. Drop-in for the
 * "fetching…" phase of any panel or page section.
 * @param {React.ReactNode} [children='Loading…']  Message to show.
 * @param {boolean} [inline]  Compact, left-aligned row instead of a tall block.
 */
export function Loading({ children = 'Loading…', inline = false }) {
  return (
    <div className={`ui-loading ${inline ? 'ui-loading-inline' : ''}`.trim()} role="status" aria-live="polite">
      <Spinner size={inline ? 16 : 26} />
      <span className="ui-loading-label">{children}</span>
    </div>
  );
}

/**
 * Skeleton — shimmering placeholder block for content that's still loading.
 * @param {number|string} [width='100%']
 * @param {number|string} [height=16]
 * @param {number} [radius=8]
 * @param {string} [className]
 * @param {object} [style]
 */
export function Skeleton({ width = '100%', height = 16, radius = 8, className = '', style }) {
  return (
    <span
      className={`skeleton ui-skeleton ${className}`.trim()}
      aria-hidden="true"
      style={{ width, height, borderRadius: radius, ...style }}
    />
  );
}

/**
 * ErrorState — inline, non-fatal error with an optional retry action. Use when
 * a fetch fails but the rest of the page is fine.
 * @param {React.ReactNode} [title='Something went wrong']
 * @param {React.ReactNode} [children]   Detail / description.
 * @param {() => void} [onRetry]         Shows a "Try again" button when set.
 * @param {string} [retryLabel='Try again']
 */
export function ErrorState({ title = 'Something went wrong', children, onRetry, retryLabel = 'Try again' }) {
  return (
    <div className="ui-error" role="alert">
      <span className="ui-error-ico" aria-hidden="true"><Icon name="alert-circle" size={20} /></span>
      <div className="ui-error-body">
        <strong className="ui-error-title">{title}</strong>
        {children && <p className="ui-error-text">{children}</p>}
      </div>
      {onRetry && (
        <Button variant="ghost" size="btn-sm" icon="refresh" onClick={onRetry}>{retryLabel}</Button>
      )}
    </div>
  );
}

/**
 * Stat — a single label/value figure. The lightweight inline counterpart to the
 * richer dashboard StatCard. Kept here because a few pages compose simple stats.
 * @param {React.ReactNode} label
 * @param {React.ReactNode} value
 * @param {string} [icon]
 */
export function Stat({ label, value, icon }) {
  return (
    <div className="ui-stat">
      <div className="ui-stat-value">{value}</div>
      <div className="ui-stat-label">
        {icon ? <IconLabel icon={icon} size={13}>{label}</IconLabel> : label}
      </div>
    </div>
  );
}
