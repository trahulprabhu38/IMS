import React, { useState } from 'react';
import { submitRCA } from '../api/client.js';
import '../styles/rca.css';

const ROOT_CAUSE_OPTIONS = ['INFRASTRUCTURE', 'SOFTWARE_BUG', 'HUMAN_ERROR', 'CAPACITY', 'EXTERNAL'];

export default function RCAForm({ workItemId, workItemTitle, onClose, onSubmitted }) {
  const now = new Date().toISOString().slice(0, 16);
  const [form, setForm] = useState({
    incidentStart:     now,
    incidentEnd:       now,
    rootCauseCategory: 'INFRASTRUCTURE',
    fixApplied:        '',
    preventionSteps:   '',
  });
  const [error,   setError]   = useState('');
  const [loading, setLoading] = useState(false);

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    if (new Date(form.incidentEnd) <= new Date(form.incidentStart)) {
      return setError('Incident end must be after incident start.');
    }
    setLoading(true);
    try {
      const result = await submitRCA(workItemId, {
        ...form,
        incidentStart: new Date(form.incidentStart).toISOString(),
        incidentEnd:   new Date(form.incidentEnd).toISOString(),
      });
      onSubmitted(result);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to submit RCA. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rca-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="rca-modal">
        <div className="rca-modal-title">Submit Root Cause Analysis</div>
        <div className="rca-modal-subtitle">
          Incident: <strong>{workItemTitle}</strong>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Incident Start</label>
              <input type="datetime-local" className="form-input" value={form.incidentStart} onChange={set('incidentStart')} required />
            </div>
            <div className="form-group">
              <label className="form-label">Incident End</label>
              <input type="datetime-local" className="form-input" value={form.incidentEnd} onChange={set('incidentEnd')} required />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Root Cause Category</label>
            <select className="form-select" value={form.rootCauseCategory} onChange={set('rootCauseCategory')} required>
              {ROOT_CAUSE_OPTIONS.map(o => (
                <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Fix Applied</label>
            <textarea
              className="form-textarea"
              value={form.fixApplied}
              onChange={set('fixApplied')}
              placeholder="Describe exactly what was done to resolve the incident…"
              required
            />
          </div>

          <div className="form-group">
            <label className="form-label">Prevention Steps</label>
            <textarea
              className="form-textarea"
              value={form.preventionSteps}
              onChange={set('preventionSteps')}
              placeholder="What will prevent this from happening again?"
              required
            />
          </div>

          {error && <div className="form-error">{error}</div>}

          <div className="rca-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>Cancel</button>
            <button type="submit" className={`btn btn-primary btn-sm ${loading ? 'btn-disabled' : ''}`} disabled={loading}>
              {loading ? 'Submitting…' : 'Submit RCA & Close'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
