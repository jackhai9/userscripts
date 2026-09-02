const PANEL_ID = 'jh-strategy27-event-panel';
const PANEL_WIDTH = 320;
const DEFAULT_RIGHT_OFFSET = 84;
const DEFAULT_TOP_OFFSET = 68;

const STATUS_LABELS = Object.freeze({
  active: '进行中',
  complete: '已结束',
  incomplete: '数据不完整',
});

function setStyles(element, styles) {
  Object.assign(element.style, styles);
  return element;
}

function createElement(document, tagName, { text = '', role = null, styles = null } = {}) {
  const element = document.createElement(tagName);
  element.textContent = text;
  if (role) element.dataset.role = role;
  if (styles) setStyles(element, styles);
  return element;
}

function formatClock(timestampMs) {
  const date = new Date(timestampMs);
  const part = (value) => String(value).padStart(2, '0');
  return `${part(date.getHours())}:${part(date.getMinutes())}:${part(date.getSeconds())}`;
}

function buttonStyles() {
  return {
    border: '0',
    borderRadius: '5px',
    padding: '2px 7px',
    background: 'rgba(132, 142, 156, .18)',
    color: '#EAECEF',
    font: '11px/18px BinancePlex, ui-sans-serif, system-ui, sans-serif',
    cursor: 'pointer',
  };
}

function panelWindow(document) {
  const view = document.defaultView;
  if (!view) throw new Error('Strategy 27 panel window is unavailable');
  return view;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(value, maximum));
}

function assertPanelPosition(position) {
  if (position === null) return null;
  if (
    !position
    || typeof position !== 'object'
    || !Number.isFinite(position.left)
    || !Number.isFinite(position.top)
  ) {
    throw new Error('Strategy 27 panel position is invalid');
  }
  return position;
}

function normalizePanelPosition(document, panel, position) {
  const view = panelWindow(document);
  const width = panel.offsetWidth || PANEL_WIDTH;
  const height = panel.offsetHeight || 48;
  return {
    left: clamp(position.left, 0, Math.max(0, view.innerWidth - width)),
    top: clamp(position.top, 0, Math.max(0, view.innerHeight - height)),
  };
}

function applyPanelPosition(panel, position) {
  panel.style.left = `${position.left}px`;
  panel.style.top = `${position.top}px`;
  panel.style.right = 'auto';
}

function createDefaultPosition(chartRoot) {
  const chartRect = chartRoot.getBoundingClientRect();
  return {
    left: chartRect.right - DEFAULT_RIGHT_OFFSET - PANEL_WIDTH,
    top: chartRect.top + DEFAULT_TOP_OFFSET,
  };
}

function setupPanelDrag(document, panel, header, savePosition) {
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let startLeft = 0;
  let startTop = 0;

  const onMouseDown = (event) => {
    if (event.button !== 0) return;
    if (event.target.closest('button,a')) return;
    const rect = panel.getBoundingClientRect();
    dragging = true;
    startX = event.clientX;
    startY = event.clientY;
    startLeft = rect.left;
    startTop = rect.top;
    event.preventDefault();
  };

  const onMouseMove = (event) => {
    if (!dragging) return;
    const position = normalizePanelPosition(document, panel, {
      left: startLeft + event.clientX - startX,
      top: startTop + event.clientY - startY,
    });
    applyPanelPosition(panel, position);
  };

  const onMouseUp = () => {
    if (!dragging) return;
    dragging = false;
    const rect = panel.getBoundingClientRect();
    const position = normalizePanelPosition(document, panel, { left: rect.left, top: rect.top });
    applyPanelPosition(panel, position);
    savePosition(position);
  };

  header.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);

  return () => {
    dragging = false;
    header.removeEventListener('mousedown', onMouseDown);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  };
}

function appendDetailLine(document, parent, label, value, color = '#EAECEF') {
  const line = createElement(document, 'div', {
    styles: {
      display: 'grid',
      gridTemplateColumns: '62px minmax(0, 1fr)',
      gap: '8px',
      alignItems: 'start',
    },
  });
  line.appendChild(createElement(document, 'span', {
    text: label,
    styles: { color: '#848E9C', whiteSpace: 'nowrap' },
  }));
  line.appendChild(createElement(document, 'span', {
    text: value,
    styles: { color, overflowWrap: 'anywhere' },
  }));
  parent.appendChild(line);
}

