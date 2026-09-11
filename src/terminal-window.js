const GAP = 8;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

export function fitTerminal(rect, viewport) {
  const maxWidth = Math.max(1, viewport.width - GAP * 2);
  const maxHeight = Math.max(1, viewport.height - GAP * 2);
  const width = clamp(rect.width, Math.min(320, maxWidth), maxWidth);
  const height = clamp(rect.height, Math.min(300, maxHeight), maxHeight);
  return {
    x: clamp(rect.x, GAP, Math.max(GAP, viewport.width - width - GAP)),
    y: clamp(rect.y, GAP, Math.max(GAP, viewport.height - height - GAP)),
    width, height,
  };
}

export function changeTerminal(rect, mode, dx, dy, viewport) {
  const start = fitTerminal(rect, viewport);
  if (mode === 'move') return fitTerminal({ ...start, x: start.x + dx, y: start.y + dy }, viewport);
  // A resize keeps the top-left corner fixed, including at viewport edges.
  const maxWidth = Math.max(1, viewport.width - start.x - GAP);
  const maxHeight = Math.max(1, viewport.height - start.y - GAP);
  return { ...start,
    width: clamp(start.width + dx, Math.min(320, maxWidth), maxWidth),
    height: clamp(start.height + dy, Math.min(300, maxHeight), maxHeight),
  };
}

export function attachTerminalWindow(dialog, win = window) {
  const titlebar = dialog.querySelector('.titlebar');
  const handle = dialog.querySelector('[data-terminal-resize]');
  let bounds, gesture;
  const viewport = () => ({ width: win.innerWidth, height: win.innerHeight });
  const apply = next => {
    bounds = next;
    Object.assign(dialog.style, { left: `${next.x}px`, top: `${next.y}px`, width: `${next.width}px`, height: `${next.height}px` });
  };
  const center = () => {
    const view = viewport();
    apply(fitTerminal({ x: (view.width - 700) / 2, y: (view.height - 520) / 2, width: 700, height: 520 }, view));
  };
  const finish = () => {
    const previous = gesture; gesture = null;
    dialog.classList.remove('terminal-moving');
    if (previous?.element.hasPointerCapture(previous.id)) previous.element.releasePointerCapture(previous.id);
  };
  function bind(element, mode) {
    element.addEventListener('pointerdown', event => {
      if (event.button !== 0 || event.isPrimary === false || gesture || (mode === 'move' && event.target.closest('button'))) return;
      event.preventDefault();
      gesture = { element, id: event.pointerId, x: event.clientX, y: event.clientY, start: { ...bounds } };
      element.setPointerCapture(event.pointerId);
      if (mode === 'move') dialog.classList.add('terminal-moving');
    });
    element.addEventListener('pointermove', event => {
      if (!gesture || gesture.id !== event.pointerId || gesture.element !== element) return;
      apply(changeTerminal(gesture.start, mode, event.clientX - gesture.x, event.clientY - gesture.y, viewport()));
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) element.addEventListener(type, event => {
      if (gesture?.id === event.pointerId && gesture.element === element) finish();
    });
    element.addEventListener('keydown', event => {
      if (event.target !== element || event.altKey || event.ctrlKey || event.metaKey) return;
      const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
      if (!delta) return;
      event.preventDefault(); event.stopPropagation();
      const step = event.shiftKey ? 5 : 20;
      apply(changeTerminal(bounds, mode, delta[0] * step, delta[1] * step, viewport()));
    });
  }
  bind(titlebar, 'move'); bind(handle, 'resize');
  titlebar.addEventListener('dblclick', event => {
    if (!event.target.closest('button')) { finish(); center(); }
  });
  dialog.addEventListener('close', finish);
  win.addEventListener('blur', finish);
  win.addEventListener('resize', () => { finish(); if (dialog.open && bounds) apply(fitTerminal(bounds, viewport())); });
  return { show() { if (bounds) apply(fitTerminal(bounds, viewport())); else center(); } };
}
