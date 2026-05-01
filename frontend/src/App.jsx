import React, { useState, useEffect, useCallback } from 'react';
import { fetchWorkItems, fetchIntegrations } from './api/client.js';
import { useWebSocket }                      from './hooks/useWebSocket.js';
import Sidebar, { FILTERS }                  from './components/Sidebar.jsx';
import LiveFeed                              from './components/LiveFeed.jsx';
import IncidentDetail                        from './components/IncidentDetail.jsx';
import IntegrationPanel                      from './components/IntegrationPanel.jsx';
import LogsViewer                            from './components/LogsViewer.jsx';
import './styles/layout.css';

const FILTER_STATUS = Object.fromEntries(FILTERS.map(f => [f.key, f.statuses]));

export default function App() {
  const [workItems,       setWorkItems]       = useState([]);
  const [selectedId,      setSelectedId]      = useState(null);
  const [wsConnected,     setWsConnected]     = useState(false);
  const [activeFilter,    setActiveFilter]    = useState('all');
  const [sidebarOpen,     setSidebarOpen]     = useState(true);
  const [showIntPanel,    setShowIntPanel]    = useState(false);
  const [integrations,    setIntegrations]    = useState({});
  const [detailRefresh,   setDetailRefresh]   = useState(0);
  const [showLogs,        setShowLogs]        = useState(false);

  // ── Data loading ────────────────────────────────────────────────────────────
  const loadWorkItems = useCallback(() => {
    fetchWorkItems().then(setWorkItems).catch(console.error);
  }, []);

  const loadIntegrations = useCallback(() => {
    fetchIntegrations().then(setIntegrations).catch(() => {});
  }, []);

  useEffect(() => {
    loadWorkItems();
    loadIntegrations();
    const id = setInterval(loadIntegrations, 30_000);
    return () => clearInterval(id);
  }, [loadWorkItems, loadIntegrations]);

  // ── WebSocket ───────────────────────────────────────────────────────────────
  const handleWsMessage = useCallback((msg) => {
    if (msg.type === 'WORK_ITEM_CREATED') {
      setWorkItems(prev => prev.some(w => w.id === msg.payload.id) ? prev : [msg.payload, ...prev]);
    }
    if (msg.type === 'WORK_ITEM_UPDATED') {
      setWorkItems(prev => prev.map(w => w.id === msg.payload.id ? msg.payload : w));
      setSelectedId(cur => {
        if (cur === msg.payload.id) setDetailRefresh(n => n + 1);
        return cur;
      });
    }
  }, []);

  useWebSocket(handleWsMessage, {
    onOpen:  () => setWsConnected(true),
    onClose: () => setWsConnected(false),
  });

  // ── Filtering + sorting ─────────────────────────────────────────────────────
  const rank = { P0: 0, P1: 1, P2: 2, P3: 3 };
  const sorted = [...workItems].sort((a, b) =>
    (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3) ||
    new Date(b.startTime) - new Date(a.startTime)
  );
  const statuses = FILTER_STATUS[activeFilter];
  const filtered = statuses ? sorted.filter(w => statuses.includes(w.status)) : sorted;

  // ── Integration status summary ──────────────────────────────────────────────
  const INT_KEYS = ['aws', 'prometheus', 'alloy', 'loki', 'uptime_kuma'];
  const INT_LABELS = { aws: 'AWS', prometheus: 'Prom', alloy: 'Alloy', loki: 'Loki', uptime_kuma: 'Uptime' };

  const togglePos = sidebarOpen ? 260 : 0;

  return (
    <div className="app-shell">
      {/* Topbar */}
      <header className="topbar">
        <div className="topbar-logo">IMS — Incident Management</div>

        <div className="topbar-right">
          {/* Integration chips */}
          <div className="int-chips">
            {INT_KEYS.map(k => {
              const st = integrations[k]?.status || 'not_configured';
              const dotCls = st === 'ok' ? 'int-chip-dot--ok' : st === 'error' ? 'int-chip-dot--error' : 'int-chip-dot--unknown';
              return (
                <button key={k} className="int-chip" title={`${k} — ${st}`} onClick={() => setShowIntPanel(true)}>
                  <span className={`int-chip-dot ${dotCls}`} />
                  {INT_LABELS[k]}
                </button>
              );
            })}
          </div>

          {/* Log stream button */}
          <button className="topbar-logs-btn" onClick={() => setShowLogs(true)} title="Open log stream">
            📡 Logs
          </button>

          {/* WS status */}
          <div className="ws-status">
            <span className={`ws-dot ${wsConnected ? 'ws-dot--connected' : 'ws-dot--disconnected'}`} />
            <span className={wsConnected ? 'ws-label--connected' : 'ws-label--disconnected'}>
              {wsConnected ? 'Live' : 'Connecting…'}
            </span>
            <span className="topbar-count">{workItems.length} incidents</span>
          </div>
        </div>
      </header>

      {/* Main */}
      <div className="main">
        {/* Sidebar collapse toggle */}
        <button
          className="sidebar-toggle"
          style={{ left: togglePos }}
          onClick={() => setSidebarOpen(o => !o)}
          title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          {sidebarOpen ? '‹' : '›'}
        </button>

        {/* Sidebar */}
        <div className={`sidebar-wrapper ${sidebarOpen ? '' : 'sidebar-wrapper--collapsed'}`}>
          <Sidebar
            workItems={workItems}
            activeFilter={activeFilter}
            onFilterChange={setActiveFilter}
            onSelectHistory={setSelectedId}
          />
        </div>

        {/* Incident list */}
        <div className="feed-panel">
          <LiveFeed
            workItems={filtered}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
        </div>

        {/* Incident detail */}
        <section className="detail-panel">
          <IncidentDetail
            workItemId={selectedId}
            refreshKey={detailRefresh}
            onUpdated={(updated) => setWorkItems(prev => prev.map(w => w.id === updated.id ? updated : w))}
          />
        </section>
      </div>

      {/* Integration panel */}
      {showIntPanel && (
        <IntegrationPanel
          onClose={() => { setShowIntPanel(false); loadIntegrations(); }}
        />
      )}

      {/* Log stream viewer */}
      {showLogs && (
        <LogsViewer onClose={() => setShowLogs(false)} />
      )}
    </div>
  );
}
