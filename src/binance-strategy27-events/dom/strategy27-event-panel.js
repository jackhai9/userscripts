const PANEL_ID = 'jh-strategy27-event-panel';

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

export function createStrategy27EventPanel(document, chartRoot, { maxEvents }) {
  if (!Number.isInteger(maxEvents) || maxEvents < 1) throw new Error('Strategy 27 panel maxEvents is invalid');
  document.getElementById(PANEL_ID)?.remove();

  const panel = createElement(document, 'section', {
    styles: {
      position: 'absolute',
      zIndex: '9',
      right: '84px',
      top: '68px',
      width: '320px',
      maxWidth: 'calc(100% - 112px)',
      maxHeight: 'calc(100% - 92px)',
      border: '1px solid rgba(132, 142, 156, .28)',
      borderRadius: '8px',
      background: 'rgba(24, 26, 32, .94)',
      boxShadow: '0 4px 16px rgba(0, 0, 0, .28)',
      color: '#EAECEF',
      font: '12px/17px BinancePlex, ui-sans-serif, system-ui, sans-serif',
      pointerEvents: 'auto',
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
    },
  });
  const heading = createElement(document, 'strong', {
    text: 'Strategy 27 事件',
    styles: { flex: '1', fontSize: '13px' },
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
  header.append(heading, latestButton, collapseButton);
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
  chartRoot.appendChild(panel);

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
      styles: { color: annotation.markerColor, fontWeight: '700', flex: '1' },
    }));
    title.appendChild(createElement(document, 'span', {
      text: STATUS_LABELS[annotation.status],
      styles: { color: '#848E9C', fontSize: '11px' },
    }));
    detail.appendChild(title);
    appendDetailLine(document, detail, '时间', formatClock(annotation.eventTimeMs));
    appendDetailLine(document, detail, '即时响应', annotation.summary, annotation.markerColor);
    for (const row of annotation.forceRows) {
      appendDetailLine(document, detail, row.label, `${row.value}｜${row.detail}`);
    }
    appendDetailLine(document, detail, '点差', annotation.priceDetail);
    appendDetailLine(document, detail, '触发', annotation.triggerText);
    if (annotation.closeText) appendDetailLine(document, detail, '结束', annotation.closeText);
    for (const outcome of annotation.outcomeLines) appendDetailLine(document, detail, '后续', outcome);
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
          background: annotation.markerColor,
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
      panel.remove();
    },
    get size() {
      return records.size;
    },
  });
}
