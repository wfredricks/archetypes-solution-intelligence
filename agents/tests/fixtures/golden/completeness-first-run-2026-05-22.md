# Completeness report — namespace `asi`
*Ran 2026-05-22T14:02:26.498Z by CompletenessAgent@0.1.0-pre*

## Summary
- Total findings: 19  (info: 18, warn: 1, error: 0)

## Findings

### `events-spine` — H4
- **completeness:hypothesis-partial** (warn)
- Hypothesis H4 has partial evidence.
- details: `{"status":"partial","verifiedAt":"2026-05-21T20:32:12.766000000Z"}`

### `simple-auth` — H1
- **completeness:hypothesis-open** (info)
- Hypothesis H1 is open (expected for un-adopted archetypes).
- details: `{"status":"open","verifiedAt":null}`

### `simple-auth` — H2
- **completeness:hypothesis-open** (info)
- Hypothesis H2 is open (expected for un-adopted archetypes).
- details: `{"status":"open","verifiedAt":null}`

### `simple-auth` — H3
- **completeness:hypothesis-open** (info)
- Hypothesis H3 is open (expected for un-adopted archetypes).
- details: `{"status":"open","verifiedAt":null}`

### `simple-auth` — H4
- **completeness:hypothesis-open** (info)
- Hypothesis H4 is open (expected for un-adopted archetypes).
- details: `{"status":"open","verifiedAt":null}`

### `simple-auth` — H5
- **completeness:hypothesis-open** (info)
- Hypothesis H5 is open (expected for un-adopted archetypes).
- details: `{"status":"open","verifiedAt":null}`

### `simple-auth` — H6
- **completeness:hypothesis-open** (info)
- Hypothesis H6 is open (expected for un-adopted archetypes).
- details: `{"status":"open","verifiedAt":null}`

### DO1
- **completeness:dataobject-orphan** (info)
- DataObject DO1 (`AuthCode`) has no incoming OWNS/PRODUCES edge.

### DO1
- **completeness:dataobject-orphan** (info)
- DataObject DO1 (`ScribeEvent`) has no incoming OWNS/PRODUCES edge.

### DO2
- **completeness:dataobject-orphan** (info)
- DataObject DO2 (`Token`) has no incoming OWNS/PRODUCES edge.

### DO2
- **completeness:dataobject-orphan** (info)
- DataObject DO2 (`SubjectFilter`) has no incoming OWNS/PRODUCES edge.

### DO3
- **completeness:dataobject-orphan** (info)
- DataObject DO3 (`Grant`) has no incoming OWNS/PRODUCES edge.

### DO4
- **completeness:dataobject-orphan** (info)
- DataObject DO4 (`AuditEntry`) has no incoming OWNS/PRODUCES edge.

### `simple-auth` — S1
- **completeness:service-no-process** (info)
- Service S1 (`requestCode(email)`) on simple-auth has no associated Process.

### `simple-auth` — S2
- **completeness:service-no-process** (info)
- Service S2 (`verifyCode(email, code)`) on simple-auth has no associated Process.

### `simple-auth` — S3
- **completeness:service-no-process** (info)
- Service S3 (`verifyToken(token)`) on simple-auth has no associated Process.

### `simple-auth` — S4
- **completeness:service-no-process** (info)
- Service S4 (`grants` (HTTP router)) on simple-auth has no associated Process.

### `simple-auth` — S5
- **completeness:service-no-process** (info)
- Service S5 (`getAuthKeyStore()` / `getConfig()`) on simple-auth has no associated Process.

### `simple-auth` — S6
- **completeness:service-no-process** (info)
- Service S6 (Audit emitter interface) on simple-auth has no associated Process.
