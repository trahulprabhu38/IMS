import React, { useState, useEffect, useRef } from 'react';
import {
  fetchWorkItem, transitionStatus,
  acknowledgeWorkItem, setWorkItemOwner,
  fetchTimeline, fetchAuditLog,
} from '../api/client.js';
import { SeverityBadge, StatusBadge } from './StatusBadge.jsx';
import RCAForm           from './RCAForm.jsx';
import IncidentTimeline  from './IncidentTimeline.jsx';
import AuditLog          from './AuditLog.jsx';
import '../styles/detail.css';
import '../styles/timeline.css';

const TRANSITIONS = {
  OPEN:          ['INVESTIGATING'],
  INVESTIGATING: ['RESOLVED'],
  RESOLVED:      [],
  CLOSED:        [],
};

const TRANSITION_LABELS = {
  INVESTIGATING: 'Begin Investigation',
  RESOLVED:      'Mark Resolved',
};

const SLA_SECONDS = { P0: 300, P1: 900, P2: 3600, P3: 14400 };

export default function IncidentDetail({ workItemId, refreshKey, onUpdated }) {
  const [detail,    setDetail]    = useState(null);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');
  const [showRCA,   setShowRCA]   = useState(false);
  const [actionErr, setActionErr] = useState('');
  const [activeTab, setActiveTab] = useState('signals');
  const [timeline,  setTimeline]  = useState([]);
  const [auditLog,  setAuditLog]  = useState([]);
  const [ownerEdit, setOwnerEdit] = useState(false);
  const [ownerVal,  setOwnerVal]  = useState('');
  const ownerInputRef = useRef(null);

  const loadDetail = (id) => {
    setLoading(true);
    setError('');
    fetchWorkItem(id)
      .then(data => {
        setDetail(data);
        setOwnerVal(data.workItem?.owner || '');
      })
      .catch(() => setError('Failed to load incident.'))
      .finally(() => setLoading(false));
  };

  const loadTimeline = (id) => fetchTimeline(id).then(setTimeline).catch(() => {});
  const loadAudit    = (id) => fetchAuditLog(id).then(setAuditLog).catch(() => {});

  useEffect(() => {
    if (!workItemId) { setDetail(null); setTimeline([]); setAuditLog([]); return; }
    loadDetail(workItemId);
    loadTimeline(workItemId);
    loadAudit(workItemId);
  }, [workItemId]);

  // Reload timeline + audit when WS pushes an escalation/update for this incident
  useEffect(() => {
    if (!workItemId || refreshKey === 0) return;
    loadDetail(workItemId);
    loadTimeline(workItemId);
    loadAudit(workItemId);
  }, [refreshKey]);

  useEffect(() => {
    if (ownerEdit) ownerInputRef.current?.focus();
  }, [ownerEdit]);

  if (!workItemId) return (
    <div className="detail-empty">
      <div className="detail-empty-icon">⚡</div>
      <span>Select an incident to view details</span>
    </div>
  );
  if (loading) return <div className="detail-empty"><span>Loading…</span></div>;
  if (error)   return <div className="detail-empty" style={{ color: '#f87171' }}>{error}</div>;
  if (!detail) return null;

  const { workItem, signals = [], rca } = detail;
  const nextStatuses = TRANSITIONS[workItem.status] || [];

  const handleTransition = async (status) => {
    setActionErr('');
    try {
      const updated = await transitionStatus(workItemId, status);
      setDetail(d => ({ ...d, workItem: updated }));
      onUpdated?.(updated);
      loadTimeline(workItemId);
      loadAudit(workItemId);
    } catch (err) {
      setActionErr(err.response?.data?.error || 'Transition failed');
    }
  };

  const handleRCASubmitted = ({ workItem: closed }) => {
    setShowRCA(false);
    setDetail(d => ({ ...d, workItem: closed }));
    onUpdated?.(closed);
    loadTimeline(workItemId);
    loadAudit(workItemId);
  };

  const handleAck = async () => {
    try {
      const updated = await acknowledgeWorkItem(workItemId, 'user');
      setDetail(d => ({ ...d, workItem: updated }));
      onUpdated?.(updated);
      loadTimeline(workItemId);
      loadAudit(workItemId);
    } catch {}
  };

  const handleOwnerSave = async () => {
    if (!ownerVal.trim()) return;
    try {
      const updated = await setWorkItemOwner(workItemId, ownerVal.trim(), 'user');
      setDetail(d => ({ ...d, workItem: updated }));
      onUpdated?.(updated);
      setOwnerEdit(false);
      loadTimeline(workItemId);
      loadAudit(workItemId);
    } catch {}
  };

  const isOpen = ['OPEN', 'INVESTIGATING'].includes(workItem.status);

  return (
    <div className="detail-root">
      {/* ── Header ── */}
      <div className="detail-header">
        <div className="detail-title">{workItem.title}</div>
        <div className="detail-badges">
          <SeverityBadge severity={workItem.severity} />
          <StatusBadge   status={workItem.status} />
          {workItem.escalated && (
            <span className="escalation-badge">🔺 ESCALATED L{workItem.escalationLevel}</span>
          )}
        </div>
        <div className="detail-meta">
          <span>{workItem.componentType}</span>
          <span className="detail-meta-sep">·</span>
          <span>{workItem.componentId}</span>
          <span className="detail-meta-sep">·</span>
          <span>Started {fmtFull(workItem.startTime)}</span>
          {workItem.mttrSeconds != null && (
            <>
              <span className="detail-meta-sep">·</span>
              <span>MTTR <span className="detail-mttr">{formatMttr(workItem.mttrSeconds)}</span></span>
            </>
          )}
        </div>

        {/* Owner + escalation strip */}
        <div className="owner-strip">
          <span className="owner-label">Owner</span>
          {ownerEdit ? (
            <>
              <input
                ref={ownerInputRef}
                className="owner-edit-input"
                value={ownerVal}
                onChange={e => setOwnerVal(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleOwnerSave(); if (e.key === 'Escape') setOwnerEdit(false); }}
                placeholder="team or name"
              />
              <button className="btn-ack" style={{ marginLeft: 0 }} onClick={handleOwnerSave}>Save</button>
              <button className="btn-ack" style={{ marginLeft: 0, color: 'var(--text-muted)', borderColor: 'var(--border)' }} onClick={() => setOwnerEdit(false)}>Cancel</button>
            </>
          ) : (
            <span className="owner-chip" onClick={() => setOwnerEdit(true)} title="Click to reassign">
              {workItem.owner || 'unassigned'}
            </span>
          )}

          {isOpen && !workItem.acknowledgedAt && (
            <SlaCountdown startTime={workItem.startTime} severity={workItem.severity} />
          )}
          {workItem.acknowledgedAt && (
            <span className="sla-countdown" style={{ color: 'var(--clr-3)' }}>
              ✓ Acked {fmtFull(workItem.acknowledgedAt)}
            </span>
          )}

          {isOpen && !workItem.acknowledgedAt && (
            <button className="btn-ack" onClick={handleAck}>Acknowledge</button>
          )}
        </div>
      </div>

      {/* ── Actions ── */}
      <div className="detail-actions">
        {nextStatuses.map(s2 => (
          <button key={s2} className="btn btn-primary" onClick={() => handleTransition(s2)}>
            {TRANSITION_LABELS[s2] || s2}
          </button>
        ))}
        {workItem.status === 'RESOLVED' && !rca && (
          <button className="btn btn-success" onClick={() => setShowRCA(true)}>
            Submit RCA &amp; Close
          </button>
        )}
      </div>
      {actionErr && <div className="action-error">{actionErr}</div>}

      {/* ── RCA record ── */}
      {rca && (
        <>
          <div className="detail-section">Root Cause Analysis</div>
          <div className="rca-box">
            <div className="rca-row">
              <span className="rca-label">Category</span>
              {rca.root_cause_category}
            </div>
            <div className="rca-row">
              <span className="rca-label">Fix Applied</span>
              {rca.fix_applied}
            </div>
            <div className="rca-row">
              <span className="rca-label">Prevention</span>
              {rca.prevention_steps}
            </div>
            <div className="rca-time-range">
              {fmtFull(rca.incident_start)} → {fmtFull(rca.incident_end)}
            </div>
          </div>
        </>
      )}

      {/* ── Tabs ── */}
      <div className="detail-tabs">
        <button
          className={`detail-tab ${activeTab === 'signals' ? 'detail-tab--active' : ''}`}
          onClick={() => setActiveTab('signals')}
        >
          Signals <span className="detail-section-count">{signals.length}</span>
        </button>
        <button
          className={`detail-tab ${activeTab === 'timeline' ? 'detail-tab--active' : ''}`}
          onClick={() => { setActiveTab('timeline'); loadTimeline(workItemId); }}
        >
          Timeline <span className="detail-section-count">{timeline.length}</span>
        </button>
        <button
          className={`detail-tab ${activeTab === 'audit' ? 'detail-tab--active' : ''}`}
          onClick={() => { setActiveTab('audit'); loadAudit(workItemId); }}
        >
          Audit Log <span className="detail-section-count">{auditLog.length}</span>
        </button>
      </div>

      {/* ── Tab content ── */}
      {activeTab === 'signals' && (
        <div className="signal-list">
          {signals.length === 0
            ? <div className="tl-empty">No signals linked yet.</div>
            : signals.map(sig => <SignalCard key={sig._id} sig={sig} />)
          }
        </div>
      )}

      {activeTab === 'timeline' && (
        <IncidentTimeline events={timeline} />
      )}

      {activeTab === 'audit' && (
        <AuditLog entries={auditLog} />
      )}

      {showRCA && (
        <RCAForm
          workItemId={workItemId}
          workItemTitle={workItem.title}
          onClose={() => setShowRCA(false)}
          onSubmitted={handleRCASubmitted}
        />
      )}
    </div>
  );
}

