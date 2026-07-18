import { useState, useEffect, useCallback } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from './Sidebar';
import TopBar from './TopBar';

export default function MonitoringLayout({ onBackToMedia }) {
  const [sidebarMobile, setSidebarMobile] = useState(false);

  const openSidebar = useCallback(() => setSidebarMobile(true), []);
  const closeSidebar = useCallback(() => setSidebarMobile(false), []);

  useEffect(() => {
    if (sidebarMobile) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [sidebarMobile]);

  return (
    <div
      data-debug-id="2.1"
      data-debug-name="MonitoringLayout"
      data-debug-type="container"
      className="flex flex-1 min-h-0 bg-[#0b0d10] text-neutral-200"
    >
      <div className="hidden md:flex">
        <Sidebar onClose={closeSidebar} />
      </div>

      <div
        className={`fixed inset-0 z-50 md:hidden transition-opacity duration-300 ${
          sidebarMobile ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div
          className="absolute inset-0 bg-black/60 transition-opacity duration-300"
          onClick={closeSidebar}
          style={{ opacity: sidebarMobile ? 1 : 0 }}
        />
        <div
          className="absolute left-0 top-0 bottom-0 w-56 transform transition-transform duration-300 ease-out"
          style={{ transform: sidebarMobile ? 'translateX(0)' : 'translateX(-100%)' }}
        >
          <Sidebar onClose={closeSidebar} />
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <TopBar onToggleSidebar={openSidebar} onBackToMedia={onBackToMedia} />

        <div className="flex-1 overflow-y-auto min-w-0">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
