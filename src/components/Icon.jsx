import { ICONS } from '../../shared/icons.js';

export default function Icon({ name, size = 20, className = '', title }) {
  const paths = ICONS[name];
  if (!paths) return null;
  return (
    <svg
      className={`icon ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title ? <title>{title}</title> : null}
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/** Synthica mark — uses the official favicon asset. */
export function BrandMark({ size = 22, className = '' }) {
  return (
    <img
      className={`brand-mark ${className}`.trim()}
      src={`${import.meta.env.BASE_URL}assets/logo/favicon.png`}
      alt=""
      width={size}
      height={size}
      draggable={false}
    />
  );
}
