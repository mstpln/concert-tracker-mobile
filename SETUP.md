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

- **No push notifications.** The Chrome extension's weekly "new concert
  found" alert doesn't have an equivalent here yet — you'd see new shows the
  next time you open the app, not via a phone notification. Doable later
  with Firebase Cloud Messaging if it's worth adding.
- **Data doesn't sync automatically with your computer.** The Chrome
  extension keeps reading/writing its own local files, untouched. Claude
  pushes matching updates to the Cloudflare copy during research sessions —
  the two aren't wired to sync with each other independently yet.
