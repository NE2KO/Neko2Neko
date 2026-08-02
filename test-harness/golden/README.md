# Golden Replay Suite

Directory berisi golden replay files untuk regression testing sync engine.

## Format

Setiap file JSON adalah trace input yang direplay ke engine:

```json
{
  "name": "perfect",
  "description": "Steady-state playback tanpa gangguan",
  "tickIntervalMs": 30,
  "ticks": [
    { "t": 0, "audio": 10.000, "video": 10.000, "drift": 0 },
    ...
  ]
}
```

## File

| File | Deskripsi |
|------|-----------|
| `perfect.json` | Steady-state 30s, zero drift, no disruptions |
| `noisy.json` | Steady-state 30s, ~1ms deterministic noise floor |

## Penggunaan

```bash
node test-harness/harness.mjs
```

Harness akan:
1. Jalankan Algorithm Determinism Test (Level A + Level B)
2. Generate golden replay files jika belum ada
3. Verifikasi engine deterministic sebelum lanjut ke Reference Baseline Matrix
