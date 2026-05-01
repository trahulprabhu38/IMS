import React from 'react';
import '../styles/badges.css';

export function SeverityBadge({ severity }) {
  const cls = { P0: 'badge-p0', P1: 'badge-p1', P2: 'badge-p2', P3: 'badge-p3' }[severity] || 'badge-p3';
  return <span className={`badge ${cls}`}>{severity}</span>;
}

export function StatusBadge({ status }) {
  const cls = {
    OPEN:          'badge-open',
    INVESTIGATING: 'badge-investigating',
    RESOLVED:      'badge-resolved',
    CLOSED:        'badge-closed',
  }[status] || 'badge-open';
  return <span className={`badge ${cls}`}>{status}</span>;
}
