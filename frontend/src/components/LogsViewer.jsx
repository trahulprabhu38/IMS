import React, { useState, useEffect, useCallback } from 'react';
import { fetchLogs, fetchLogStats } from '../api/client.js';
import '../styles/logs.css';

const SEV_COLORS = {
  P0: 'log-sev--p0',
  P1: 'log-sev--p1',
  P2: 'log-sev--p2',
  P3: 'log-sev--p3',
};

const SEV_LABELS = { P0: 'CRITICAL', P1: 'HIGH', P2: 'WARN', P3: 'INFO' };

export default function LogsViewer({ onClose }) {
  const [logs,          setLogs]          = useState([]);
  const [stats,         setStats]         = useState(null);
  const [loading,       setLoading]       = useState(false);
  const [filterSev,     setFilterSev]     = useState('');
  const [filterService, setFilterService] = useState('');
  const [total,         setTotal]         = useState(0);
  const [offset,        setOffset]        = useState(0);
  const LIMIT = 50;

  const load = useCallback(() => {
    setLoading(true);
    const params = { limit: LIMIT, offset };
    if (filterSev)     params.severity = filterSev;
    if (filterService) params.service  = filterService;
    fetchLogs(params)
      .then(data => { setLogs(data.logs || []); setTotal(data.total || 0); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [filterSev, filterService, offset]);

  useEffect(() => { load(); fetchLogStats().then(setStats).catch(() => {}); }, [load]);

  const handleFilter = (e) => {
    e.preventDefault();
    setOffset(0);
    load();
  };

  return (
    <div className="logs-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="logs-panel">
        {/* Header */}
        <div className="logs-header">
          <div className="logs-title">
            <span className="logs-title-icon">📡</span>
            Universal Log Stream
          </div>
          <div className="logs-header-right">
            <span className="logs-total">{total.toLocaleString()} logs</span>
            <button className="int-panel-close" onClick={onClose}>✕</button>
          </div>
        </div>

        {/* Stats bar */}
        {stats && (
          <div className="logs-stats-bar">
            {(stats.bySeverity || []).map(s => (
              <div key={s._id} className={`logs-stat-chip ${SEV_COLORS[s._id] || ''}`}>
                <span className="logs-stat-label">{SEV_LABELS[s._id] || s._id}</span>
                <span className="logs-stat-count">{s.count.toLocaleString()}</span>
              </div>
            ))}
            <span className="logs-stat-period">last 24h</span>
          </div>
        )}

        {/* Filter bar */}
        <form className="logs-filter-bar" onSubmit={handleFilter}>
          <input
            className="logs-filter-input"
            placeholder="Filter by service…"
            value={filterService}
            onChange={e => { setFilterService(e.target.value); setOffset(0); }}
          />
          <select
            className="logs-filter-select"
            value={filterSev}
            onChange={e => { setFilterSev(e.target.value); setOffset(0); }}
          >
            <option value="">All severities</option>
            <option value="P0">P0 — Critical</option>
            <option value="P1">P1 — High</option>
            <option value="P2">P2 — Warning</option>
            <option value="P3">P3 — Info</option>
          </select>
          <button type="submit" className="logs-filter-btn">Refresh</button>
        </form>

        {/* Table */}
        <div className="logs-table-wrap">
          {loading ? (
            <div className="logs-empty">Loading…</div>
          ) : logs.length === 0 ? (
            <div className="logs-empty">
              <div style={{ fontSize: 32, opacity: 0.3, marginBottom: 8 }}>📭</div>
              No logs yet. Send logs to <code>POST /api/v1/webhooks/logs</code>
            </div>
          ) : (
            <table className="logs-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Sev</th>
                  <th>Score</th>
                  <th>Service</th>
                  <th>Level</th>
                  <th>Message</th>
                  <th>WI</th>
                </tr>
              </thead>
              <tbody>
                {logs.map(log => (
                  <LogRow key={log._id} log={log} />
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        {total > LIMIT && (
          <div className="logs-pagination">
            <button
              className="logs-page-btn"
              disabled={offset === 0}
              onClick={() => setOffset(o => Math.max(0, o - LIMIT))}
            >
              ← Prev
            </button>
            <span className="logs-page-info">
              {offset + 1}–{Math.min(offset + LIMIT, total)} of {total.toLocaleString()}
            </span>
            <button
              className="logs-page-btn"
              disabled={offset + LIMIT >= total}
              onClick={() => setOffset(o => o + LIMIT)}
            >
              Next →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function LogRow({ log }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <tr className={`logs-row logs-row--${(log.classifiedSeverity || 'p3').toLowerCase()}`} onClick={() => setOpen(o => !o)}>
        <td className="log-cell-time">{fmtTime(log.timestamp)}</td>
        <td>
          <span className={`log-sev-badge ${SEV_COLORS[log.classifiedSeverity] || 'log-sev--p3'}`}>
            {log.classifiedSeverity || 'P3'}
          </span>
        </td>
        <td className="log-cell-score">{log.score ?? '—'}</td>
        <td className="log-cell-service">{log.service || '—'}</td>
        <td className="log-cell-level">{log.level || '—'}</td>
        <td className="log-cell-msg">{log.message}</td>
        <td className="log-cell-wi">
          {log.workItemCreated
            ? <span className="log-wi-yes" title="Work item created">✓</span>
            : <span className="log-wi-no">—</span>
          }
        </td>
      </tr>
      {open && (
        <tr className="logs-row-detail">
          <td colSpan={7}>
            <div className="logs-row-meta">
              {log.host && <div><b>Host:</b> {log.host}</div>}
              {log.classifiedSignalType && <div><b>Signal type:</b> {log.classifiedSignalType}</div>}
              {log.componentType && <div><b>Component type:</b> {log.componentType}</div>}
              {log.metadata && Object.keys(log.metadata).length > 0 && (
                <pre className="logs-meta-pre">{JSON.stringify(log.metadata, null, 2)}</pre>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function fmtTime(d) {
  return new Date(d).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
