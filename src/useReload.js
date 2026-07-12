import { useEffect } from 'react';

// Re-run a loader when the tab regains focus after being hidden, plus on
// back/forward-cache restores. Keeps standalone pages (Archive, public
// profiles) fresh without a manual refresh. `load` should be stable
// (wrap in useCallback).
export function useReloadOnFocus(load) {
  useEffect(() => {
    let hiddenAt = 0;
    const onVis = () => {
      if (document.visibilityState === 'hidden') { hiddenAt = Date.now(); return; }
      if (hiddenAt && Date.now() - hiddenAt > 800) { hiddenAt = 0; load(); }
    };
    const onPageShow = (e) => { if (e.persisted) load(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pageshow', onPageShow);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pageshow', onPageShow);
    };
  }, [load]);
}
