import React, { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, X, File as FileIcon } from 'lucide-react';
import { getThumbnailUrl } from '../utils/api';

const MONTHS = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
const DAYS = ['Min','Sen','Sel','Rab','Kam','Jum','Sab'];

// Slot-grid column count for a given perDay, matching the requested layout:
// 1 -> 1     2 -> 1 2        3 -> 1 2 3
// 4 -> 1 2 / 3 4 (2 cols)    5 -> 1 2 3 / 4 5 (3 cols)
// 6 -> 1 2 3 / 4 5 6 (3 cols)
function colsForPerDay(n) {
  if (n <= 3) return n;
  if (n === 4) return 2;
  return 3;
}

function pad(n) { return String(n).padStart(2, '0'); }

function startOfDay(d) {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}

function sameDay(a, b) {
  if (!a || !b) return false;
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// Real send ETA of an item. Most pending items have scheduled_at = NULL, so
// their true slot comes from the backend timeline (etaMap). Fall back to the
// literal scheduled_at / hold_until for held/scheduled items.
function itemEta(it, etaMap) {
  if (etaMap && it.qid != null && etaMap[it.qid]) return Number(etaMap[it.qid]);
  const sched = it.scheduled_at ? Number(it.scheduled_at) : 0;
  const hold = Number(it.hold_until) || 0;
  return sched || hold || 0;
}

function getItemsForDate(items, dateStr, etaMap) {
  if (!items || !dateStr) return [];
  return items.filter(it => {
    if (it.status !== 'pending' && it.status !== 'processing') return false;
    const eta = itemEta(it, etaMap);
    if (!eta) return false;
    const d = new Date(eta);
    const ds = `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    return ds === dateStr;
  });
}

function getSlotsForDay(perDay, now) {
  if (!perDay || perDay <= 0) return [];
  const interval = (24 / perDay) * 60 * 60 * 1000;
  const start = startOfDay(now).getTime();
  const slots = [];
  for (let i = 0; i < perDay; i++) {
    slots.push(start + i * interval);
  }
  return slots;
}

// Which item occupies each slot of a given day. Returns an array of length
// perDay (occupant item or null). Slots are matched by index off the day start.
function getSlotOccupants(perDay, dateObj, items, etaMap) {
  const result = new Array(perDay).fill(null);
  if (!perDay || perDay <= 0 || !items) return result;
  const interval = (24 / perDay) * 60 * 60 * 1000;
  const dayStart = startOfDay(dateObj).getTime();
  const dayEnd = dayStart + 24 * 3600 * 1000;
  for (const it of items) {
    if (it.status !== 'pending' && it.status !== 'processing') continue;
    const eta = itemEta(it, etaMap);
    if (!eta || eta < dayStart || eta >= dayEnd) continue;
    const idx = Math.floor((eta - dayStart) / interval);
    if (idx >= 0 && idx < perDay && !result[idx]) result[idx] = it;
  }
  return result;
}

// Popover shown on hover (and kept open while a date is pinned via click),
// portaled to document.body so it is never clipped by the modal (which uses
// overflow-hidden) and never shifts the calendar layout (no flicker). Hover and
// click show the SAME interactive UI: a date with items shows the items grid,
// an empty date shows the clickable slot picker with a confirm button.
function DayPopover({ dateStr, slots, occupants, dayItems, targetQid, selectedSlot, onSelectSlot, onConfirm, loading, anchor, onHoverChange, etaMap = {} }) {
  if (!anchor) return null;
  const d = new Date(dateStr + 'T00:00:00');
  const dayName = DAYS[d.getDay()];
  const dateLabel = `${dayName}, ${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;

  // Adaptive width: grows on wide viewports, never wider than the screen.
  const popW = Math.min(560, Math.max(360, Math.round(vw * 0.92)));
  const gridCols = colsForPerDay(slots ? slots.length : 3);
  const showBelow = anchor.top < vh / 2;
  let left = anchor.left + anchor.width / 2;
  left = Math.max(popW / 2 + 8, Math.min(left, vw - popW / 2 - 8));

  const style = {
    position: 'fixed',
    zIndex: 90,
    left,
    width: popW,
    transform: 'translateX(-50%)',
    ...(showBelow ? { top: anchor.bottom + 8 } : { bottom: vh - anchor.top + 8 }),
  };

  return createPortal(
    <div
      style={style}
      className="bg-neutral-800 border border-neutral-700 rounded-xl shadow-2xl"
      onMouseEnter={() => onHoverChange(dateStr)}
      onMouseLeave={() => onHoverChange(null)}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-700/60">
        <span className="text-[11px] font-semibold text-neutral-200">{dateLabel}</span>
        {dayItems && dayItems.length > 0 && (
          <span className="text-[10px] text-neutral-400">{dayItems.length} jadwal</span>
        )}
      </div>

      <div className="p-2.5 grid gap-2 max-h-[70vh] overflow-y-auto" style={{ gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` }}>
        {slots.map((slotTs, i) => {
            const sd = new Date(slotTs);
            const timeLabel = `${pad(sd.getHours())}:${pad(sd.getMinutes())}`;
            const isPast = slotTs < Date.now();
            const occupant = occupants[i];
            const isSelf = occupant && targetQid != null && occupant.qid === targetQid;
            const isSelected = selectedSlot === slotTs;
            const clickable = !isPast && !isSelf;
            return (
              <button
                key={slotTs}
                type="button"
                disabled={!clickable}
                onClick={() => clickable && onSelectSlot(slotTs)}
                className={`flex flex-col gap-1.5 rounded-lg p-2 text-left transition-all border
                  ${isSelected ? 'border-cyan-400 ring-1 ring-cyan-400/50 bg-cyan-500/10' : 'border-neutral-700 bg-neutral-900/40'}
                  ${clickable ? 'hover:border-neutral-500 cursor-pointer' : ''}
                  ${isPast ? 'opacity-40 cursor-not-allowed' : ''}
                  ${isSelf ? 'opacity-70 cursor-not-allowed border-dashed' : ''}`}
              >
                <span className={`text-[12px] font-semibold ${isSelected ? 'text-cyan-300' : 'text-neutral-300'}`}>{timeLabel}</span>
                {occupant ? (
                  <div className="flex items-center gap-2">
                    <div className="w-10 h-10 rounded-md bg-neutral-700 overflow-hidden flex-shrink-0">
                      {occupant.file_id ? (
                        <img src={getThumbnailUrl({ id: occupant.file_id })} alt="" className="w-full h-full object-cover" onError={(e) => { e.currentTarget.style.display = 'none'; }} />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-neutral-500">
                          <FileIcon size={14} />
                        </div>
                      )}
                    </div>
                    <span className="text-[11px] text-neutral-300 truncate w-full leading-tight">
                      {isSelf ? 'Item ini' : occupant.name}
                    </span>
                  </div>
                ) : (
                  <div className="flex items-center justify-center h-10 rounded-md border border-dashed border-neutral-600">
                    <span className="text-[10px] text-neutral-500">Kosong</span>
                  </div>
                )}
              </button>
            );
          })}
        </div>

      <div className="px-2 py-2 border-t border-neutral-700/60">
          <button
            type="button"
            onClick={onConfirm}
            disabled={!selectedSlot || loading}
            className="w-full py-2 rounded-lg bg-cyan-500 text-white text-sm font-medium hover:bg-cyan-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? 'Menyimpan...' : 'Jadwalkan'}
          </button>
        </div>
    </div>,
    document.body
  );
}

export default function RescheduleModal({ open, item, allItems, etaMap = {}, onClose, onConfirm }) {
  const today = startOfDay(new Date());
  const [currentMonth, setCurrentMonth] = useState(() => {
    const d = startOfDay(new Date());
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [pinnedDate, setPinnedDate] = useState(null);
  const [hoveredDate, setHoveredDate] = useState(null);
  const [anchor, setAnchor] = useState(null);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [perDay, setPerDay] = useState(3);
  const [loading, setLoading] = useState(false);
  const [gridFade, setGridFade] = useState('opacity-100');
  const monthTimerRef = useRef(null);
  const settingsRef = useRef(null);

  useEffect(() => {
    return () => clearTimeout(monthTimerRef.current);
  }, []);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    (async () => {
      try {
        const res = await fetch('/api/send/settings');
        const data = await res.json();
        if (alive && data && data.settings) {
          settingsRef.current = data.settings;
          setPerDay(data.settings.perDay || 3);
        }
      } catch {}
    })();
    return () => { alive = false; };
  }, [open]);

  // ESC must close THIS modal first, not the player behind it. The player
  // (SendQueuePlayer) also listens for Escape on window (bubble phase) to close
  // itself. By listening in the CAPTURE phase and stopping immediate propagation
  // we intercept the key before the player's listener runs, so only the modal
  // closes while the player stays open. When the modal is closed this effect is
  // cleaned up, so ESC falls through to the player as before.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  useEffect(() => {
    if (open) {
      setPinnedDate(null);
      setHoveredDate(null);
      setAnchor(null);
      setSelectedSlot(null);
      setGridFade('opacity-100');
      setCurrentMonth(() => {
        const d = startOfDay(new Date());
        return new Date(d.getFullYear(), d.getMonth(), 1);
      });
    }
  }, [open, item?.qid]);

  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();

  const calendarDays = useMemo(() => {
    const firstDay = new Date(year, month, 1);
    const startWeekday = firstDay.getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const daysInPrevMonth = new Date(year, month, 0).getDate();
    const cells = [];
    for (let i = startWeekday - 1; i >= 0; i--) {
      cells.push({ day: daysInPrevMonth - i, month: month - 1, year, isCurrentMonth: false });
    }
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ day: d, month, year, isCurrentMonth: true });
    }
    const remaining = 42 - cells.length;
    for (let d = 1; d <= remaining; d++) {
      cells.push({ day: d, month: month + 1, year, isCurrentMonth: false });
    }
    return cells;
  }, [year, month]);

  // Fade only the date grid (not the month/year header) so changing months
  // cross-fades the numbers instead of blanking the whole panel.
  const prevMonth = () => {
    if (gridFade !== 'opacity-100') return;
    setGridFade('opacity-40');
    clearTimeout(monthTimerRef.current);
    monthTimerRef.current = setTimeout(() => {
      setCurrentMonth(new Date(year, month - 1, 1));
      requestAnimationFrame(() => setGridFade('opacity-100'));
    }, 180);
  };

  const nextMonth = () => {
    if (gridFade !== 'opacity-100') return;
    setGridFade('opacity-40');
    clearTimeout(monthTimerRef.current);
    monthTimerRef.current = setTimeout(() => {
      setCurrentMonth(new Date(year, month + 1, 1));
      requestAnimationFrame(() => setGridFade('opacity-100'));
    }, 180);
  };

  const setAnchorFromEl = (el) => {
    if (!el) return;
    const r = el.getBoundingClientRect();
    setAnchor({ top: r.top, left: r.left, width: r.width, bottom: r.bottom, height: r.height });
  };

  const handleDateClick = (e, cell) => {
    if (!cell.isCurrentMonth) return;
    const date = new Date(cell.year, cell.month, cell.day);
    const isPast = date < today && !sameDay(date, today);
    if (isPast) return;
    const dateStr = `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
    if (pinnedDate === dateStr) {
      setPinnedDate(null);
      setSelectedSlot(null);
      return;
    }
    setAnchorFromEl(e.currentTarget);
    setPinnedDate(dateStr);
    setSelectedSlot(null);
  };

  const handleMouseEnter = (e, cell) => {
    if (!cell.isCurrentMonth) return;
    const date = new Date(cell.year, cell.month, cell.day);
    const isPast = date < today && !sameDay(date, today);
    if (isPast) return;
    const dateStr = `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
    if (!pinnedDate) {
      setSelectedSlot(null);
      setAnchorFromEl(e.currentTarget);
      setHoveredDate(dateStr);
    }
  };

  const handleMouseLeaveGrid = () => {
    if (!pinnedDate) setHoveredDate(null);
  };

  // Once a date is pinned, hover previews stop overriding it (so slot selection
  // in the popover isn't disturbed). Before any pin, hovering a date previews it.
  const activeDate = pinnedDate || hoveredDate;
  const activeDateObj = useMemo(() => activeDate ? new Date(activeDate + 'T00:00:00') : null, [activeDate]);

  const slots = useMemo(() => activeDateObj ? getSlotsForDay(perDay, activeDateObj) : [], [perDay, activeDateObj]);
  const occupants = useMemo(
    () => activeDateObj ? getSlotOccupants(perDay, activeDateObj, allItems, etaMap) : [],
    [perDay, activeDateObj, allItems, etaMap]
  );
  const dayItems = useMemo(
    () => activeDate ? getItemsForDate(allItems, activeDate, etaMap) : [],
    [activeDate, allItems, etaMap]
  );

  const handleSlotClick = (slotTs) => setSelectedSlot(slotTs);

  const handleConfirm = async () => {
    if (!activeDate || !selectedSlot || !item) return;
    setLoading(true);
    try {
      await onConfirm(item.qid, selectedSlot);
    } finally {
      setLoading(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] bg-black/80 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-md sm:max-w-lg md:max-w-xl bg-[#0e0e10] border border-neutral-800 rounded-2xl shadow-2xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-800">
          <div className="w-9" />
          <span className="text-sm font-semibold text-neutral-100">Jadwalkan Ulang</span>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800">
            <X size={16} />
          </button>
        </div>

        <div className="px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <button type="button" onClick={prevMonth} className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800">
              <ChevronLeft size={18} />
            </button>
            <span className="text-sm font-medium text-neutral-200">{MONTHS[month]} {year}</span>
            <button type="button" onClick={nextMonth} className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800">
              <ChevronRight size={18} />
            </button>
          </div>

          <div className="grid grid-cols-7 gap-1.5 mb-1.5">
            {DAYS.map((d) => (
              <div key={d} className="text-center text-[11px] font-medium text-neutral-500 py-1.5">{d}</div>
            ))}
          </div>

          <div
            className={`grid grid-cols-7 gap-1.5 transition-opacity duration-200 ${gridFade}`}
            onMouseLeave={handleMouseLeaveGrid}
          >
            {calendarDays.map((cell, i) => {
              const date = new Date(cell.year, cell.month, cell.day);
              const dateStr = `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
              const isToday = sameDay(date, today);
              const isPast = date < today && !sameDay(date, today);
              const isCurrentMonth = cell.isCurrentMonth;
              const isActive = (hoveredDate === dateStr || pinnedDate === dateStr);
              const itemsForDate = isCurrentMonth ? getItemsForDate(allItems, dateStr, etaMap) : [];

              return (
                <div
                  key={i}
                  className={`relative h-12 rounded-xl text-sm flex flex-col items-center justify-center cursor-pointer transition-all
                    ${isCurrentMonth ? 'text-neutral-200' : 'text-neutral-700'}
                    ${isActive && !isPast ? 'bg-cyan-500/25 text-cyan-200 border-2 border-cyan-400 ring-2 ring-cyan-400/40' : ''}
                    ${isToday && !isActive ? 'border border-neutral-600 text-white font-bold' : ''}
                    ${!isActive && !isPast ? 'hover:bg-neutral-800' : ''}
                    ${isPast ? 'text-neutral-700 cursor-not-allowed' : ''}
                  `}
                  onClick={(e) => isCurrentMonth && !isPast && handleDateClick(e, cell)}
                  onMouseEnter={(e) => handleMouseEnter(e, cell)}
                >
                  {cell.day}
                  {itemsForDate.length > 0 && isCurrentMonth && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-cyan-500 text-[9px] text-white flex items-center justify-center font-bold">
                      {itemsForDate.length}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {activeDate && anchor && (
          <DayPopover
            dateStr={activeDate}
            slots={slots}
            occupants={occupants}
            dayItems={dayItems}
            targetQid={item?.qid}
            selectedSlot={selectedSlot}
            onSelectSlot={handleSlotClick}
            onConfirm={handleConfirm}
            loading={loading}
            anchor={anchor}
            etaMap={etaMap}
            onHoverChange={(ds) => { if (!pinnedDate) setHoveredDate(ds); }}
          />
        )}
      </div>
    </div>
  );
}
