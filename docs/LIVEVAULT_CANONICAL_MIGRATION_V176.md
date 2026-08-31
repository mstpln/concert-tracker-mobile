# Canonical Identity Build 3 / v176 Migration Contract

Build 3 is a **read-only/local audit and dry-run migration build**. It does not authorize or perform production export, provider execution, Worker/R2 writes, deployment, production smoke, or production migration.

## Purpose

The v174/v175 canonical identity model is authoritative for venue, concert, event and lifecycle semantics. Build 3 provides deterministic tooling to inspect an exported historical dataset, close researched ambiguity, preview canonical reconciliation, verify invariants and retain enough artifacts to reverse or audit every planned change before any later production operation is separately authorized.

## Inputs and file safety

The CLI accepts explicit local paths only:

- `venues.json` export
- `concerts.json` export
- optional research decision registry JSON

Audit mode is non-mutating and may run without expected hashes. Plan mode requires the exact byte-level SHA-256 of both source data files. When a research decision registry is supplied, plan mode also requires its exact byte-level SHA-256. Any mismatch aborts before migration planning.

Output is local-only. Audit output may not overwrite an input. A plan output directory must be absent or empty, must not contain source inputs, and physical-path checks reject source-equivalent symlink or hard-link destinations. Historical hashes recorded elsewhere in project continuity are not valid guards for a future production migration. A later production operation must begin from a fresh separately authorized export and freshly calculated exact hashes.

Source records with missing or duplicate stable venue/concert IDs block a plan instead of creating ambiguous mappings.

## Research decision registry

The registry is an object with optional arrays. Known decision sections must actually be arrays; malformed known sections reject rather than silently becoming empty. Unknown future top-level decision fields remain covered by the exact decisions-file byte hash.

Pair/group-specific decisions are evidence records; they do not become generic matching rules.

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

Contradictory, incomplete, missing-member or ambiguous decisions block rather than guessing. `canonicalId` is mandatory for researched venue/concert merge decisions, must name a decision member, and may be a legacy member alias that resolves unambiguously to its current stable identity.

`concertMerges` does **not** create a new concert identity relationship. Canonical concert identity remains `bandId + canonical venue + full date`. A concert merge decision may only select the surviving stable ID for the **complete set of records already forming one canonical duplicate group**. It cannot force otherwise-distinct concerts together or omit members of that duplicate group.

Overlapping merge decisions that select conflicting survivors block. A merge decision that conflicts with a distinct decision also blocks, including when the contradiction is visible only after resolving legacy IDs. A distinct decision between a current ID and its own legacy alias is invalid because both resolve to the same identity.

For candidate groups with more than two records, distinct resolution is all-pairs: every pair must be explicitly covered by researched distinct decisions. One resolved pair cannot hide remaining ambiguity.

For concert survivors, a researched explicit choice cannot replace a member carrying a higher protected/user-owned richness score. Automatic equal-richness merges keep the first source stable ID rather than choosing an ID through sort order. Existing explicit merge decisions are recognized through current or legacy member IDs so automatic survivor protection never invents a competing decision.

Festival decisions are fail-closed: one concert cannot belong to conflicting festival editions, incompatible metadata for the same edition blocks that entire edition, and no partial festival assignment is applied after a conflict.

## Audit candidate semantics

Venue candidate discovery uses the same normalized identity text semantics as the canonical v174 venue model, including normalization such as diacritic-insensitive comparisons where appropriate.

A room/hall/stage/sub-location name by itself is not treated as a cross-venue merge candidate. Sub-location identity participates only when provider identity anchors it, preserving the v174 parent/sub-location boundary.

Unresolved canonical concert identity is classified explicitly:

- a lifecycle/provider/status `postponed` record whose canonical failure is `date_missing_or_tbd` is allowed to remain unresolved as `POSTPONED · DATE TBD`;
- any other unresolved canonical concert identity is a migration blocker.

This means ordinary records cannot silently pass through with incomplete canonical identity merely because they do not currently collide with another record.

## Migration order

1. Validate researched distinct/merge decisions against current and legacy stable IDs.
2. Apply researched venue merge/separate decisions.
3. Build canonical venue identity from the resulting venue set.
4. Remap concert canonical venue references while preserving historical/raw venue wording.
5. Apply evidence-backed festival-edition decisions and remap existing festival primary venue references through researched venue mappings.
6. Reconcile canonical concert collisions using `bandId + canonical venue + full calendar date`.
7. Validate unresolved canonical identity, event/festival groups, protected fields, attended historical dates, stable/legacy ID ownership and orphan references.
8. Emit local migration and rollback artifacts.
9. Re-run the planner against planned output with the **same research decision registry** and require a no-op result before any later production migration can be considered.

Ordinary concerts on different calendar dates remain separate. Multi-date/multi-venue event identity is permitted only for a confirmed festival edition. Existing valid user-owned `eventGroupId` relationships remain authoritative and are validated through the v174 event model using the migrated local venue index.

## Data shape, provenance and preservation

Build 3 does not require destructive schema replacement. Reconciliation is additive where needed:

- a surviving venue retains `venueId`; merged-away venue IDs remain in `legacyVenueIds` and forward/reverse mapping artifacts;
- chained venue reconciliations retain transitive mappings from every legacy source ID to the final survivor;
- merged-away venue names and changed locations remain historical name/location evidence;
- a surviving concert retains one stable BANDMARKR `id`; merged-away concert IDs remain in `legacyConcertIds` and mapping artifacts;
- provider observations, source history, lifecycle history and other safe evidence arrays are unioned;
- legacy top-level provider IDs are synthesized into provider observations before a duplicate source record disappears;
- meaningful provider-owned article/search evidence is also retained even when there is no provider event, venue or attraction ID, including source/article URL and available observed/found timestamps;
- conflicting observations for the same provider event are retained as separate observations instead of inventing a winner; sparse compatible observations may enrich one another;
- distinct meaningful provider observation timestamps are not collapsed away;
- `providerRelatedEventIds` are unioned across source records without allowing them to become a generic unknown-field conflict;
- user-owned fields remain protected, including explicit boolean `false` values;
- attended historical concert dates are immutable;
- unknown future fields are copied when non-conflicting and block a merge when contradictory values would require an invented winner;
- provider-owned presentation may use the strongest verified observation, including the v175 `sourceProvider` / `ticketRetailerVerified` ownership model, but provider evidence does not overwrite user-owned state;
- duplicate ownership of one `legacyVenueId` or `legacyConcertId` by multiple surviving records is a blocker.

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

A blocked but safely parsed plan may still write inspection artifacts and exits with status 2. Argument, parsing, hash or path-safety failures exit with status 1.

## Rollback

Rollback is based on untouched byte-identical source backups, not on attempting to reconstruct deleted source records from canonical output. Forward/reverse mappings plus the merge manifest provide traceability from source and legacy IDs to their planned surviving identity.

No rollback or production write is executed by Build 3 tooling.

## Data-loss analysis

A dry run is invalid if it would require choosing between contradictory user-owned values, contradictory unknown fields, an unresolved duplicate identity candidate, an ordinary unresolved canonical concert identity, a dangling canonical/festival-primary venue, a missing/duplicate stable ID, ambiguous legacy-ID ownership, an invalid event relationship, a contradictory/malformed research decision, an unsafe survivor selection, or a changed attended historical date. These cases are reported as blockers and must be researched or corrected before any production migration is separately authorized.

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
