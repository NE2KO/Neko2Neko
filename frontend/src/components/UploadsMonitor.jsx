import React, { useCallback } from 'react';
import { useUploadQueueLogic } from '../hooks/useUploadQueueLogic';
import { X, ChevronRight, AlertCircle } from 'lucide-react'; // Import necessary icons

export default function UploadsMonitor() {
  const { uploads, removeUpload, deleteUploadFile, cancelUpload, formatSize, formatSpeed, formatEta, statusColors, statusIcons } = useUploadQueueLogic();

  const handleDismiss = useCallback((id) => {
    // This is for visual dismissal from the list, not cancelling the upload
    removeUpload(id);
  }, [removeUpload]);

  return (
    <div data-debug-id="A.7" data-debug-name="UploadsMonitor" data-debug-type="panel" className="flex-1 flex flex-col p-4 overflow-hidden">
      <h2 className="text-xl font-semibold text-neutral-200 mb-6">Uploads Monitoring</h2>

      {/* Summary Statistics */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
        <div className="bg-neutral-800/60 border border-neutral-700/50 rounded-lg p-3 text-center">
          <p className="text-xs text-neutral-400">Total Uploads</p>
          <p className="text-lg font-bold text-neutral-200">{uploads.length}</p>
        </div>
        <div className="bg-neutral-800/60 border border-neutral-700/50 rounded-lg p-3 text-center">
          <p className="text-xs text-neutral-400">Active</p>
          <p className="text-lg font-bold text-cyan-400">{uploads.filter(u => u.status === 'uploading' || u.status === 'processing' || u.status === 'pending').length}</p>
        </div>
        <div className="bg-neutral-800/60 border border-neutral-700/50 rounded-lg p-3 text-center">
          <p className="text-xs text-neutral-400">Completed</p>
          <p className="text-lg font-bold text-green-400">{uploads.filter(u => u.status === 'completed').length}</p>
        </div>
        <div className="bg-neutral-800/60 border border-neutral-700/50 rounded-lg p-3 text-center">
          <p className="text-xs text-neutral-400">Failed</p>
          <p className="text-lg font-bold text-red-400">{uploads.filter(u => u.status === 'failed').length}</p>
        </div>
        <div className="bg-neutral-800/60 border border-neutral-700/50 rounded-lg p-3 text-center">
          <p className="text-xs text-neutral-400">Cancelled</p>
          <p className="text-lg font-bold text-neutral-500">{uploads.filter(u => u.status === 'cancelled').length}</p>
        </div>
      </div>

      {uploads.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-full text-neutral-500">
          <UploadsIcon size={48} className="mb-4" /> {/* Placeholder icon */}
          <p>No active or recent uploads to display.</p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto pr-2">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {uploads.map(u => (
              <div key={u.id} data-debug-id="A.7.1" data-debug-name="UploadItem" data-debug-type="card" className="bg-neutral-800/60 border border-neutral-700/50 rounded-lg p-4 flex flex-col relative">
                {u.status !== 'uploading' && u.status !== 'processing' && (
                  <button onClick={() => handleDismiss(u.id)} className="absolute top-2 right-2 p-1 text-neutral-500 hover:text-neutral-200">
                    <X size={16} />
                  </button>
                )}
                <div className="flex items-center gap-3 mb-2">
                  <span className={`text-2xl ${statusColors[u.status] || 'text-neutral-500'}`}>
                    {statusIcons[u.status] || <AlertCircle />}
                  </span>
                  <h3 className="text-sm font-medium text-neutral-200 truncate flex-1">{u.filename}</h3>
                </div>

                <div className="text-xs text-neutral-400 mb-3 flex items-center gap-1">
                  Status: <span className={statusColors[u.status] || 'text-neutral-500'}>{u.status}</span>
                  {u.error && <span className="text-red-400/70 ml-2 truncate">{u.error}</span>}
                </div>

                {u.status === 'uploading' && (
                  <>
                    <div className="w-full h-2 bg-neutral-700 rounded-full mb-2">
                      <div
                        className="h-full rounded-full transition-all duration-300"
                        style={{
                          width: `${Math.min(u.progress, 100)}%`,
                          background: 'linear-gradient(90deg, #3b82f6, #60a5fa)',
                        }}
                      />
                    </div>
                    <div className="flex justify-between text-[11px] text-neutral-400 mb-3">
                      <span>{Math.round(u.progress)}%</span>
                      <span>{formatSize(u.uploaded)} / {formatSize(u.size)}</span>
                    </div>
                    <div className="flex justify-between text-[11px] text-neutral-500">
                      <span>Speed: {formatSpeed(u.speed)}</span>
                      <span>ETA: {formatEta(u.eta)}</span>
                    </div>
                    <button onClick={() => cancelUpload(u.id)} className="mt-3 px-3 py-1 text-xs text-red-400 border border-red-500/50 rounded hover:bg-red-500/10 transition-colors">
                      Cancel Upload
                    </button>
                  </>
                )}
                 {(u.status === 'completed' || u.status === 'failed' || u.status === 'cancelled') && (
                  <div className="flex justify-end gap-2 mt-2">
                    <button onClick={() => handleDismiss(u.id)} className="px-3 py-1 text-xs text-neutral-500 border border-neutral-700 rounded hover:bg-neutral-700/30 transition-colors">
                      Dismiss
                    </button>
                    <button onClick={() => deleteUploadFile(u.id)} className="px-3 py-1 text-xs text-red-400 border border-red-500/50 rounded hover:bg-red-500/10 transition-colors">
                      Delete File
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function UploadsIcon(props) {
  return (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-upload">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" x2="12" y1="3" y2="15"/>
    </svg>
  );
}