# Reschedule Modal - UI Fixes Plan

## Issue 1: Month Transition Flicker

### Problem
Saat ganti bulan, calendar grid berganti semua cell dalam 1 frame, causing flicker.

### Fix
- Ganti transition dari `transform` ke `opacity` + `transform` kombinasi
- Fade out → change month → fade in
- Duration: 150ms fade out + 100ms fade in
- Tidak ada stagger, semua cell fade bareng

### Implementation
```jsx
// Calendar view wrapper
<div className={`transition-opacity duration-150 ${showTimeSlots ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
  {/* calendar content */}
</div>
```

---

## Issue 2: Hover Tooltip Missing

### Problem
Tooltip tidak muncul saat hover tanggal. `hoveredItems` dihitung tapi tidak di-render.

### Fix
Tambahkan tooltip component yang muncul di atas date cell:

```
┌─────────────────────┐
│ Senin, 12 Agustus   │  ← date header (dari card: tanggal + jam)
├─────────────────────┤
│ [Thumb] [Thumb]     │  ← mini grid (3 kolom)
│ File A    File B     │
│ 08:00     16:00     │
└─────────────────────┘
```

### Layout
- **Position**: absolute, di atas date cell (top: -80px atau lebih)
- **Width**: fixed 180px
- **Z-index**: 50 (di atas modal)
- **Delay**: 300ms sebelum muncul (pakai hoverTimerRef yang sudah ada)
- **Content**:
  - Header: "Senin, 12 Agustus" (format date Indo)
  - Mini grid: 3 kolom x 2 baris (max 6 item)
  - Setiap item: thumbnail 32px + filename truncate + scheduled time

### Positioning Logic
- Jika cell di baris pertama (index < 7): tooltip muncul di BAWAH cell (karena tidak ada space di atas)
- Jika cell di baris lain: tooltip muncul di ATAS cell
- Gunakan `getBoundingClientRect()` pada cell element untuk positioning akurat

### Implementation
```jsx
// State additions
const [tooltipRect, setTooltipRect] = useState(null);
const [tooltipVisible, setTooltipVisible] = useState(false);

// handleMouseEnter
const cellEl = e.currentTarget;
const rect = cellEl.getBoundingClientRect();
const modalRect = modalRef.current.getBoundingClientRect();
setTooltipRect({
  left: rect.left - modalRect.left,
  top: rect.top - modalRect.top,
  showBelow: index < 7  // first row → show below
});
setTooltipVisible(true);

// handleMouseLeave
setTooltipVisible(false);
```

---

## Files Modified
- `frontend/src/components/RescheduleModal.jsx` only

## Build Status
- Build passes before changes
- No new dependencies needed
