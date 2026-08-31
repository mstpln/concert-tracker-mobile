# Canonical Identity Build 3 / v176 Migration Contract

Build 3 is a **read-only/local audit and dry-run migration build**. It does not authorize or perform production export, provider execution, Worker/R2 writes, deployment, production smoke, or production migration.

## Purpose

The v174/v175 canonical identity model is authoritative for venue, concert, event and lifecycle semantics. Build 3 provides the deterministic tooling needed to inspect an exported historical dataset, close researched ambiguity, preview canonical reconciliation, verify invariants and retain enough artifacts to reverse or audit every planned change before any later production operation is separately authorized.

## Inputs

The CLI accepts explicit local paths only:

- `venues.json` export
- `concerts.json` export
- optional research decision registry JSON

Audit mode is non-mutating and may run without expected hashes. Plan mode requires the exact byte-level SHA-256 of both source data files. When a research decision registry is supplied, plan mode also requires its exact byte-level SHA-256. Any mismatch aborts before migration planning.

Output is local-only and may not overwrite or contain any supplied source input file. Historical hashes recorded elsewhere in project continuity are not valid guards for a future production migration. A later production operation must begin from a fresh separately authorized export and its freshly calculated exact hashes.

## Research decision registry

The registry is an object with optional arrays. Pair-specific decisions are evidence records; they do not become generic matching rules.

```json
{
  "venueMerges": [
    {
      "ids": ["legacy-venue-a", "legacy-venue-b"],
      "canonicalId": "legacy-venue-a",
      "reason": "researched continuation",
      "evidence": ["review reference"]
    }
  ],
  "venueDistinct": [
    {
      "ids": ["venue-a", "venue-b"],
      "reason": "independent venues despite shared name/address"
    }
  ],
  "concertMerges": [
    {
      "ids": ["concert-a", "concert-b"],
      "canonicalId": "concert-a"
    }
  ],
  "concertDistinct": [
    {
      "ids": ["concert-a", "concert-b"],
      "reason": "researched distinct identity"
    }
  ],
  "festivalEditions": [
    {
      "id": "festival-name-2026",
      "name": "Festival Name",
      "year": "2026",
      "concertIds": ["concert-a", "concert-c"],
      "primaryCanonicalVenueId": "venue-a"
    }
  ]
}
```

Contradictory, incomplete, missing-member or ambiguous decisions block the dry run rather than guessing. `canonicalId` is mandatory for researched venue/concert merge decisions and must name one of the decision members.

`concertMerges` does **not** create a new concert identity relationship. Canonical concert identity remains `bandId + canonical venue + full date`. A `concertMerges` decision may only select the surviving stable ID for the **complete set of records that already form one canonical duplicate group**. A decision that attempts to merge otherwise-distinct concerts, omits a member of the canonical duplicate group, conflicts with an explicit distinct decision, or selects a non-member survivor blocks the dry run.

For candidate groups with more than two records, a distinct decision resolves the candidate only when every pair is explicitly covered by the decision set. A single resolved pair cannot hide remaining ambiguity.

Festival decisions are likewise fail-closed: one concert cannot belong to conflicting festival editions, incompatible metadata for the same edition blocks that entire edition, and no partial festival assignment is applied after a conflict.

## Migration order

1. Validate researched distinct decisions against current or legacy stable IDs.
2. Apply researched venue merge/separate decisions.
3. Build canonical venue identity from the resulting venue set.
4. Remap concert canonical venue references while preserving historical/raw venue wording.
5. Apply evidence-backed festival-edition decisions.
6. Reconcile canonical concert collisions using `bandId + canonical venue + full calendar date`.
7. Validate unresolved identity candidates, event/festival groups, protected fields, attended historical dates, ID mappings, legacy-ID ownership and orphan references.
8. Emit local migration and rollback artifacts.
9. Re-run the planner against the planned output with the **same research decision registry** and require a no-op result before any later production migration can be considered.