export function createStrategy27EventPanel(document, chartRoot, {
  maxEvents,
  loadPosition,
  savePosition,
}) {
  if (!Number.isInteger(maxEvents) || maxEvents < 1) throw new Error('Strategy 27 panel maxEvents is invalid');
  if (typeof loadPosition !== 'function') throw new Error('Strategy 27 panel loadPosition is invalid');
  if (typeof savePosition !== 'function') throw new Error('Strategy 27 panel savePosition is invalid');
  document.getElementById(PANEL_ID)?.remove();

  const panel = createElement(document, 'section', {
    styles: {
      position: 'fixed',
      zIndex: '999996',
      left: '0',
      top: '0',
      width: `${PANEL_WIDTH}px`,
      maxWidth: 'calc(100% - 112px)',
      maxHeight: 'calc(100% - 92px)',
      border: '1px solid rgba(132, 142, 156, .28)',
      borderRadius: '8px',
      background: 'rgba(24, 26, 32, .94)',
      boxShadow: '0 4px 16px rgba(0, 0, 0, .28)',
      color: '#EAECEF',
      font: '12px/17px BinancePlex, ui-sans-serif, system-ui, sans-serif',
      pointerEvents: 'auto',
      userSelect: 'none',
      overflow: 'hidden',
    },
  });
  panel.id = PANEL_ID;

  const header = createElement(document, 'header', {
    styles: {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      padding: '8px 9px',
      borderBottom: '1px solid rgba(132, 142, 156, .18)',
      cursor: 'move',
    },
  });
  header.title = '拖动面板';
  const dragHandle = createElement(document, 'span', {
    text: '☰',
    styles: { color: '#848E9C', fontSize: '13px', cursor: 'move' },
  });
  const heading = createElement(document, 'strong', {
    text: 'Strategy 27 事件',
    styles: { flex: '1', fontSize: '13px', cursor: 'move' },
  });
  const latestButton = createElement(document, 'button', {
    text: '最新',
    role: 'follow-latest',
    styles: buttonStyles(),
  });
  latestButton.type = 'button';
  const collapseButton = createElement(document, 'button', {
    text: '收起',
    role: 'collapse',
    styles: buttonStyles(),
  });
  collapseButton.type = 'button';
  header.append(dragHandle, heading, latestButton, collapseButton);
  panel.appendChild(header);

  const body = createElement(document, 'div', {
    role: 'panel-body',
    styles: { overflow: 'auto', maxHeight: 'calc(100vh - 190px)' },
  });
  const detail = createElement(document, 'div', {
    role: 'event-detail',
    styles: { display: 'grid', gap: '5px', padding: '9px' },
  });
  const recentTitle = createElement(document, 'div', {
    text: '最近事件',
    styles: {
      padding: '7px 9px 4px',
      borderTop: '1px solid rgba(132, 142, 156, .18)',
      color: '#848E9C',
      fontWeight: '600',
    },
  });
  const recent = createElement(document, 'div', {
    role: 'event-list',
    styles: { display: 'grid', gap: '2px', padding: '0 6px 7px' },
  });
  body.append(detail, recentTitle, recent);
  panel.appendChild(body);
  document.body.appendChild(panel);
  const initialPosition = assertPanelPosition(loadPosition()) ?? createDefaultPosition(chartRoot);
  applyPanelPosition(panel, normalizePanelPosition(document, panel, initialPosition));
  const cleanupDrag = setupPanelDrag(document, panel, header, savePosition);

  const records = new Map();
  let selectedEventId = null;
  let followLatest = true;
  let collapsed = false;

  function orderedEntries() {
    return [...records.entries()].sort((left, right) => (
      right[1].annotation.eventTimeMs - left[1].annotation.eventTimeMs
      || right[1].observedAtMs - left[1].observedAtMs
    ));
  }

  function renderDetail() {
    detail.replaceChildren();
    const record = records.get(selectedEventId);
    if (!record) {
      detail.appendChild(createElement(document, 'span', {
        text: '等待新事件',
        styles: { color: '#848E9C' },
      }));
      return;
    }
    const { annotation } = record;
    const title = createElement(document, 'div', {
      styles: { display: 'flex', alignItems: 'center', gap: '6px' },
    });
    title.appendChild(createElement(document, 'span', {
      text: annotation.title,
      styles: { color: annotation.markerColor ?? '#EAECEF', fontWeight: '700', flex: '1' },
    }));
    title.appendChild(createElement(document, 'span', {
      text: STATUS_LABELS[annotation.status],
      styles: { color: '#848E9C', fontSize: '11px' },
    }));
    detail.appendChild(title);
    appendDetailLine(document, detail, '时间', formatClock(annotation.eventTimeMs));
    appendDetailLine(document, detail, '统计', annotation.windowText);
    if (annotation.candidateText) {
      appendDetailLine(document, detail, '候选观察', annotation.candidateText, annotation.markerColor);
    }
    appendDetailLine(document, detail, '即时响应', annotation.summary, annotation.markerColor ?? '#EAECEF');
    for (const row of annotation.forceRows) {
      appendDetailLine(document, detail, row.label, row.detail ? `${row.value}｜${row.detail}` : row.value);
    }
    appendDetailLine(document, detail, '点差', annotation.priceDetail);
    appendDetailLine(document, detail, '触发', annotation.triggerText);
    if (annotation.closeText) appendDetailLine(document, detail, '结束', annotation.closeText);
    for (const notice of annotation.notices) appendDetailLine(document, detail, '说明', notice, '#F0B90B');
  }

  function renderRecent() {
    recent.replaceChildren();
    for (const [eventId, record] of orderedEntries()) {
      const { annotation } = record;
      const row = createElement(document, 'button', {
        role: 'event-row',
        styles: {
          display: 'grid',
          gridTemplateColumns: '7px 54px minmax(0, 1fr)',
          gap: '6px',
          alignItems: 'center',
          width: '100%',
          border: '0',
          borderRadius: '5px',
          padding: '5px 6px',
          background: eventId === selectedEventId ? 'rgba(132, 142, 156, .18)' : 'transparent',
          color: '#EAECEF',
          font: '11px/16px BinancePlex, ui-sans-serif, system-ui, sans-serif',
          textAlign: 'left',
          cursor: 'pointer',
        },
      });
      row.type = 'button';
      row.dataset.eventId = eventId;
      row.title = `${annotation.title}｜${annotation.summary}`;
      row.appendChild(createElement(document, 'span', {
        styles: {
          width: '7px',
          height: '7px',
          borderRadius: '50%',
          background: annotation.markerColor ?? 'transparent',
        },
      }));
      row.appendChild(createElement(document, 'span', {
        text: formatClock(annotation.eventTimeMs),
        styles: { color: '#848E9C' },
      }));
      row.appendChild(createElement(document, 'span', {
        text: annotation.summary,
        styles: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
      }));
      row.addEventListener('click', () => {
        selectedEventId = eventId;
        followLatest = false;
        render();
      });
      recent.appendChild(row);
    }
  }

  function render() {
    latestButton.style.color = followLatest ? '#F0B90B' : '#EAECEF';
    renderDetail();
    renderRecent();
  }

  latestButton.addEventListener('click', () => {
    followLatest = true;
    selectedEventId = orderedEntries()[0]?.[0] ?? null;
    render();
  });
  collapseButton.addEventListener('click', () => {
    collapsed = !collapsed;
    body.style.display = collapsed ? 'none' : 'block';
    collapseButton.textContent = collapsed ? '展开' : '收起';
  });

  render();
  return Object.freeze({
    upsert(eventId, annotation, observedAtMs) {
      records.set(eventId, { annotation, observedAtMs });
      const ordered = orderedEntries();
      while (ordered.length > maxEvents) {
        const [expiredId] = ordered.pop();
        records.delete(expiredId);
      }
      if (!records.has(selectedEventId)) followLatest = true;
      if (followLatest) selectedEventId = orderedEntries()[0]?.[0] ?? null;
      render();
    },
    remove(eventId) {
      records.delete(eventId);
      if (selectedEventId === eventId) {
        followLatest = true;
        selectedEventId = orderedEntries()[0]?.[0] ?? null;
      }
      render();
    },
    clear() {
      records.clear();
      selectedEventId = null;
      followLatest = true;
      render();
    },
    destroy() {
      records.clear();
      cleanupDrag();
      panel.remove();
    },
    get size() {
      return records.size;
    },
  });
}
