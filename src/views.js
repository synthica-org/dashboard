/** Role-based workspace views — used by the top-right switcher + sidebar filtering. */

const EDITOR_ROLE_LABELS = {
  admin: 'Platform admin',
  director: 'Director',
  auditor: 'Auditor',
  chief: 'Editor-in-Chief',
  senior: 'Senior editor',
  associate: 'Associate editor',
  reviews: 'Reviews editor',
};

const TAG_LABELS = {
  lead_researcher: 'Lead researcher',
  associate_researcher: 'Associate researcher',
  chapter_leader: 'Chapter leader',
  independent_researcher: 'Independent researcher',
  expertise_mentor: 'Expertise mentor',
};

const VIEW_KEY = 'synthica.activeViewId';

/** Dev-only account flag — unlocks every workspace in the view switcher. */
export function isAllViewsDemo(user) {
  return !!user?.allViewsDemo;
}

/** Whether this account may open a portal route (`editor` or `researcher`). */
export function canAccessPortal(user, kind) {
  if (!user || !kind) return true;
  if (user.kind === kind) return true;
  return isAllViewsDemo(user);
}

function portalKindForPath(path = '') {
  if (path.startsWith('/editor')) return 'editor';
  if (path.startsWith('/researcher')) return 'researcher';
  return null;
}

const ALL_DEMO_VIEWS = [
  {
    id: 'editor-queue',
    label: 'Review queue',
    description: 'Editorial reviews',
    path: '/editor',
    kind: 'editor',
    icon: 'inbox',
  },
  {
    id: 'editor-director',
    label: 'Director desk',
    description: 'Publish papers & notify authors',
    path: '/editor/director',
    kind: 'editor',
    icon: 'folder-open',
  },
  {
    id: 'editor-moderator',
    label: 'Moderator console',
    description: 'Approve members, roles & proposals',
    path: '/moderator',
    kind: 'editor',
    icon: 'shield',
  },
  {
    id: 'editor-admin',
    label: 'Admin',
    description: 'Platform settings',
    path: '/editor/admin',
    kind: 'editor',
    icon: 'settings',
  },
  {
    id: 'researcher',
    label: 'Member portal',
    description: 'Find projects, join a team, connect',
    path: '/researcher',
    kind: 'researcher',
    icon: 'home',
  },
  {
    id: 'lead',
    label: 'Lead researcher',
    description: 'Run your team, recruit & publish',
    path: '/researcher/lead',
    kind: 'researcher',
    icon: 'rocket',
  },
  {
    id: 'independent',
    label: 'Independent researcher',
    description: 'Propose & run solo projects',
    path: '/researcher/independent',
    kind: 'researcher',
    icon: 'compass',
  },
  {
    id: 'chapter',
    label: 'Chapter leader',
    description: 'Your chapter & members',
    path: '/researcher/chapter',
    kind: 'researcher',
    icon: 'globe',
  },
  {
    id: 'mentor',
    label: 'Expertise mentor',
    description: 'Advise researchers 1:1',
    path: '/researcher/mentor',
    kind: 'researcher',
    icon: 'graduation-cap',
  },
  {
    id: 'archive',
    label: 'Synthica Archive',
    description: 'Browse published papers',
    path: '/archive',
    kind: 'shared',
    icon: 'archive',
  },
];

export function formatResearcherTags(tags = []) {
  if (!tags.length) return 'Member';
  return tags.map((t) => TAG_LABELS[t] || t).join(' · ');
}

function pathMatches(viewPath, pathname) {
  if (viewPath === '/archive') return pathname.startsWith('/archive');
  if (pathname === viewPath) return true;
  if (viewPath !== '/' && pathname.startsWith(`${viewPath}/`)) return true;
  return false;
}

/** All workspaces the signed-in user can open. */
export function getAvailableViews(user) {
  if (!user) return [];
  if (isAllViewsDemo(user)) return ALL_DEMO_VIEWS;

  const views = [];

  if (user.kind === 'editor') {
    const isSuperAdmin = user.role === 'admin';
    const isDirector = user.role === 'director' || isSuperAdmin;
    const isAuditor = user.role === 'auditor';
    const isAdmin = isDirector || isAuditor;
    const hasQueue = !isAuditor && !isSuperAdmin;

    if (hasQueue) {
      views.push({
        id: 'editor-queue',
        label: 'Review queue',
        description: EDITOR_ROLE_LABELS[user.role] || 'Editorial reviews',
        path: '/editor',
        kind: 'editor',
        icon: 'inbox',
      });
    }
    if (isDirector) {
      views.push({
        id: 'editor-director',
        label: 'Director desk',
        description: 'Publish papers & notify authors',
        path: '/editor/director',
        kind: 'editor',
        icon: 'folder-open',
      });
    }
    if (isAuditor || isDirector) {
      views.push({
        id: 'editor-moderator',
        label: 'Moderator console',
        description: 'Approve members, roles & proposals',
        path: '/moderator',
        kind: 'editor',
        icon: 'shield',
      });
    }
    if (isDirector) {
      views.push({
        id: 'editor-admin',
        label: 'Admin',
        description: 'Platform settings',
        path: '/editor/admin',
        kind: 'editor',
        icon: 'settings',
      });
    }
  } else if (user.kind === 'researcher') {
    views.push({
      id: 'researcher',
      label: 'Member portal',
      description: formatResearcherTags(user.tags),
      path: '/researcher',
      kind: 'researcher',
      icon: 'home',
    });

    const tags = user.tags || [];
    if (tags.includes('lead_researcher')) {
      views.push({
        id: 'lead',
        label: 'Lead researcher',
        description: 'Run your team, recruit & publish',
        path: '/researcher/lead',
        kind: 'researcher',
        icon: 'rocket',
      });
    }
    if (tags.includes('independent_researcher')) {
      views.push({
        id: 'independent',
        label: 'Independent researcher',
        description: 'Propose & run solo projects',
        path: '/researcher/independent',
        kind: 'researcher',
        icon: 'compass',
      });
    }
    if (tags.includes('chapter_leader')) {
      views.push({
        id: 'chapter',
        label: 'Chapter leader',
        description: 'Your chapter & members',
        path: '/researcher/chapter',
        kind: 'researcher',
        icon: 'globe',
      });
    }
    if (tags.includes('expertise_mentor')) {
      views.push({
        id: 'mentor',
        label: 'Expertise mentor',
        description: 'Advise researchers 1:1',
        path: '/researcher/mentor',
        kind: 'researcher',
        icon: 'graduation-cap',
      });
    }
  }

  views.push({
    id: 'archive',
    label: 'Synthica Archive',
    description: 'Browse published papers',
    path: '/archive',
    kind: 'shared',
    icon: 'archive',
  });

  return views;
}

