import React, { useState, useEffect, useCallback } from 'react';
import {
  fetchIntegrations,
  configureIntegration,
  testIntegration,
  removeIntegration,
} from '../api/client.js';
import '../styles/integrations.css';

const INT_META = {
  aws:         { label: 'AWS ECS',       icon: '☁️',  desc: 'CloudWatch metrics & ECS cluster',      fields: [{ key: 'region', placeholder: 'us-east-1' }, { key: 'accessKeyId', placeholder: 'Access Key ID' }, { key: 'secretAccessKey', placeholder: 'Secret Access Key', type: 'password' }, { key: 'clusterName', placeholder: 'ECS cluster name (optional)' }] },
  prometheus:  { label: 'Prometheus',    icon: '🔥',  desc: 'Metrics scraping & alerting',            fields: [{ key: 'url', placeholder: 'http://prometheus:9090' }, { key: 'username', placeholder: 'Username (optional)' }, { key: 'password', placeholder: 'Password (optional)', type: 'password' }] },
  alloy:       { label: 'Grafana Alloy', icon: '🌊',  desc: 'Log & telemetry pipeline agent',         fields: [{ key: 'url', placeholder: 'http://alloy:12345' }] },
  loki:        { label: 'Loki',          icon: '📋',  desc: 'Log aggregation & querying',              fields: [{ key: 'url', placeholder: 'http://loki:3100' }, { key: 'token', placeholder: 'Bearer token (optional)', type: 'password' }] },
  uptime_kuma: { label: 'Uptime Kuma',   icon: '🐻',  desc: 'Service uptime monitoring & auto-alerts', fields: [{ key: 'url', placeholder: 'http://uptime-kuma:3001' }, { key: 'apiKey', placeholder: 'API key (optional)', type: 'password' }], webhookPath: '/api/v1/webhooks/uptime-kuma' },
};

export default function IntegrationPanel({ onClose }) {
  const [integrations, setIntegrations] = useState({});
  const [expanded,     setExpanded]     = useState(null);
  const [formValues,   setFormValues]   = useState({});
  const [testResults,  setTestResults]  = useState({});
  const [saving,       setSaving]       = useState({});

  const load = useCallback(() => {
    fetchIntegrations()
      .then(data => {
        setIntegrations(data);
        const initial = {};
        for (const [type, info] of Object.entries(data)) {
          initial[type] = {};
          for (const field of INT_META[type]?.fields || []) {
            initial[type][field.key] = info.config?.[field.key] || '';
          }
        }
        setFormValues(initial);
      })
      .catch(() => {});
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (type) => {
    setSaving(s => ({ ...s, [type]: true }));
    try {
      await configureIntegration(type, formValues[type] || {});
      await load();
    } finally {
      setSaving(s => ({ ...s, [type]: false }));
    }
  };

  const handleTest = async (type) => {
    setTestResults(r => ({ ...r, [type]: { testing: true } }));
    try {
      const result = await testIntegration(type);
      setTestResults(r => ({ ...r, [type]: result }));
      load(); // refresh status
    } catch (err) {
      setTestResults(r => ({ ...r, [type]: { ok: false, message: err.response?.data?.error || 'Connection failed' } }));
    }
  };

  const handleRemove = async (type) => {
    await removeIntegration(type);
    load();
  };

  return (
    <div className="int-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="int-panel">
        <div className="int-panel-header">
          <span className="int-panel-title">Integrations</span>
          <button className="int-panel-close" onClick={onClose}>✕</button>
        </div>

        <div className="int-list">
          {Object.entries(INT_META).map(([type, meta]) => {
            const info      = integrations[type] || {};
            const isOpen    = expanded === type;
            const status    = info.status || 'not_configured';
            const testResult = testResults[type];

            return (
              <div key={type} className="int-card">
                <div className="int-card-header" onClick={() => setExpanded(isOpen ? null : type)}>
                  <span className="int-icon">{meta.icon}</span>
                  <div className="int-info">
                    <div className="int-name">{meta.label}</div>
                    <div className="int-desc">{meta.desc}</div>
                  </div>
                  <StatusChip status={status} />
                </div>

                {isOpen && (
                  <div className="int-config-form">
                    {meta.webhookPath && (
                      <div className="int-webhook-hint">
                        <span className="int-webhook-label">Point your webhook to:</span>
                        <code className="int-webhook-url">
                          {window.location.protocol}//{window.location.hostname}:8000{meta.webhookPath}
                        </code>
                      </div>
                    )}
                    {meta.fields.map(field => (
                      <input
                        key={field.key}
                        className="int-form-input"
                        type={field.type || 'text'}
                        placeholder={field.placeholder}
                        value={formValues[type]?.[field.key] || ''}
                        onChange={e => setFormValues(v => ({
                          ...v,
                          [type]: { ...v[type], [field.key]: e.target.value }
                        }))}
                      />
                    ))}

                    <div className="int-form-actions">
                      <button
                        className="btn-sm btn-sm-primary"
                        onClick={() => handleSave(type)}
                        disabled={saving[type]}
                      >
                        {saving[type] ? 'Saving…' : 'Save'}
                      </button>
                      {info.configured && (
                        <button
                          className="btn-sm btn-sm-test"
                          onClick={() => handleTest(type)}
                          disabled={testResult?.testing}
                        >
                          {testResult?.testing ? 'Testing…' : 'Test'}
                        </button>
                      )}
                      {info.configured && (
                        <button className="btn-sm btn-sm-remove" onClick={() => handleRemove(type)}>
                          Remove
                        </button>
                      )}
                    </div>

                    {testResult && !testResult.testing && (
                      <div className={`int-test-result int-test-result--${testResult.ok ? 'ok' : 'error'}`}>
                        {testResult.ok ? '✓ ' : '✗ '}{testResult.message}
                        {testResult.testedAt && <span style={{ opacity: 0.6, marginLeft: 8 }}>
                          {new Date(testResult.testedAt).toLocaleTimeString()}
                        </span>}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function StatusChip({ status }) {
  const labels = {
    ok:             'Connected',
    error:          'Error',
    unknown:        'Untested',
    not_configured: 'Not Set',
  };
  return (
    <span className={`int-status-badge int-status-badge--${status}`}>
      <span className={`int-chip-dot int-chip-dot--${status === 'ok' ? 'ok' : status === 'error' ? 'error' : 'unknown'}`} />
      {labels[status] || status}
    </span>
  );
}
