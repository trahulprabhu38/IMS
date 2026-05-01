import React from 'react';
import '../styles/sidebar.css';

const SEV_COLOR = { P0: '#ef4444', P1: '#f97316', P2: '#eab308', P3: '#22c55e' };

export const FILTERS = [
  { key: 'all',       label: 'All',       statuses: null },
  { key: 'open',      label: 'Open',      statuses: ['OPEN'] },
  { key: 'running',   label: 'Running',   statuses: ['INVESTIGATING'] },
  { key: 'fixing',    label: 'Fixing',    statuses: ['RESOLVED'] },
  { key: 'submitted', label: 'Submitted', statuses: ['CLOSED'] },
  { key: 'closed',    label: 'Closed',    statuses: ['CLOSED'] },
];

export default function Sidebar({ workItems, activeFilter, onFilterChange, onSelectHistory }) {
  const countFor = (statuses) =>
    statuses ? workItems.filter(w => statuses.includes(w.status)).length : workItems.length;

  const closedItems = [...workItems]
    .filter(w => w.status === 'CLOSED')
    .sort((a, b) => new Date(b.updatedAt || b.startTime) - new Date(a.updatedAt || a.startTime))
    .slice(0, 20);

  return (
    <aside className="sidebar">
      {/* Filters */}
      <div style={{ marginBottom: 8 }}>
        <div className="sidebar-section-label">Filters</div>
        {FILTERS.map(f => {
          const isActive = activeFilter === f.key;
          return (
            <button
              key={f.key}
              className={`filter-btn ${isActive ? 'filter-btn--active' : ''}`}
              onClick={() => onFilterChange(f.key)}
            >
              <span>{f.label}</span>
              <span className={`filter-count ${isActive ? 'filter-count--active' : ''}`}>
                {countFor(f.statuses)}
              </span>
            </button>
          );
        })}
      </div>

      <div className="sidebar-divider" />

      {/* Incident history */}
      <div className="sidebar-section-label">Incident History</div>
      <div className="history-list">
        {closedItems.length === 0
          ? <div className="history-empty">No resolved incidents yet</div>
          : closedItems.map(wi => (
            <HistoryItem key={wi.id} wi={wi} onClick={() => onSelectHistory?.(wi.id)} />
          ))
        }
      </div>
    </aside>
  );
}

function HistoryItem({ wi, onClick }) {
  const closedAt = wi.closedAt || wi.updatedAt || wi.startTime;
  return (
    <div
      className="history-item"
      style={{ borderLeftColor: SEV_COLOR[wi.severity] || 'transparent' }}
      onClick={onClick}
    >
      <div className="history-item-row">
        <div className="history-sev-dot" style={{ background: SEV_COLOR[wi.severity] }} />
        <span className="history-title" title={wi.title}>{wi.title}</span>
      </div>
      <div className="history-meta">
        {wi.componentId}
        {' · '}
        {formatAgo(closedAt)}
        {wi.mttrSeconds != null && ` · MTTR ${formatMttr(wi.mttrSeconds)}`}
      </div>
    </div>
  );
}

function formatAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatMttr(s) {
  if (s < 60)   return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${(s / 3600).toFixed(1)}h`;
}
