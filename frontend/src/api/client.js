import axios from 'axios';

const api = axios.create({ baseURL: 'http://localhost:8000/api/v1' });

// ── Work Items ────────────────────────────────────────────────────────────────
export const fetchWorkItems   = ()              => api.get('/work-items').then(r => r.data);
export const fetchWorkItem    = (id)            => api.get(`/work-items/${id}`).then(r => r.data);
export const transitionStatus = (id, status)    => api.patch(`/work-items/${id}/status`, { status }).then(r => r.data);
export const submitRCA        = (id, rca)       => api.post(`/work-items/${id}/rca`, rca).then(r => r.data);

// ── Health ────────────────────────────────────────────────────────────────────
export const fetchHealth      = ()              => axios.get('http://localhost:8000/health').then(r => r.data);

// ── Integrations ──────────────────────────────────────────────────────────────
export const fetchIntegrations    = ()          => api.get('/integrations').then(r => r.data);
export const configureIntegration = (type, cfg) => api.put(`/integrations/${type}`, cfg).then(r => r.data);
export const testIntegration      = (type)      => api.post(`/integrations/${type}/test`).then(r => r.data);
export const removeIntegration    = (type)      => api.delete(`/integrations/${type}`).then(r => r.data);

// ── Timeline ──────────────────────────────────────────────────────────────────
export const fetchTimeline        = (id)             => api.get(`/work-items/${id}/timeline`).then(r => r.data);

// ── Audit ─────────────────────────────────────────────────────────────────────
export const fetchAuditLog        = (id)             => api.get(`/work-items/${id}/audit`).then(r => r.data);

// ── Ownership + Escalation ────────────────────────────────────────────────────
export const acknowledgeWorkItem  = (id, actor)        => api.post(`/work-items/${id}/acknowledge`, { actor }).then(r => r.data);
export const setWorkItemOwner     = (id, owner, actor)  => api.patch(`/work-items/${id}/owner`, { owner, actor }).then(r => r.data);

// ── Universal log stream ──────────────────────────────────────────────────────
export const fetchLogs     = (params = {}) => api.get('/logs', { params }).then(r => r.data);
export const fetchLogStats = ()            => api.get('/logs/stats').then(r => r.data);