Ordinary concerts on different calendar dates remain separate. Multi-date/multi-venue event identity is permitted only for a confirmed festival edition. Existing valid user-owned `eventGroupId` relationships remain authoritative and are validated through the v174 event model using the migrated local venue index.

## Data shape and preservation

Build 3 does not require destructive schema replacement. Reconciliation is additive where needed:

- surviving venue retains `venueId`; merged-away venue IDs are retained through `legacyVenueIds` and forward/reverse mapping artifacts;
- chained venue reconciliations retain transitive mappings from every legacy source ID to the final survivor;
- merged-away venue names and changed locations are retained as historical name/location evidence;
- surviving concert retains one stable BANDMARKR `id`; merged-away concert IDs are retained through `legacyConcertIds` and mapping artifacts;
- provider observations, source history, lifecycle history and other safe evidence arrays are unioned;
- legacy top-level provider IDs that would otherwise disappear during a merge are retained as provider observations before the duplicate record is removed;
- user-owned fields remain protected, including explicit boolean `false` values;
- attended historical concert dates are immutable;
- unknown future fields are copied when non-conflicting and block a merge when contradictory values would require an invented winner;
- provider-owned presentation may use the strongest verified observation, including the v175 `sourceProvider` / `ticketRetailerVerified` ownership model, but provider evidence does not overwrite user-owned state;
- duplicate ownership of one `legacyVenueId` or `legacyConcertId` by multiple surviving records is a blocker.

A postponed `DATE TBD` record has no full active date and therefore cannot be canonically collapsed by the normal `band + venue + date` key. It remains preserved as unresolved unless separate proven lifecycle/decision evidence resolves it. Ordinary unresolved records are reported; unresolved duplicate **candidate groups** that still require a merge/distinct research decision block migration readiness.

## Dry-run outputs

Plan mode writes only beneath the requested local output directory:

- `source/venues.original.json` — byte-identical source backup
- `source/concerts.original.json` — byte-identical source backup
- `source/decisions.original.json` when supplied
- `venues.migrated.json`
- `concerts.migrated.json`
- `legacy-venue-map.json`
- `legacy-concert-map.json`
- `reverse-venue-map.json`
- `reverse-concert-map.json`
- `merge-manifest.json`
- `migration-report.json`
- `rollback-manifest.json`

The report contains exact source-file hashes, deterministic content hashes, before/after metrics, blockers, unresolved records, unresolved identity candidates, protected-field checks, orphan/legacy-alias checks and validation result.

## Rollback

Rollback is based on the untouched byte-identical source backups, not on attempting to reconstruct deleted source records from canonical output. Forward and reverse mappings plus the merge manifest provide traceability from every source/legacy ID to its planned surviving identity.

No rollback or production write is executed by Build 3 tooling.

## Data-loss analysis

A dry-run is invalid if it would require choosing between contradictory user-owned values, contradictory unknown fields, an unresolved duplicate identity candidate, a dangling canonical venue, a missing/duplicate stable ID, ambiguous legacy-ID ownership, an invalid event relationship, a contradictory or malformed research decision, or a changed attended historical date. These cases are reported as blockers and must be researched or corrected before any production migration is separately authorized.

Provider-owned duplicates may collapse to one canonical record only when canonical identity is unambiguous and protected values remain safe. Merged-away IDs and provider evidence remain traceable.

## CLI examples

Audit only:

```sh
node scripts/canonical-audit-migrate-v176.js audit --venues ./export/venues.json --concerts ./export/concerts.json --decisions ./decisions.json --out ./out/audit.json
```

Hash-guarded dry run with a decision registry:

```sh
node scripts/canonical-audit-migrate-v176.js plan --venues ./export/venues.json --concerts ./export/concerts.json --decisions ./decisions.json --expected-venues-sha256 <exact_sha256> --expected-concerts-sha256 <exact_sha256> --expected-decisions-sha256 <exact_sha256> --out-dir ./out/dry-run
```

The command has no network or production write path.
