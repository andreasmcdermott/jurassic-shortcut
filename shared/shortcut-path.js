const API = 'https://api.app.shortcut.com/api/v3';

export function allowedPath(path, query = {}) {
  if (['objectives', 'workflows', 'members', 'member'].includes(path)) return `/${path}`;
  if (path === 'epics/paginated') {
    const page = Number(query.page || 1);
    if (!Number.isSafeInteger(page) || page < 1) return null;
    return `/epics/paginated?page_size=250&includes_description=true&page=${page}`;
  }
  if (/^epics\/\d+\/stories$/.test(path) || /^stories\/\d+$/.test(path)) return `/${path}`;
  if (path === 'search/stories') {
    const params = new URLSearchParams({ query: '!has:epic', page_size: '250', detail: 'slim' });
    if (query.next) {
      // Shortcut may return a relative URL or a cursor. Never follow a supplied host.
      const next = String(query.next);
      if (next.length > 5000) return null;
      if (next.startsWith('/') || next.startsWith('https:')) {
        const parsed = new URL(next, API);
        if (parsed.origin !== 'https://api.app.shortcut.com' || parsed.pathname !== '/api/v3/search/stories') return null;
        const cursor = parsed.searchParams.get('next');
        if (!cursor) return null;
        params.set('next', cursor);
      } else params.set('next', next);
    }
    return `/search/stories?${params}`;
  }
  return null;
}
