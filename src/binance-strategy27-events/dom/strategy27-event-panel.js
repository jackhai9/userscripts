import { createStrategy27Translator, localizeAnnotation } from '../core/ui-copy.js';
const PANEL_ID = 'jh-strategy27-event-panel';
const PANEL_WIDTH = 320;
const DEFAULT_RIGHT_OFFSET = 84;
const DEFAULT_TOP_OFFSET = 68;

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
      gridTemplateColumns: 'var(--strategy27-label-width) minmax(0, 1fr)',
      gap: '8px',
      alignItems: 'start',
    },
  });
  line.appendChild(createElement(document, 'span', {
    text: label,
    styles: { color: '#848E9C', overflowWrap: 'anywhere' },
  }));
  line.appendChild(createElement(document, 'span', {
    text: value,
    styles: { color, overflowWrap: 'anywhere' },
  }));
  parent.appendChild(line);
}

export function createStrategy27EventPanel(document, chartRoot, {
  maxEvents,
  maxCompoundEvents,
  loadPosition,
  savePosition,
  locale = 'zh-CN',
}) {
  let t = createStrategy27Translator(locale);
  const statusLabels = () => ({
    active: t('进行中', 'Active'),
    complete: t('已结束', 'Ended'),
    incomplete: t('数据不完整', 'Incomplete data'),
  });
  if (!Number.isInteger(maxEvents) || maxEvents < 1) throw new Error('Strategy 27 panel maxEvents is invalid');
  if (!Number.isInteger(maxCompoundEvents) || maxCompoundEvents < 1 || maxCompoundEvents > 8) throw new Error('Strategy 27 panel maxCompoundEvents is invalid');
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
  panel.style.setProperty('--strategy27-label-width', locale === 'en' ? '88px' : '62px');

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
  header.title = t('拖动面板', 'Drag panel');
  const dragHandle = createElement(document, 'span', {
    text: '☰',
    styles: { color: '#848E9C', fontSize: '13px', cursor: 'move' },
  });
  const heading = createElement(document, 'strong', {
    text: t('Strategy 27 事件', 'Strategy 27 events'),
    styles: { flex: '1', fontSize: '13px', cursor: 'move' },
  });
  const latestButton = createElement(document, 'button', {
    text: t('最新', 'Latest'),
    role: 'follow-latest',
    styles: buttonStyles(),
  });
  latestButton.type = 'button';
  const collapseButton = createElement(document, 'button', {
    text: t('收起', 'Collapse'),
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
  const monitoring = createElement(document, 'div', {
    role: 'ordinary-monitoring-status',
    text: t('监控状态未知，等待事件数据确认。', 'Monitoring status unknown. Waiting for event evidence.'),
    styles: { padding: '9px', fontWeight: '600', color: '#F0B90B', borderBottom: '1px solid rgba(132, 142, 156, .18)' },
  });
  monitoring.dataset.state = 'unknown';
  monitoring.setAttribute('aria-live', 'polite');
  const ordinaryConnection = createElement(document, 'div', {
    role: 'ordinary-connection-status', text: t('事件数据：正在连接', 'Event data: Connecting'),
    styles: { padding: '5px 9px 0', color: '#848E9C', fontSize: '11px' },
  });
  ordinaryConnection.dataset.state = 'connecting';
  let monitoringObservation = null;
  const detail = createElement(document, 'div', {
    role: 'event-detail',
    styles: { display: 'grid', gap: '5px', padding: '9px' },
  });
  const recentTitle = createElement(document, 'div', {
    text: t('最近事件', 'Recent events'),
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
  const compoundTitle = createElement(document, 'strong', {
    text: t('复合候选', 'Compound candidates'),
    styles: { display: 'block', padding: '7px 9px 4px', borderTop: '1px solid rgba(132, 142, 156, .18)' },
  });
  const compoundStatus = createElement(document, 'div', {
    text: t('复合候选等待连接', 'Waiting for compound data connection'),
    role: 'compound-status',
    styles: { padding: '0 9px 5px', color: '#848E9C', fontSize: '11px', overflowWrap: 'anywhere' },
  });
  const compoundRecent = createElement(document, 'div', {
    role: 'compound-list',
    styles: { display: 'grid', gap: '2px', padding: '0 6px 7px' },
  });
  body.append(monitoring, ordinaryConnection, detail, compoundTitle, compoundStatus, compoundRecent, recentTitle, recent);
  panel.appendChild(body);
  document.body.appendChild(panel);
  const initialPosition = assertPanelPosition(loadPosition()) ?? createDefaultPosition(chartRoot);
  applyPanelPosition(panel, normalizePanelPosition(document, panel, initialPosition));
  const cleanupDrag = setupPanelDrag(document, panel, header, savePosition);

  const records = new Map();
  const compoundRecords = new Map();
  let selectedEventId = null;
  let selectedKind = 'ordinary';
  let followLatest = true;
  let collapsed = false;

  function orderedEntries(collection = records) {
    return [...collection.entries()].sort((left, right) => (
      right[1].annotation.eventTimeMs - left[1].annotation.eventTimeMs
      || right[1].observedAtMs - left[1].observedAtMs
    ));
  }

  function selectedCollection() {
    return selectedKind === 'compound' ? compoundRecords : records;
  }

  function selectLatest() {
    const all = [
      ...orderedEntries().map(([id, record]) => ({ id, record, kind: 'ordinary' })),
      ...orderedEntries(compoundRecords).map(([id, record]) => ({ id, record, kind: 'compound' })),
    ].sort((a, b) => b.record.annotation.eventTimeMs - a.record.annotation.eventTimeMs || b.record.observedAtMs - a.record.observedAtMs);
    selectedEventId = all[0]?.id ?? null;
    selectedKind = all[0]?.kind ?? 'ordinary';
  }

  function reconcileSelection() {
    if (!selectedCollection().has(selectedEventId)) followLatest = true;
    if (followLatest) selectLatest();
  }

  function renderDetail() {
    detail.replaceChildren();
    const record = selectedCollection().get(selectedEventId);
    if (!record) {
      detail.appendChild(createElement(document, 'span', {
        text: t('等待新事件', 'Waiting for new events'),
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
      styles: { color: selectedKind === 'compound' ? annotation.titleColor : annotation.markerColor ?? '#EAECEF', fontWeight: '700', flex: '1' },
    }));
    title.appendChild(createElement(document, 'span', {
      text: selectedKind === 'compound' ? t('探索版', 'Exploratory') : record.historical ? t('历史记录', 'Historical') : statusLabels()[annotation.status],
      styles: { color: '#848E9C', fontSize: '11px' },
    }));
    detail.appendChild(title);
    appendDetailLine(document, detail, t('时间', 'Time'), formatClock(annotation.eventTimeMs));
    if (record.historical) appendDetailLine(document, detail, t('历史说明', 'History'), t('数据流已重启，当前显示最后收到的观察记录。', 'Stream restarted; showing the last received observation.'), '#F0B90B');
    if (selectedKind === 'compound') {
      for (const row of annotation.detailRows) appendDetailLine(document, detail, row.label, row.value);
      const identity = createElement(document, 'details', { role: 'compound-identity', styles: { color: '#848E9C' } });
      identity.appendChild(createElement(document, 'summary', { text: t('规则与候选 ID', 'Rule and candidate ID'), styles: { cursor: 'pointer' } }));
      identity.appendChild(createElement(document, 'div', {
        text: `${t('规则', 'Rule')} ${annotation.ruleIdentity}\n${t('候选', 'Candidate')} ${annotation.candidateId}`,
        styles: { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', userSelect: 'text', fontSize: '10px' },
      }));
      detail.appendChild(identity);
      for (const notice of annotation.notices) appendDetailLine(document, detail, t('说明', 'Note'), notice, '#848E9C');
      return;
    }
    appendDetailLine(document, detail, t('统计', 'Window'), annotation.windowText);
    if (annotation.candidateText) {
      appendDetailLine(document, detail, t('候选观察', 'Candidate observation'), annotation.candidateText, annotation.markerColor);
    }
    appendDetailLine(document, detail, t('即时响应', 'Immediate response'), annotation.summary, annotation.markerColor ?? '#EAECEF');
    for (const row of annotation.forceRows) {
      appendDetailLine(document, detail, row.label, row.detail ? `${row.value}｜${row.detail}` : row.value);
    }
    appendDetailLine(document, detail, t('点差', 'Spread'), annotation.priceDetail);
    appendDetailLine(document, detail, t('触发', 'Trigger'), annotation.triggerText);
    if (annotation.closeText) appendDetailLine(document, detail, t('结束', 'End reason'), annotation.closeText);
    for (const notice of annotation.notices) appendDetailLine(document, detail, t('说明', 'Note'), notice, '#F0B90B');
  }

  function renderRecent(container, collection, kind) {
    container.replaceChildren();
    for (const [eventId, record] of orderedEntries(collection)) {
      const { annotation } = record;
      const row = createElement(document, 'button', {
        role: kind === 'compound' ? 'compound-row' : 'event-row',
        styles: {
          display: 'grid',
          gridTemplateColumns: '7px 54px minmax(0, 1fr)',
          gap: '6px',
          alignItems: 'center',
          width: '100%',
          border: '0',
          borderRadius: '5px',
          padding: '5px 6px',
          background: kind === selectedKind && eventId === selectedEventId ? 'rgba(132, 142, 156, .18)' : 'transparent',
          color: '#EAECEF',
          font: '11px/16px BinancePlex, ui-sans-serif, system-ui, sans-serif',
          textAlign: 'left',
          cursor: 'pointer',
        },
      });
      row.type = 'button';
      row.dataset.eventId = eventId;
      if (record.historical) row.dataset.historical = 'true';
      row.title = `${annotation.title}｜${annotation.summary}`;
      row.appendChild(createElement(document, 'span', {
        styles: {
          width: '7px',
          height: '7px',
          borderRadius: '50%',
          background: annotation.markerColor ?? 'transparent',
          outline: kind === 'compound' ? '1px solid #EAECEF' : 'none',
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
        selectedKind = kind;
        followLatest = false;
        render();
      });
      container.appendChild(row);
    }
  }

  function renderMonitoring() {
    if (monitoringObservation === null) {
      monitoring.textContent = t('监控状态未知，等待事件数据确认。', 'Monitoring status unknown. Waiting for event evidence.');
      return;
    }
    if (monitoringObservation.historical) {
      monitoring.dataset.state = 'historical';
      monitoring.textContent = t('数据流已重启，监控状态等待新事件确认；保留记录仅供历史查看。', 'Stream restarted. Monitoring status awaits new event evidence; retained records are historical.');
      monitoring.style.color = '#F0B90B';
      return;
    }
    const state = monitoringObservation.closeReason === 'universe_removed' ? 'removed'
      : monitoringObservation.closeReason === 'monitor_stopped' ? 'stopped' : 'observed';
    const text = state === 'removed'
      ? t('该币种已移出监控范围，保留记录仅供历史查看。', 'Symbol removed from monitoring. Retained records are historical.')
      : state === 'stopped' ? t('监控已停止，保留记录仅供历史查看。', 'Monitoring stopped. Retained records are historical.')
        : t('已收到观察记录，等待后续事件。', 'Observation received. Waiting for further events.');
    monitoring.dataset.state = state;
    monitoring.textContent = t('最近报告的监控状态（', 'Last reported monitoring status (') + formatClock(monitoringObservation.observedAtMs) + t('）：', '): ') + text;
    monitoring.style.color = state === 'observed' ? '#848E9C' : '#F0B90B';
  }

  function renderConnection() {
    const labels = { connecting: t('正在连接', 'Connecting'), connected: t('已连接', 'Connected'), reconnecting: t('正在重连', 'Reconnecting'), stopped: t('已停止', 'Stopped') };
    ordinaryConnection.textContent = t('事件数据：', 'Event data: ') + labels[ordinaryConnection.dataset.state];
  }

  function render() {
    latestButton.style.color = followLatest ? '#F0B90B' : '#EAECEF';
    renderDetail();
    renderRecent(recent, records, 'ordinary');
    renderRecent(compoundRecent, compoundRecords, 'compound');
  }

  latestButton.addEventListener('click', () => {
    followLatest = true;
    selectLatest();
    render();
  });
  collapseButton.addEventListener('click', () => {
    collapsed = !collapsed;
    body.style.display = collapsed ? 'none' : 'block';
    collapseButton.textContent = collapsed ? t('展开', 'Expand') : t('收起', 'Collapse');
  });

  render();
  function upsertRecord(collection, capacity, eventId, annotation, observedAtMs) {
    collection.set(eventId, { annotation, observedAtMs });
    const ordered = orderedEntries(collection);
    while (ordered.length > capacity) collection.delete(ordered.pop()[0]);
    reconcileSelection();
    render();
  }

  function removeRecord(collection, eventId) {
    collection.delete(eventId);
    reconcileSelection();
    render();
  }

  return Object.freeze({
    /** Language changes repaint the same records and selection without replaying either stream. */
    setLocale(nextLocale) {
      t = createStrategy27Translator(nextLocale);
      panel.style.setProperty('--strategy27-label-width', nextLocale === 'en' ? '88px' : '62px');
      header.title = t('拖动面板', 'Drag panel');
      heading.textContent = t('Strategy 27 事件', 'Strategy 27 events');
      latestButton.textContent = t('最新', 'Latest');
      collapseButton.textContent = collapsed ? t('展开', 'Expand') : t('收起', 'Collapse');
      recentTitle.textContent = t('最近事件', 'Recent events');
      compoundTitle.textContent = t('复合候选', 'Compound candidates');
      for (const collection of [records, compoundRecords]) {
        for (const record of collection.values()) record.annotation = localizeAnnotation(record.annotation, nextLocale);
      }
      renderMonitoring();
      renderConnection();
      render();
    },
    /** Event identity order prevents delayed outcomes or bootstrap replay from undoing removal or reentry. */
    observeOrdinaryEvent(event, observedAtMs) {
      const previous = monitoringObservation;
      if (previous && event.triggered_at_ms < previous.triggeredAtMs) return;
      if (previous && event.triggered_at_ms === previous.triggeredAtMs) {
        if (observedAtMs < previous.observedAtMs) return;
        if (previous.terminal && event.event_status === 'active') return;
      }
      monitoringObservation = {
        triggeredAtMs: event.triggered_at_ms,
        observedAtMs,
        terminal: event.event_status !== 'active',
        closeReason: event.close_reason,
        historical: false,
      };
      renderMonitoring();
    },
    setOrdinaryConnection(state) {
      if (!['connected', 'reconnecting', 'stopped'].includes(state)) throw new Error('Invalid ordinary connection state');
      ordinaryConnection.dataset.state = state;
      renderConnection();
      ordinaryConnection.style.color = state === 'stopped' ? '#F6465D' : '#848E9C';
    },
    upsert(eventId, annotation, observedAtMs) {
      upsertRecord(records, maxEvents, eventId, annotation, observedAtMs);
    },
    upsertCompound(eventId, annotation, observedAtMs) {
      upsertRecord(compoundRecords, maxCompoundEvents, eventId, annotation, observedAtMs);
    },
    remove(eventId) {
      removeRecord(records, eventId);
    },
    removeCompound(eventId) {
      removeRecord(compoundRecords, eventId);
    },
    /** Retain facts and selection without presenting a previous stream as live. */
    retainHistory() {
      if (monitoring.dataset.state === 'observed') {
        monitoringObservation.historical = true;
        renderMonitoring();
      }
      for (const record of records.values()) record.historical = true;
      render();
    },
    clear() {
      records.clear();
      reconcileSelection();
      render();
    },
    clearCompound() {
      compoundRecords.clear();
      reconcileSelection();
      render();
    },
    setCompoundStatus(text, state) {
      if (typeof text !== 'string' || !['normal', 'inactive', 'error'].includes(state)) throw new Error('Strategy 27 compound panel status is invalid');
      compoundStatus.textContent = text;
      compoundStatus.dataset.state = state;
      compoundStatus.style.color = state === 'error' ? '#F6465D' : '#848E9C';
    },
    destroy() {
      records.clear();
      compoundRecords.clear();
      cleanupDrag();
      panel.remove();
    },
    get size() {
      return records.size;
    },
    get compoundSize() {
      return compoundRecords.size;
    },
  });
}
