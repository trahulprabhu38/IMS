# MTTR — Mean Time To Resolve

How IMS calculates, stores, and surfaces the MTTR metric.

---

## Definition

**MTTR (Mean Time To Resolve)** is the elapsed time between when an incident was first detected and when a human confirmed the root cause and applied a fix.

In IMS, the precision is:

```
MTTR = RCA.incidentEnd − WorkItem.startTime
```

This is distinct from two other common metrics:

| Metric | Formula | Measures |
|---|---|---|
| **MTTR (this system)** | `RCA.incidentEnd − WorkItem.startTime` | Detection to confirmed resolution |
| MTTD (Mean Time To Detect) | `WorkItem.startTime − actual_outage_start` | How long before the system knew |
| MTTF (Mean Time To Failure) | Average gap between incident closures | System reliability over time |

---

## Inputs

### WorkItem.startTime

Set at work item creation time — specifically, it is the `timestamp` field from the **first signal** that triggered the work item.

```javascript
// SignalProcessor.js
const workItem = await createWorkItem({
  title:     `${signal.componentId} — ${signal.signalType}`,
  startTime: signal.timestamp || new Date(),   // ← first signal's timestamp
  ...
});
```

If the signal carries a `timestamp` from the emitting service (e.g., `2026-05-01T10:00:00Z`), that value is used. This means MTTR accounts for propagation delay — if a service detected the failure 30 seconds before it hit IMS, those 30 seconds are included.

If no timestamp is provided, `new Date()` (server time at ingestion) is used.

### RCA.incidentEnd

Set by the operator when submitting the Root Cause Analysis form. The operator inputs:

- `incidentStart` — when the incident actually began (may precede `startTime` if detection was delayed)
- `incidentEnd` — when the fix was confirmed and service restored

The `incidentEnd` field is human-provided because only the operator knows when the service was actually healthy again — automatic signal absence doesn't guarantee recovery.

---

## Calculation

MTTR is computed **inside a PostgreSQL transaction** at the moment the RCA is submitted:

```javascript
// WorkItemRepository.js — createRCA()
const mttrSeconds = (new Date(incidentEnd) - new Date(incidentStart)) / 1000;

await client.query('BEGIN');

// 1. Insert RCA record
INSERT INTO rca_records (work_item_id, incident_start, incident_end, ...)

// 2. Close work item and stamp MTTR atomically
UPDATE work_items
SET status = 'CLOSED',
    closed_at = NOW(),
    mttr_seconds = $mttrSeconds
WHERE id = $workItemId;

await client.query('COMMIT');
```

The transaction guarantees: either both the RCA record and the MTTR stamp are written, or neither is. There is no state where an RCA exists but the work item is not closed, or where the work item is closed with a NULL mttr.

---

## Formula Detail

```
mttrSeconds = (new Date(rca.incidentEnd) − new Date(rca.incidentStart)) / 1000

where:
  rca.incidentStart  = operator-provided start of the incident
  rca.incidentEnd    = operator-provided time of confirmed resolution
  division by 1000   = converts JavaScript milliseconds to seconds
```

**Note:** The formula uses `rca.incidentStart`, not `workItem.startTime`. This is a deliberate design decision:

- `workItem.startTime` = when IMS first saw a signal — influenced by detection lag, batching, or network delays
- `rca.incidentStart` = when the operator asserts the incident truly began — more accurate for SLA reporting

The delta `workItem.startTime − rca.incidentStart` gives the **detection lag** (positive if detection was late, zero or negative if proactive monitoring caught it before user impact).

---

## Validation

Before the MTTR calculation runs, the RCA validator checks:

```javascript
// WorkItemState.js — validateRCA()
if (new Date(rca.incidentEnd) <= new Date(rca.incidentStart)) {
  throw new RCAValidationError('incidentEnd must be after incidentStart');
}
```

This ensures `mttrSeconds` is always positive. A zero or negative MTTR would indicate a data entry error (end before start).

All five RCA fields must also be non-empty:

```javascript
const required = ['rootCauseCategory', 'fixApplied', 'preventionSteps', 'incidentStart', 'incidentEnd'];
```

The work item cannot be CLOSED — and thus MTTR cannot be set — until all five fields are provided. This enforces quality of post-mortems.

---

## Storage and Display

### Storage

```sql
-- work_items table
mttr_seconds  FLOAT    -- seconds as a decimal, e.g. 1847.5 = 30m 47.5s
closed_at     TIMESTAMPTZ
```

Stored as a float in seconds to allow sub-second precision and to simplify arithmetic across different time units in reporting queries.

### Display

The frontend converts `mttrSeconds` to a human-readable string:

```javascript
// StatusBadge / IncidentDetail
function formatMTTR(seconds) {
  if (!seconds) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
```

Examples:
- `1847` → `"30m 47s"`
- `7240` → `"2h 0m"`
- `45`   → `"45s"`

### Dashboard Location

MTTR is surfaced in two places:

1. **Incident card** (Live Feed) — appears on CLOSED cards as a blue `30m 47s` chip
2. **Detail header** — shown in the metadata row next to the closed timestamp

---

## Edge Cases

| Scenario | Behaviour |
|---|---|
| Incident resolved in under 1 second | `mttrSeconds < 1`, displayed as `"0s"` — valid, not filtered |
| Operator sets `incidentEnd` before `incidentStart` | Rejected with HTTP 422 `RCAValidationError` before any write |
| Work item closed without RCA | Impossible — state machine throws `RCAValidationError` if `targetStatus === CLOSED` and no RCA provided |
| DB crash between RCA insert and work item update | PostgreSQL transaction rolls back — neither record is committed; operator can resubmit |
| Multiple RCA submissions | Only one RCA per work item is supported. The `CLOSED` state is terminal; the state machine rejects further transitions. |

---

## Aggregate MTTR (Future Extension)

The current system stores MTTR per incident. A fleet-wide MTTR can be derived:

```sql
-- Average MTTR for P0 incidents in the last 30 days
SELECT
  severity,
  COUNT(*)                    AS incident_count,
  AVG(mttr_seconds) / 60      AS avg_mttr_minutes,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY mttr_seconds) / 60 AS median_mttr_minutes,
  MAX(mttr_seconds) / 60      AS worst_mttr_minutes
FROM work_items
WHERE status = 'CLOSED'
  AND closed_at > NOW() - INTERVAL '30 days'
GROUP BY severity
ORDER BY severity;
```

This query is ready to run against the existing schema — no schema changes needed to add MTTR reporting to a future analytics dashboard.
