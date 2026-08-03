# LiveVault v81 Decisions

These durable v81 decisions supplement `LIVEVAULT_DECISIONS.md` and should be folded into the canonical ledger when the build is finalized.

- A valid event with missing duration counts as a listen. Time totals and time-based charts use only positive known duration; zero, negative and malformed duration remain invalid.
- Start Top Bands uses rolling 14-day windows. Top 100 resets to 3 months and Band Detail Listening resets to 1 year on entry.
- Top Albums groups normalized stored release titles only. Different editions remain separate and artwork requires an existing stable identity.
- The yearly-hours line chart and stacked genre chart own independent six-year windows and selected-year state. Empty calendar years remain visible and the current year is marked year-to-date.
- Start refresh requests a service-worker update, activates a waiting worker and reloads once with a timeout fallback. It never clears browser credentials, settings, IndexedDB or remote data.