export function readSavedViewId(userId) {
  if (userId && typeof localStorage !== 'undefined') {
    const scoped = localStorage.getItem(`${VIEW_KEY}.${userId}`);
    if (scoped) return scoped;
  }
  if (typeof localStorage !== 'undefined') return localStorage.getItem(VIEW_KEY);
  return null;
}

export function saveActiveViewId(viewId, userId) {
  if (typeof localStorage === 'undefined' || !viewId) return;
  localStorage.setItem(VIEW_KEY, viewId);
  if (userId) localStorage.setItem(`${VIEW_KEY}.${userId}`, viewId);
}

/** Pick the workspace that best matches the current URL (or saved preference). */
export function resolveActiveView(views, pathname, userId) {
  if (!views.length) return null;

  const saved = readSavedViewId(userId);
  const savedView = saved ? views.find((v) => v.id === saved) : null;

  if (pathname.startsWith('/archive')) {
    return views.find((v) => v.id === 'archive') || savedView || views[0];
  }

  if (pathname.startsWith('/editor')) {
    const editorMatch = views
      .filter((v) => v.kind === 'editor')
      .sort((a, b) => b.path.length - a.path.length)
      .find((v) => pathMatches(v.path, pathname));
    return editorMatch || savedView || views.find((v) => v.kind === 'editor') || views[0];
  }

  if (pathname.startsWith('/moderator')) {
    return views.find((v) => v.id === 'editor-moderator') || savedView
      || views.find((v) => v.kind === 'editor') || views[0];
  }

  if (pathname.startsWith('/researcher')) {
    // An exact workspace home (e.g. /researcher/lead) selects that workspace.
    const exact = views
      .filter((v) => v.kind === 'researcher' && v.path !== '/researcher')
      .find((v) => pathname === v.path || pathname.startsWith(`${v.path}/`));
    if (exact) return exact;
    // Shared sub-pages (projects, community, calendar…) keep the chosen workspace.
    if (savedView?.kind === 'researcher') return savedView;
    return views.find((v) => v.id === 'researcher') || views[0];
  }

  return savedView || views.find((v) => v.kind !== 'shared') || views[0];
}

export function getDefaultHomePath(user) {
  const views = getAvailableViews(user);
  const saved = readSavedViewId(user?.id);
  const picked = saved && views.find((v) => v.id === saved && v.kind !== 'shared');
  if (picked?.path) {
    const portal = portalKindForPath(picked.path);
    if (!portal || canAccessPortal(user, portal)) return picked.path;
  }
  const primary = views.find((v) => v.kind === user?.kind);
  return primary?.path || (user?.kind === 'editor' ? '/editor' : '/researcher');
}

/** Sidebar items declare `views: ['*']` or specific view ids. */
export function filterNavForView(nav, activeViewId) {
  if (!activeViewId) return nav;

  const visible = (item) => {
    if (item.spacer) return true;
    if (item.section) return false;
    const scopes = item.views || ['*'];
    return scopes.includes('*') || scopes.includes(activeViewId);
  };

  const out = [];
  let pendingSection = null;

  for (const item of nav) {
    if (item.section) {
      pendingSection = item;
      continue;
    }
    if (item.spacer) {
      // A spacer is a section boundary: drop any section header that had no
      // visible items in this view (otherwise it would attach to later items).
      // Consecutive spacers collapse into one (adjacent boundaries whose
      // sections were filtered out would otherwise stack up).
      pendingSection = null;
      if (out.some((x) => x.to) && !out[out.length - 1]?.spacer) out.push(item);
      continue;
    }
    if (!visible(item)) continue;
    if (pendingSection) {
      out.push(pendingSection);
      pendingSection = null;
    }
    out.push(item);
  }

  return out;
}
