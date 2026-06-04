# Backup file format

This document describes the JSON file produced by the **Export** button
and consumed by the **Import** button, and the considerations behind
its design.

## File structure

A backup is a top-level JSON array of secret entries:

```json
[
  {
    "id": "8a3d1b2e-…",
    "name": "Bank PIN",
    "salt": "OwtnKV/16shIaIpMshekPg==",
    "hash": "JApwOXvg/K/DTNYLFW5NRVo/A5fbD0Kn3+brWbF+YSs=",
    "kdf": "pbkdf2-sha256-600000",
    "interval": 6,
    "efactor": 2.5,
    "reps": 2,
    "nextDue": "2026-06-10T09:55:51.881Z",
    "lastVerified": "2026-06-04T09:55:51.881Z"
  }
]
```

The same structure is also what lives in `localStorage` under the key
`repass_secrets_v2`. Export is a straight `JSON.stringify` of that
array; import is a `JSON.parse` followed by a structural check and a
write back to the same key.

## Fields

| Field | Type | Required | Meaning |
|---|---|---|---|
| `id` | string | yes | Stable identifier (`crypto.randomUUID()`). |
| `name` | string | yes | Human label for the secret. |
| `salt` | string (base64) | yes | 16 random bytes generated per secret with `crypto.getRandomValues`. |
| `hash` | string (base64) | yes | Output of the KDF identified by `kdf`, applied to `(secret, salt)`. |
| `kdf` | string | yes (lazy-filled) | KDF identifier (see below). |
| `interval` | number | yes (lazy-filled) | Current SM-2 interval in days. |
| `efactor` | number | yes (lazy-filled) | SM-2 ease factor. Starts at 2.5, floor 1.3. |
| `reps` | number | yes (lazy-filled) | Consecutive successful repetitions. Resets to 0 on a lapse. |
| `nextDue` | string (ISO date) | yes | When the secret is next due for verification. |
| `lastVerified` | string (ISO date) | no | Set when verification last succeeded. Absent until the secret has been verified at least once. |

The import validator requires `id`, `name`, `salt`, `hash`, `nextDue`,
and *either* `interval` or the legacy `days`. Other missing fields are
lazy-filled with the current defaults; this keeps backups exported by
older builds importable into newer ones.

### Legacy `days` field

Pre-SM-2 entries carried a fixed `days` interval. On load (or on save
after import), `normalize()` copies `days` into `interval` and removes
`days`. After one round-trip through the running app, no entry retains
the legacy field.

## The `kdf` field

### Format

```
{algorithm}-{hash}-{iterations}
```

For the current app default:

```
pbkdf2-sha256-600000
```

Parse with `kdf.split('-')` → `[algorithm, hash, iterations]`.

### Why a compact string

Three structured fields (`kdf`, `kdfHash`, `kdfIters`) carry the same
information but triple the per-entry bookkeeping and need a richer
parser. A dash-separated string is unambiguous for the parameter space
this app uses (one algorithm family, one hash, one tunable iteration
count) and stays human-readable in a backup file.

### Why per-secret, not file-level

The natural shape would be a top-level wrapper:

```json
{ "kdf": "pbkdf2-sha256-600000", "secrets": [ … ] }
```

That works as long as every entry shares the same KDF. The moment a
KDF change starts rolling out, that assumption breaks: entries the
user has re-verified are on the new KDF, the rest are still on the
old one. A file-level field would have to lie about half the entries.

Putting `kdf` on each entry models the migration-in-flight state
correctly and makes the migration code trivial: it just reads
`entry.kdf` to decide which algorithm to verify against.

### Deriving the constant

The runtime constant is derived from the iteration constant:

```js
const PBKDF2_ITERS = 600_000;
const KDF = `pbkdf2-sha256-${PBKDF2_ITERS}`;
```

Bumping `PBKDF2_ITERS` automatically produces a new identifier, so
there is no second place to remember updating.

## SM-2 scheduling

Reviews use a small, inline implementation of the SM-2 algorithm
(Wozniak, 1990). The scheduling state lives on each entry as the
fields `interval`, `efactor`, and `reps`.

### Grading

The UI surfaces three grade buttons after a successful verify; they
map to SM-2 quality values:

| Button | SM-2 grade | Effect |
|---|---|---|
| Again | 1 | Lapse. `reps` → 0, `interval` → 1 day, `efactor` decreases. |
| Good | 4 | Normal progression. `efactor` stays roughly flat. |
| Easy | 5 | Progression with bonus. `efactor` increases by 0.1. |

A wrong input on Verify is not automatically graded. The user can
retry or close out; closing leaves the schedule untouched. This trades
strict Anki parity for tolerance of typos, since RePass can't show
the answer to disambiguate "didn't remember" from "fat-fingered it".

### Algorithm

```
if grade < 3:
    reps = 0
    interval = 1
else:
    if reps == 0: interval = 1
    elif reps == 1: interval = 6
    else:          interval = round(interval * efactor)
    reps += 1
efactor = max(1.3, efactor + (0.1 - (5 - grade) * (0.08 + (5 - grade) * 0.02)))
```

### Why SM-2 and not FSRS

Anki now defaults to FSRS, which is measurably more accurate at scale.
That edge depends on:

- thousands of reviews per user to train the per-deck parameters, and
- richer difficulty signals than a binary "did the input match the hash".

Neither applies here. SM-2 fits in ten readable lines, exposes three
human-interpretable state variables, and produces indistinguishable
predictions for the handful of secrets a user is realistically going to
track. Switching later would require a fresh data model (`stability`,
`difficulty`, last-review date) — there's no clean migration path from
SM-2 state to FSRS state, so this is effectively a one-way choice.

## Future migration path (not implemented)

When the KDF constant changes, this is the intended flow:

1. **Verification routes through the entry's `kdf`** instead of the
   current default. A small dispatcher reads the parameters out of
   the string and calls `crypto.subtle.deriveBits` with them.
2. **On a successful verify of an out-of-date entry**, the plaintext
   secret is in hand (the user just typed it). The app computes a
   fresh hash with the current `KDF`, updates `hash` and `kdf` on the
   entry, and persists.
3. **Over time, every entry the user actually exercises converges to
   the current KDF.** Entries the user never verifies stay on the old
   KDF indefinitely — that's acceptable; they only become a problem
   the next time they're verified, at which point step 2 handles
   them.
4. **Backups exported mid-migration will contain a mix of `kdf`
   values per entry.** Importing such a backup is a no-op for the
   migration: each entry keeps its `kdf`, and step 2 still works
   later.

There is no rehash-on-load path. Rehashing requires the plaintext,
which the app never stores; the secret only re-enters memory during a
successful verify.

## What is intentionally *not* in the backup

- **Plaintext.** Only the salt and the KDF output are stored, anywhere.
- **App version.** The format is structurally additive — older fields
  stay, new fields are tolerated as absent on read — so a version
  number on the file would only encourage premature gating. Fields
  carry their own compatibility info (`kdf` already conveys the hash
  parameters).
- **Verification history beyond `lastVerified`.** Streaks and other
  motivation metrics could be added later; they don't change anything
  load-bearing about the format.

## Filename convention

The Export button produces `repass-YYYY-MM-DD.json`. The date is the
day the file was generated, in the user's local time. No timezone is
recorded inside the file.
