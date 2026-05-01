import React, { useState } from 'react';
import '../styles/timeline.css';

const ACTION_META = {
  STATUS_TRANSITION: { icon: '↻', label: 'Status Transition' },
  RCA_SUBMITTED:     { icon: '📋', label: 'RCA Submitted' },
  OWNER_CHANGED:     { icon: '👤', label: 'Owner Changed' },
  ESCALATED:         { icon: '🔺', label: 'Escalated' },
  ACKNOWLEDGED:      { icon: '✓',  label: 'Acknowledged' },
};

export default function AuditLog({ entries = [] }) {
  if (entries.length === 0) {
    return <div className="tl-empty">No audit entries yet.</div>;
  }

  return (
    <div className="audit-root">
      {entries.map(entry => (
        <AuditEntry key={entry.id} entry={entry} />
      ))}
    </div>
  );
}

function AuditEntry({ entry }) {
  const [open, setOpen] = useState(false);
  const meta = ACTION_META[entry.action] || { icon: '•', label: entry.action };
  const hasDiff = entry.before_state || entry.after_state;

  return (
    <div className="audit-entry">
      <div className="audit-entry-header" onClick={() => hasDiff && setOpen(o => !o)}>
        <span className="audit-icon">{meta.icon}</span>
        <span className="audit-action">{meta.label}</span>
        <span className="audit-actor">{entry.actor}</span>
        <span className="audit-time">{fmtTime(entry.occurred_at)}</span>
        {hasDiff && (
          <span className={`tl-chevron ${open ? 'tl-chevron--open' : ''}`}>›</span>
        )}
      </div>
      {open && hasDiff && (
        <div className="audit-diff">
          {entry.before_state && (
            <div className="audit-diff-col audit-diff-before">
              <div className="audit-diff-label">Before</div>
              <pre className="audit-diff-code">
                {JSON.stringify(entry.before_state, null, 2)}
              </pre>
            </div>
          )}
          {entry.after_state && (
            <div className="audit-diff-col audit-diff-after">
              <div className="audit-diff-label">After</div>
              <pre className="audit-diff-code">
                {JSON.stringify(entry.after_state, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function fmtTime(d) {
  return new Date(d).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
