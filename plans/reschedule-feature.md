# Reschedule Feature Plan

## Overview
Add a calendar-based reschedule UI for send queue items, inspired by Waybar's date module style.

## User Flow
1. User hovers over a queue item card in the grid
2. Clicks "Jadwalkan ulang" button (Calendar icon)
3. Modal opens with calendar view (month navigation)
4. User hovers over a date → tooltip shows items scheduled for that date
5. User clicks a date → slides to time slot view
6. Time slots are calculated from `perDay` setting
7. User clicks available slot → confirms → API call → refresh

## File Changes

### 1. `frontend/src/components/RescheduleModal.jsx` (NEW)
- Calendar grid component with month navigation
- Time slot picker based on `perDay` setting
- Slide animation between calendar and time slots views
- Hover tooltip with item preview above date cells
- Past dates disabled
- Occupied slots disabled

### 2. `frontend/src/components/SendQueueView.jsx`
- Add state: `rescheduleItem`, `showRescheduleModal`
- Fix `onAction('reschedule')` to open modal instead of calling `resendQueueItem`
- Pass `perDay`, `items` to modal
- Add `<RescheduleModal>` render
- Add `onReschedule` prop to `SendQueuePlayer`

### 3. `frontend/src/components/SendQueuePlayer.jsx`
- Add `onReschedule` prop (passed through, not used internally)

## Key Decisions

| Decision | Value |
|---|---|
| Timezone | Local browser |
| Time slots | Based on `perDay` setting (1-6 slots per day) |
| Slot calculation | `interval = 24 / perDay` hours, slots = [00:00, interval, 2*interval, ...] |
| Default time | Current time rounded to nearest slot |
| Past dates | Disabled (blocked) |
| Occupied slots | Disabled (cannot overwrite) |
| Tooltip position | Above date cell |
| Animation | Slide calendar → time slots |
| Month transition | Fade out (200ms) → swap month → fade in (double-rAF) |
| Tooltip trigger | 150ms hover delay before showing |
| Tooltip content | Mini 3-col grid: thumbnail 32px + time label |
| Tooltip position | Above cell (index >= 7), below cell for first row (index < 7) |
| Item count source | Pending + processing items only |
| Trigger | From ItemCard hover actions (done status) |

## Time Slot Examples

| perDay | Slots |
|---|---|
| 1 | [00:00] |
| 2 | [00:00, 12:00] |
| 3 | [00:00, 08:00, 16:00] |
| 4 | [00:00, 06:00, 12:00, 18:00] |
| 5 | [00:00, 04:48, 09:36, 14:24, 19:12] |
| 6 | [00:00, 04:00, 08:00, 12:00, 16:00, 20:00] |

## API
- `PUT /api/send/queue/:id/schedule` with `{ scheduledAt: timestamp }`
- No backend changes needed

## Out of Scope (for now)
- Multi-item reschedule
- Recurring schedules
- Drag-and-drop reschedule
- Reschedule from player header (only from grid for now)

## Implementation Status
- [x] RescheduleModal component created
- [x] SendQueueView state and modal integration
- [x] SendQueuePlayer onReschedule prop added
- [x] Month transition: fade-out → swap → fade-in (no flicker)
- [x] Hover tooltip: mini grid above/below date cells with thumbnail + time
- [x] Tooltip: 150ms delay, 150ms hide delay
- [x] Tooltip renders outside overflow-hidden container (not clipped)
- [x] Build passes

## Remaining
- [ ] End-to-end manual test of reschedule flow
- [ ] Fine-tune tooltip positioning if needed (visual check)


