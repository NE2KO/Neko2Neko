import React, { useState, useEffect, useCallback, useRef } from 'react';
import { formatBytes as formatSize } from '../utils/format.js';

export default function DuplicateConfirmModal({ duplicates, onDecision, onCancel, inTransfer = false, applyAllActive = false, totalPendingConflicts = 0 }) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [selectedAction, setSelectedAction] = useState('overwrite');
  const [renameValue, setRenameValue] = useState('');
  const [applyToAll, setApplyToAll] = useState(false);
  const renameRef = useRef(null);

  // CRITICAL: if applyAll is active, don't render
  if (applyAllActive) return null;

  const current = duplicates[currentIndex];
  // Use totalPendingConflicts for applyAll count, else remaining from duplicates
  const remaining = applyToAll ? totalPendingConflicts : duplicates.length - currentIndex;

  useEffect(() => {
    if (current) {
      setRenameValue(current.name || '');
      setSelectedAction('overwrite');
    }
  }, [currentIndex, current?.name]);

  useEffect(() => {
    if (selectedAction === 'rename' && renameRef.current) {
      renameRef.current.focus();
      renameRef.current.select();
    }
  }, [selectedAction]);

  const handleSubmit = useCallback(() => {
    if (!current) return;

    if (applyToAll) {
      // Single decision for current file + applyAll flag for backend
      const decision = {
        source: current.source,
        devicePath: current.devicePath,
        name: current.name,
        action: selectedAction,
        newName: selectedAction === 'rename' ? renameValue : undefined,
        newDst: selectedAction === 'rename' && current.devicePath
          ? current.devicePath.substring(0, current.devicePath.lastIndexOf('/') + 1) + renameValue
          : undefined,
      };
      onDecision([decision], true, true);
      return;
    }

    // Single file decision
    const decision = {
      source: current.source,
      devicePath: current.devicePath,
      name: current.name,
      action: selectedAction,
      newName: selectedAction === 'rename' ? renameValue : undefined,
      newDst: selectedAction === 'rename' && current.devicePath
        ? current.devicePath.substring(0, current.devicePath.lastIndexOf('/') + 1) + renameValue
        : undefined,
    };

    if (currentIndex < duplicates.length - 1) {
      setCurrentIndex(prev => prev + 1);
      onDecision([decision], false, false);
    } else {
      onDecision([decision], true, false);
    }
  }, [current, selectedAction, renameValue, applyToAll, duplicates, currentIndex, onDecision]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
      if (e.key === 'Enter' && selectedAction !== 'rename') {
        e.preventDefault();
        handleSubmit();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedAction, handleSubmit, onCancel]);

  if (!current) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onCancel} />

      {/* Modal */}
      <div
        className="relative bg-neutral-900 border border-neutral-700/50 rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
        style={{ animation: 'fadeInScale 0.15s ease-out' }}
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-3">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center flex-shrink-0">
              <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4.5c-.77-.833-2.694-.833-3.464 0L3.34 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-neutral-100">
                {inTransfer ? 'Transfer paused — file exists' : 'File Conflict Detected'}
              </h3>
              <p className="text-xs text-neutral-400 mt-0.5">
                {inTransfer ? 'Queue paused until you decide' : `${remaining} file${remaining !== 1 ? 's' : ''} to resolve`}
              </p>
            </div>
          </div>

          {/* Target path */}
          {current.devicePath && (
            <div className="text-[10px] text-neutral-500 mb-2 font-mono truncate">
              Target: {current.devicePath.substring(0, current.devicePath.lastIndexOf('/') + 1)}
            </div>
          )}

          {/* File info */}
          <div className="bg-neutral-800/60 border border-neutral-700/30 rounded-lg p-3 mb-4">
            <div className="flex items-center gap-2 mb-1">
              <svg className="w-4 h-4 text-neutral-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span className="text-xs font-medium text-neutral-200 truncate">{current.name}</span>
            </div>
            <div className="flex items-center gap-3 text-[10px] text-neutral-500">
              <span>On device: {formatSize(current.size)}</span>
            </div>
          </div>

          <p className="text-xs text-neutral-400 mb-3">What do you want to do?</p>

          {/* Action buttons */}
          <div className="flex flex-col gap-2">
            {[
              { key: 'overwrite', label: 'Overwrite', desc: 'Replace the file on device' },
              { key: 'skip', label: 'Skip', desc: 'Ignore this file, continue queue' },
              { key: 'rename', label: 'Rename automatically', desc: 'Add (copy) or (1) suffix' },
            ].map(opt => (
              <button
                key={opt.key}
                onClick={() => setSelectedAction(opt.key)}
                className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-lg border text-left transition-all ${
                  selectedAction === opt.key
                    ? 'bg-sky-500/10 border-sky-500/50 text-sky-300'
                    : 'bg-neutral-800/40 border-neutral-700/30 text-neutral-300 hover:border-neutral-600'
                }`}
              >
                <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${
                  selectedAction === opt.key ? 'border-sky-400' : 'border-neutral-600'
                }`}>
                  {selectedAction === opt.key && <div className="w-2 h-2 rounded-full bg-sky-400" />}
                </div>
                <div>
                  <div className="text-xs font-medium">{opt.label}</div>
                  <div className="text-[10px] opacity-60">{opt.desc}</div>
                </div>
              </button>
            ))}
          </div>

          {/* Apply to all checkbox */}
          <label className="flex items-center gap-2 mt-4 cursor-pointer select-none">
            <div
              onClick={() => setApplyToAll(!applyToAll)}
              className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${
                applyToAll
                  ? 'bg-sky-500 border-sky-500'
                  : 'border-neutral-600 hover:border-neutral-400'
              }`}
            >
              {applyToAll && (
                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              )}
            </div>
            <span className="text-xs text-neutral-400">Apply to all files in this queue</span>
          </label>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-neutral-800 bg-neutral-900/50">
          <button
            onClick={onCancel}
            className="px-4 py-1.5 text-xs text-neutral-400 hover:text-neutral-200 rounded border border-neutral-700 hover:border-neutral-500 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            className="px-4 py-1.5 text-xs text-white bg-sky-600 hover:bg-sky-500 rounded transition-colors"
          >
            {applyToAll ? `Apply to all (${remaining})` : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  );
}
