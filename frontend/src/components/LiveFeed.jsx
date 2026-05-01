import React from 'react';
import { SeverityBadge, StatusBadge } from './StatusBadge.jsx';
import '../styles/feed.css';

const SEV_CLASS = { P0: 'incident-card--p0', P1: 'incident-card--p1', P2: 'incident-card--p2', P3: 'incident-card--p3' };

export default function LiveFeed({ workItems, selectedId, onSelect }) {
  return (
    <div>
      <div className="feed-header">
        <span className="feed-header-title">Incidents</span>
        <span className="feed-header-count">{workItems.length}</span>
      </div>

      <div className="feed-list">
        {workItems.length === 0 ? (
          <div className="feed-empty">
            <div className="feed-empty-icon">✓</div>
            No active incidents — system healthy
          </div>
        ) : (
          workItems.map(wi => {
            const isActive = wi.id === selectedId;
            const sevCls   = SEV_CLASS[wi.severity] || '';
            return (
              <div
                key={wi.id}
                className={`incident-card ${sevCls} ${isActive ? 'incident-card--active' : ''} ${wi.escalated ? 'incident-card--escalated' : ''}`}
                onClick={() => onSelect(wi.id)}
              >
                <div className="card-row">
                  <SeverityBadge severity={wi.severity} />
                  <span className="card-title">{wi.title}</span>
                  <StatusBadge status={wi.status} />
                </div>
                <div className="card-row">
                  <span className="card-meta">{wi.componentType} · {wi.componentId}</span>
                  <span className="card-signal-count">{wi.signalCount} sig</span>
                </div>
                <div className="card-row">
                  <span className="card-time">{fmtDate(wi.startTime)}</span>
                  <span className="card-owner" title="Owner">
                    {wi.owner || 'unassigned'}
                  </span>
                  {wi.escalated && (
                    <span className="card-escalated">🔺 L{wi.escalationLevel}</span>
                  )}
                  {!wi.acknowledgedAt && ['OPEN','INVESTIGATING'].includes(wi.status) && (
                    <span className="card-unacked" title="Unacknowledged">!</span>
                  )}
                  {wi.mttrSeconds != null && (
                    <span className="card-mttr">
                      MTTR {formatMttr(wi.mttrSeconds)}
                    </span>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function fmtDate(d) {
  const date = new Date(d);
  const now  = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' +
         date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatMttr(s) {
  if (s < 60)   return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${(s / 3600).toFixed(1)}h`;
}
