const DIRECTIONS = {
  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1],
};

// Projected coordinates use +Y upward. Scale X by the viewport aspect ratio.
export function directionalNeighbor(points, currentKey, direction) {
  const axis = DIRECTIONS[direction];
  if (!axis || !points.length) return null;
  const current = points.find(point => point.key === currentKey);
  if (!current) {
    return points.reduce((best, point) => point.x ** 2 + point.y ** 2 < best.x ** 2 + best.y ** 2 ? point : best).key;
  }
  let best = null, bestScore = Infinity;
  for (const point of points) {
    if (point.key === currentKey) continue;
    const dx = point.x - current.x, dy = point.y - current.y;
    const forward = dx * axis[0] + dy * axis[1];
    if (forward <= 0.00001) continue;
    const sideways = Math.abs(dx * axis[1] - dy * axis[0]);
    // Favor neighbors in the same screen row/column over a close diagonal.
    const score = forward + 3 * sideways + sideways * sideways / forward;
    if (score < bestScore) { best = point.key; bestScore = score; }
  }
  return best;
}

export function workspaceShortcut(event, dialogOpen = false) {
  if (dialogOpen || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
  if (event.target?.closest('input, textarea, select, dialog, [contenteditable]:not([contenteditable="false"]), [role="textbox"]')) return null;
  if (DIRECTIONS[event.key]) return 'select';
  if (event.key.toLowerCase() === 'f') return 'fly';
  return null;
}