// ── SLA countdown timer ────────────────────────────────────────────────────────
function SlaCountdown({ startTime, severity }) {
  const sla = SLA_SECONDS[severity] ?? SLA_SECONDS.P3;
  const [remaining, setRemaining] = useState(computeRemaining(startTime, sla));

  useEffect(() => {
    const id = setInterval(() => setRemaining(computeRemaining(startTime, sla)), 1000);
    return () => clearInterval(id);
  }, [startTime, sla]);

  if (remaining <= 0) {
    return <span className="sla-countdown sla-countdown--critical">SLA BREACHED</span>;
  }

  const cls = remaining < 60
    ? 'sla-countdown sla-countdown--critical'
    : remaining < sla * 0.25
    ? 'sla-countdown sla-countdown--warning'
    : 'sla-countdown';

  return (
    <span className={cls} title={`SLA: acknowledge within ${fmtSec(sla)}`}>
      ⏱ {fmtSec(remaining)} to SLA
    </span>
  );
}

function computeRemaining(startTime, slaSec) {
  return slaSec - (Date.now() - new Date(startTime).getTime()) / 1000;
}

function fmtSec(s) {
  if (s <= 0)    return '0s';
  if (s < 60)    return `${Math.round(s)}s`;
  if (s < 3600)  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

// ── Signal card ────────────────────────────────────────────────────────────────
function SignalCard({ sig }) {
  const [open, setOpen] = useState(false);
  const hasPayload = sig.payload && Object.keys(sig.payload).length > 0;

  return (
    <div className="signal-card">
      <div className="signal-card-header" onClick={() => hasPayload && setOpen(o => !o)}>
        <SeverityBadge severity={sig.severity} />
        <span className="signal-type">{sig.signalType}</span>
        <span className="signal-time">{new Date(sig.timestamp).toLocaleTimeString()}</span>
        {hasPayload && (
          <span className={`signal-expand-icon ${open ? 'signal-expand-icon--open' : ''}`}>▶</span>
        )}
      </div>
      {open && hasPayload && (
        <div className="signal-payload">
          <JsonViewer data={sig.payload} />
        </div>
      )}
    </div>
  );
}

function JsonViewer({ data }) {
  return (
    <pre className="json-viewer">
      {renderJson(data, 0)}
    </pre>
  );
}

function renderJson(val, depth) {
  const indent = '  '.repeat(depth);
  const inner  = '  '.repeat(depth + 1);

  if (val === null)             return <span className="json-null">null</span>;
  if (typeof val === 'boolean') return <span className="json-bool">{String(val)}</span>;
  if (typeof val === 'number')  return <span className="json-number">{val}</span>;
  if (typeof val === 'string')  return <span className="json-string">"{val}"</span>;

  if (Array.isArray(val)) {
    if (val.length === 0) return <span className="json-brace">[]</span>;
    return (
      <>
        <span className="json-brace">{'['}</span>{'\n'}
        {val.map((v, i) => (
          <React.Fragment key={i}>
            {inner}{renderJson(v, depth + 1)}{i < val.length - 1 ? <span className="json-brace">,</span> : ''}{'\n'}
          </React.Fragment>
        ))}
        {indent}<span className="json-brace">{']'}</span>
      </>
    );
  }

  if (typeof val === 'object') {
    const keys = Object.keys(val);
    if (keys.length === 0) return <span className="json-brace">{'{}'}</span>;
    return (
      <>
        <span className="json-brace">{'{'}</span>{'\n'}
        {keys.map((k, i) => (
          <React.Fragment key={k}>
            {inner}<span className="json-key">"{k}"</span><span className="json-brace">: </span>
            {renderJson(val[k], depth + 1)}
            {i < keys.length - 1 ? <span className="json-brace">,</span> : ''}{'\n'}
          </React.Fragment>
        ))}
        {indent}<span className="json-brace">{'}'}</span>
      </>
    );
  }

  return <span>{String(val)}</span>;
}

function fmtFull(d) {
  return new Date(d).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatMttr(s) {
  if (s < 60)   return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  return `${(s / 3600).toFixed(1)}h`;
}
