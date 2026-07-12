import { useState } from 'react';

function applyTheme(dark) {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  try { localStorage.setItem('synthica.theme', dark ? 'dark' : 'light'); } catch { /* ignore */ }
}

export default function ThemeToggle({ className = '' }) {
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'dark');

  const flip = () => {
    const next = !dark;
    setDark(next);
    applyTheme(next);
  };

  return (
    <button
      type="button"
      className={`theme-toggle ${className}`.trim()}
      onClick={flip}
      aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={dark ? 'Light mode' : 'Dark mode'}
    />
  );
}
