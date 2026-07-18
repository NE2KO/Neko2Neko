import React, { useEffect, useMemo, Suspense, lazy, useState, useRef } from 'react';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import MonitoringLayout from '../monitoring/layout/MonitoringLayout';
import useWebSocket from '../hooks/useWebSocket';

// Auto-reload on stale chunk errors (Vite dev server restarted)
if (typeof window !== 'undefined') {
  const origHandler = window.onunhandledrejection;
  window.addEventListener('unhandledrejection', (event) => {
    const msg = event.reason?.message || '';
    if (msg.includes('Failed to fetch dynamically imported module') || msg.includes('dynamically imported module')) {
      event.preventDefault();
      console.warn('[ChunkLoad] Stale chunk detected, reloading...');
      window.location.reload();
    }
  });
}

const Overview = retryLazy(() => import('../monitoring/pages/Overview'));

function retryLazy(importFn) {
  return lazy(() =>
    importFn().catch(() => {
      return new Promise(resolve => {
        setTimeout(() => resolve(importFn()), 1500);
      });
    })
  );
}

const MetricsTable = retryLazy(() => import('../monitoring/pages/MetricsTable'));
const ServiceControlPage = retryLazy(() => import('../monitoring/pages/ServiceControlPage'));
const ServicesPage = retryLazy(() => import('../monitoring/pages/ServicesPage'));
const ProcessesPage = retryLazy(() => import('../monitoring/pages/ProcessesPage'));
const TasksPage = retryLazy(() => import('../monitoring/pages/TasksPage'));
const StoragePage = retryLazy(() => import('../monitoring/pages/StoragePage'));
const NetworkPage = retryLazy(() => import('../monitoring/pages/NetworkPage'));
const LogsPage = retryLazy(() => import('../monitoring/pages/LogsPage'));
const AlertsPage = retryLazy(() => import('../monitoring/pages/AlertsPage'));
const MediaStatsPage = retryLazy(() => import('../monitoring/pages/MediaStatsPage'));
const SettingsPage = retryLazy(() => import('../monitoring/pages/SettingsPage'));

function RouterSync() {
  const location = useLocation();

  useEffect(() => {
    const subPath = location.pathname === '/' ? '' : location.pathname.slice(1);
    const desiredHash = '#/monitoring' + (subPath ? '/' + subPath : '');

    if (window.location.hash !== desiredHash) {
      window.history.replaceState({}, '', desiredHash);
    }

    try {
      if (subPath) {
        sessionStorage.setItem('monitoringSubPath', subPath);
      } else {
        sessionStorage.removeItem('monitoringSubPath');
      }
    } catch {}
  }, [location]);

  return null;
}

function LoadingFallback() {
  return (
    <div className="p-6 flex items-center justify-center">
      <div className="h-1 w-32 bg-cyan-500/20 rounded animate-pulse" />
    </div>
  );
}

export default function MonitoringView({ onBackToMedia }) {
  const raw = window.location.hash.slice(1) || '/';
  const cleaned = raw.replace(/^\/+/, '');

  const [ready, setReady] = useState(false);
  const readyPollRef = useRef(null);

  const initialPath = useMemo(() => {
    let path = '/';

    if (cleaned.startsWith('monitoring')) {
      const rest = cleaned.slice('monitoring'.length).replace(/^\/+/, '');
      if (rest) {
        if (rest === 'hardware') {
          sessionStorage.removeItem('monitoringSubPath');
          window.history.replaceState({}, '', '#/monitoring');
        } else {
          path = '/' + rest;
        }
      } else {
        try {
          const savedSub = sessionStorage.getItem('monitoringSubPath');
          if (savedSub) {
            if (savedSub === 'hardware') {
              sessionStorage.removeItem('monitoringSubPath');
            } else {
              path = '/' + savedSub;
            }
          }
        } catch {}
      }
    }

    return path;
  }, [cleaned]);

  // Poll /api/ready until backend is ready
  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch('/api/ready');
        if (res.ok) {
          const data = await res.json();
          if (data.state === 'ready') {
            setReady(true);
            return;
          }
        }
      } catch {}
      readyPollRef.current = setTimeout(poll, 1000);
    };
    poll();
    return () => {
      if (readyPollRef.current) clearTimeout(readyPollRef.current);
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    const desiredHash = '#/monitoring' + (initialPath === '/' ? '' : initialPath);
    if (window.location.hash !== desiredHash) {
      window.history.replaceState({}, '', desiredHash);
    }
    if (window.location.hash === '#') {
      window.history.replaceState({}, '', '#/media');
    }
  }, [initialPath, ready]);

  useWebSocket();

  return (
    <ErrorBoundary title="Monitoring Error">
      {ready ? (
        <MemoryRouter initialEntries={[initialPath]} initialIndex={0}>
          <RouterSync />
          <Suspense fallback={<LoadingFallback />}>
            <Routes>
              <Route element={<MonitoringLayout onBackToMedia={onBackToMedia} />}>
                <Route index element={<Overview />} />
                <Route path="metrics" element={<MetricsTable />} />
                <Route path="service-control" element={<ServiceControlPage />} />
                <Route path="services" element={<ServicesPage />} />
                <Route path="processes" element={<ProcessesPage />} />
                <Route path="tasks" element={<TasksPage />} />
                <Route path="storage" element={<StoragePage />} />
                <Route path="network" element={<NetworkPage />} />
                <Route path="logs" element={<LogsPage />} />
                <Route path="alerts" element={<AlertsPage />} />
                <Route path="media" element={<MediaStatsPage />} />
                <Route path="settings" element={<SettingsPage />} />
              </Route>
            </Routes>
          </Suspense>
        </MemoryRouter>
      ) : (
        <div className="h-full flex items-center justify-center bg-[#0b0d10]">
          <div className="text-center">
            <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin mx-auto mb-4" />
            <p className="text-sm text-neutral-400">Menunggu server siap...</p>
          </div>
        </div>
      )}
    </ErrorBoundary>
  );
}
