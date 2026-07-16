# Setup guide — Concert Tracker Mobile

This is the part only you can do (account creation and payment details aren't
something Claude does on your behalf). It's mostly clicking through
Cloudflare's dashboard — no coding required. Should take about 15-20 minutes.

## Part 1 — Cloudflare account + R2 bucket

1. Go to https://dash.cloudflare.com/sign-up and create a free account (email + password).
2. In the left sidebar, find **R2 Object Storage** and enable it. It will ask
   you to add a payment card — this is required to turn R2 on, but you won't
   be charged unless you go far past the free tier (10GB storage, a million
   writes/month — two small JSON files won't come close).
3. Create a bucket. Name it something like `concert-tracker-data`. Leave the
   default settings.

## Part 2 — The Worker (the small API in front of your bucket)

1. In the sidebar, go to **Workers & Pages** > **Create** > **Create Worker**.
   Give it a name, e.g. `concert-tracker-api`. Deploy the default "Hello
   World" starter — you'll replace the code next.
2. Open the Worker, go to **Edit code**, delete everything, and paste in the
   contents of `worker.js` from this folder. Click **Deploy**.
3. Go to the Worker's **Settings** > **Bindings** > **Add binding** > **R2
   Bucket**. Set the variable name to exactly `BUCKET` and point it at the
   bucket you created in Part 1.
4. Go to **Settings** > **Variables and Secrets** > **Add** > pick **Secret**,
   name it exactly `API_TOKEN`, and set its value to any long random string —
   this is effectively the app's password. A quick way to generate one: run
   `openssl rand -hex 32` in any terminal, or just mash the keyboard for 40+
   characters. Save it somewhere (a password manager) — you'll need to paste
   this exact value into the app later, and Cloudflare won't show it to you
   again after saving.
5. Note the Worker's URL, shown at the top of its page — something like
   `https://concert-tracker-api.<your-subdomain>.workers.dev`. You'll need
   this too.

## Part 3 — Hosting the app itself (GitHub Pages)

1. Create a free GitHub account at https://github.com if you don't have one.
2. Create a new **public** repository, e.g. `concert-tracker-mobile`.
3. Upload every file from this folder (`index.html`, `app.css`, `app.js`,
   `dataLib.js`, `icons.js`, `remoteStore.js`, `manifest.json`,
   `service-worker.js`, and the `icons/` folder) to that repository — either
   drag-and-drop them on GitHub's web UI, or tell Claude and it can push them
   for you once the repo exists.
4. In the repo, go to **Settings** > **Pages**, set the source branch (e.g.
   `main`) and folder (`/`), and save. GitHub will give you a URL like
   `https://<your-username>.github.io/concert-tracker-mobile/` — that's the
   app's real address, reachable from your phone.

## Part 4 — Connect and install on your phone

1. On your Android phone, open Chrome and go to the GitHub Pages URL from
   Part 3.
2. The app will ask for a **Worker URL** and **access token** — paste in the
   Worker URL from Part 2 step 5, and the `API_TOKEN` value from Part 2 step
   4. Tap **Connect**.
3. If it connects successfully, Chrome should offer to **Add to Home
   screen** (or use the ⋮ menu > "Add to Home screen" / "Install app" if it
   doesn't prompt automatically). That's the install — no app store involved.

## What's not included yet

## MusicBrainz artist identity

## My Concerts preparation tools — Stage 1

Upcoming concerts marked as attending now have four compact preparation rows:
**Playlist**, **Weather forecast**, **Predicted setlist**, and **Checklist**.
They start collapsed, and opening one closes the other rows in that concert
card. Existing `playlistUrl` remains the manual playlist field: Spotify,
Apple Music, and other valid playlist links can be added, edited, opened, or
removed without affecting any future generated-playlist data.

Stage 1 does not create Spotify playlists, use Spotify OAuth, request live
weather, or cache weather. Weather therefore shows `Available 10 days before
the concert`. The fixed manual checklist is: Ticket ready, Travel
planned, Doors & stage times checked, Venue rules checked, and Playlist ready.
Nothing is completed automatically. There is no offline mode or Concert Day
Mode. For local visual testing, provide fixture concerts with optional
`predictedSetlist` data; fixtures must not be stored in production JSON.

## My Concerts preparation tools — Stage 2

Predicted setlists are a research-side estimate, never a real setlist. They
need a confirmed MusicBrainz MBID; research-side song matching additionally
requires a confirmed Spotify artist ID. The deterministic calculation uses up
to 20 useful setlist.fm shows from roughly the last 24 months, excludes covers,
and needs at least three shows. It weighs appearance rate, recency, typical
position, and opener/closer/encore evidence. `Played in X%` is the share of
source shows containing the song.

Overall confidence is **high** for at least eight consistent shows with a 65%
average selected-song rate, **medium** for at least five shows and 45%, and
**low** otherwise. A song can receive only Likely opener, Common closer,
Common encore, or Recently added. Ready predictions refresh at most every
seven days. Before saving, the pipeline reads the latest concerts and merges
only `predictedSetlist`, preserving playlists, checklist choices, and every
other concert field. Tests use mocked providers. Stage 2 uses existing
app-only Spotify credentials only: it adds no user OAuth and never creates a
playlist.

MusicBrainz is used only to identify artists with a stable MBID for future features. It needs no API key. Automatic lookups are disabled by default in `scripts/lib/config.js`; when explicitly enabled, the pipeline makes at most five, one-request-per-band lookups per run. Uncertain results appear in Settings under **Artist identity review**. No production backfill occurs automatically, and user-confirmed choices are protected. Rollback means disabling the feature; it does not delete stored identity history.

### Run the MusicBrainz backfill manually

The weekly research pipeline does **not** run MusicBrainz automatically. When you are ready to check a small batch yourself:

1. Open your repository on GitHub and choose **Actions**.
2. Open **MusicBrainz artist identity backfill**.
3. Click **Run workflow**.
4. Select the `main` branch.
5. Tick the confirmation checkbox.
6. Click **Run workflow**.
7. The run checks at most five eligible artists.
8. Refresh the app's **Settings** screen afterward.
9. Review any uncertain candidates in **Artist identity review**.
10. Repeat later until the remaining count reaches zero.

No MusicBrainz API key is needed. Confirmed, rejected, and review states are protected. The manual run writes only `bands.json` and `apiUsage.json`.

## Structured research routing (disabled by default)

Confirmed MBIDs remain the canonical artist identity. The optional structured
router uses them to query setlist.fm by MBID, resolve and cache a conservative
Spotify artist ID and Ticketmaster attraction ID, validate Spotify setlist
song links, and monitor MusicBrainz release groups plus Spotify albums and
singles. It uses the existing `news.json` **album** category for structured
album, EP, and single alerts—there is no new screen or data file.

Each provider starts with a silent, resumable baseline: existing catalogue
items are recorded as compact keys and produce no historical alerts. Later
eligible albums, EPs and singles can create one deduplicated alert. Compilations,
live/remix/tribute/karaoke/promotional/reissue/deluxe variants and guest-only
appearances are excluded. A future alert requires a complete date; partial
dates retain their true precision internally rather than being presented as a
made-up exact date.

The router is controlled by `STRUCTURED_RESEARCH.enabled` in
`scripts/lib/config.js`, which is **false** by default. To activate later,
review the branch, merge it, then deliberately change only that flag to `true`
and deploy the reviewed change. The normal MusicBrainz identity flag remains
separate and disabled. Roll back by setting the structured flag back to
`false`; cached provider IDs, baselines and existing alerts are retained.

MusicBrainz needs no secret. The existing Spotify Client Credentials,
Ticketmaster, Tavily, Groq and setlist.fm credentials are reused. Cached IDs
are not routinely re-resolved; unresolved identities retry after 90 days and
temporary errors after 24 hours. MusicBrainz/Spotify release scans refresh at
most weekly. Tavily is limited to due tour, future-release-gap, status, or
missing-ticket searches; Groq is only a validated fallback for a promising,
ambiguous Tavily result and remains unchanged for About descriptions. Local
tests use mocked provider responses only.

- **No push notifications.** The Chrome extension's weekly "new concert
  found" alert doesn't have an equivalent here yet — you'd see new shows the
  next time you open the app, not via a phone notification. Doable later
  with Firebase Cloud Messaging if it's worth adding.
- **Data doesn't sync automatically with your computer.** The Chrome
  extension keeps reading/writing its own local files, untouched. Claude
  pushes matching updates to the Cloudflare copy during research sessions —
  the two aren't wired to sync with each other independently yet.
