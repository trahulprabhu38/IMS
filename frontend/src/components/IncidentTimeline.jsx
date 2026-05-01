import React, { useState } from 'react';
import '../styles/timeline.css';

const EVENT_META = {
  CREATED:        { icon: '⚡', label: 'Incident Created',    cls: 'evt--created' },
  STATUS_CHANGED: { icon: '↻',  label: 'Status Changed',      cls: 'evt--status' },
  SIGNAL_LINKED:  { icon: '📶', label: 'Signal Linked',       cls: 'evt--signal' },
  RCA_SUBMITTED:  { icon: '📋', label: 'RCA Submitted',       cls: 'evt--rca' },
  OWNER_CHANGED:  { icon: '👤', label: 'Owner Changed',       cls: 'evt--owner' },
  ACKNOWLEDGED:   { icon: '✓',  label: 'Acknowledged',        cls: 'evt--ack' },
  ESCALATED:      { icon: '🔺', label: 'Escalated',           cls: 'evt--escalated' },
};

function formatMeta(eventType, metadata) {
  if (!metadata) return null;
  switch (eventType) {
    case 'CREATED':
      return (
        <span>
          <b>{metadata.severity}</b> · {metadata.componentType} · Auto-assigned to <b>{metadata.owner}</b>
        </span>
      );
    case 'STATUS_CHANGED':
      return (
        <span>
          <span className="tl-status-from">{metadata.from}</span>
          <span className="tl-arrow"> → </span>
          <span className="tl-status-to">{metadata.to}</span>
        </span>
      );
    case 'RCA_SUBMITTED':
      return (
        <span>
          Category: <b>{metadata.rootCauseCategory}</b>
          {metadata.mttrSeconds != null && (
            <> · MTTR <b>{fmtMttr(metadata.mttrSeconds)}</b></>
          )}
        </span>
      );
    case 'OWNER_CHANGED':
      return (
        <span>
          <span className="tl-owner-from">{metadata.from}</span>
          <span className="tl-arrow"> → </span>
          <span className="tl-owner-to">{metadata.to}</span>
        </span>
      );
    case 'ESCALATED':
      return (
        <span>
          Level <b>{metadata.level}</b> · Unacknowledged for <b>{metadata.unacknowledgedMinutes}m</b>
        </span>
      );
    case 'ACKNOWLEDGED':
      return metadata.owner ? <span>by <b>{metadata.owner}</b></span> : null;
    default:
      return null;
  }
}

export default function IncidentTimeline({ events = [] }) {
  if (events.length === 0) {
    return (
      <div className="tl-empty">No timeline events yet.</div>
    );
  }

  return (
    <div className="tl-root">
      {events.map((evt, i) => (
        <TimelineEvent key={evt.id} evt={evt} isLast={i === events.length - 1} />
      ))}
    </div>
  );
}

function TimelineEvent({ evt, isLast }) {
  const [open, setOpen] = useState(false);
  const meta = EVENT_META[evt.event_type] || { icon: '•', label: evt.event_type, cls: '' };
  const hasExtra = evt.metadata && Object.keys(evt.metadata).length > 0;

  return (
    <div className={`tl-event ${isLast ? 'tl-event--last' : ''}`}>
      <div className={`tl-dot ${meta.cls}`}>{meta.icon}</div>
      <div className="tl-body">
        <div className="tl-row" onClick={() => hasExtra && setOpen(o => !o)}>
          <span className="tl-label">{meta.label}</span>
          <span className="tl-actor">{evt.actor}</span>
          <span className="tl-time">{fmtTime(evt.occurred_at)}</span>
          {hasExtra && (
            <span className={`tl-chevron ${open ? 'tl-chevron--open' : ''}`}>›</span>
          )}
        </div>
        <div className="tl-detail-line">
          {formatMeta(evt.event_type, evt.metadata)}
        </div>
        {open && hasExtra && (
          <pre className="tl-raw-meta">
            {JSON.stringify(evt.metadata, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

function fmtTime(d) {
  return new Date(d).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtMttr(s) {
  if (s < 60)   return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${(s / 3600).toFixed(1)}h`;
}
