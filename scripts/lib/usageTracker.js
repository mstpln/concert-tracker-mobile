'use strict';
// Tracks how many calls/tokens each free-tier API has used, persisted in
// apiUsage.json on the Worker so it survives across weekly runs. This is
// the actual enforcement point for the "never risk costing money" and
// "throttling" requirements — every call site in the pipeline must ask
// this module for permission first, and record the call after.
//
// Also doubles as the data source for the app's Settings screen usage
// counters (Task #137) — the shape of this file is intentionally simple
// JSON so the client can read it directly.

const config = require('./config');
const worker = require('./workerClient');
const { todayIso, thisMonthIso, sleep } = require('./util');

function freshState() {
  const today = todayIso();
  const month = thisMonthIso();
  return {
    ticketmaster: {
      freeTierDailyLimit: config.TICKETMASTER.freeTierDailyLimit,
      perRunCap: config.TICKETMASTER.perRunCap,
      dayOfCounts: today,
      callsToday: 0,
      callsThisRun: 0,
    },
    tavily: {
      freeTierMonthlyLimit: config.TAVILY.freeTierMonthlyLimit,
      monthlyCap: config.TAVILY.monthlyCap,
      perRunCap: config.TAVILY.perRunCap,
      monthOfCounts: month,
      callsThisMonth: 0,
      callsThisRun: 0,
    },
    groq: {
      freeTierDailyRequestLimit: config.GROQ.freeTierDailyRequestLimit,
      freeTierTpmLimit: config.GROQ.freeTierTpmLimit,
      freeTierTpdLimit: config.GROQ.freeTierTpdLimit,
      dailyCap: config.GROQ.dailyCap,
      perRunCap: config.GROQ.perRunCap,
      safeTpd: config.GROQ.safeTpd,
      dayOfCounts: today,
      callsToday: 0,
      callsThisRun: 0,
      tokensToday: 0,
      tokensThisRun: 0,
    },
    setlistfm: {
      freeTierDailyLimit: config.SETLISTFM.freeTierDailyLimit,
      dailyCap: config.SETLISTFM.dailyCap,
      perRunCap: config.SETLISTFM.perRunCap,
      dayOfCounts: today,
      callsToday: 0,
      callsThisRun: 0,
    },
    spotify: {
      dailyCap: config.SPOTIFY.dailyCap,
      perRunCap: config.SPOTIFY.perRunCap,
      dayOfCounts: today,
      callsToday: 0,
      callsThisRun: 0,
    },
    musicbrainz: { perRunCap: config.MUSICBRAINZ.perRunCap, callsThisRun: 0, lastCallAt: null },
    // Which band index the news-research loop should start from this run.
    // Since the Groq daily token budget can run out partway through the
    // band list (it did, on the very first live run — 149,959/150,000
    // tokens used, news skipped for whichever bands came after that
    // point), always starting from index 0 would mean the same tail-end
    // bands never get a news check, week after week. Rotating the start
    // point means the budget cutoff lands on a different part of the list
    // each run, so coverage evens out over several weeks instead.
    rotation: { nextBandIndex: 0 },
    lastRun: null,
    lastMusicbrainzRun: null,
  };
}

function ensureMusicbrainzState(state) {
  if (!state.musicbrainz) state.musicbrainz = freshState().musicbrainz;
  if (!('lastMusicbrainzRun' in state)) state.lastMusicbrainzRun = null;
  Object.assign(state.musicbrainz, { perRunCap: config.MUSICBRAINZ.perRunCap });
  return state;
}

class UsageTracker {
  constructor(state) {
    this.state = state;
    this._groqWindow = []; // { at: epochMs, tokens } for the trailing 60s TPM check
    this._notes = [];
    this._lastTicketmasterCallAt = 0;
    this._lastTavilyCallAt = 0;
    this._lastGroqCallAt = 0;
    this._lastSetlistfmCallAt = 0;
    this._lastSpotifyCallAt = 0;
    this._lastMusicbrainzCallAt = 0;
    // Stamped here (construction time — right after UsageTracker.load()
    // resolves, at the very start of a run) rather than left unset. An
    // earlier version never assigned this anywhere, so finishRun()'s
    // `this._startedAt || new Date().toISOString()` fallback always fired,
    // making every saved lastRun.startedAt/finishedAt pair identical.
    this._startedAt = new Date().toISOString();
  }

  static async load() {
    const stored = await worker.readJson('apiUsage.json', null);
    const state = stored && typeof stored === 'object' ? stored : freshState();

    // Roll over daily/monthly counters that belong to a previous period —
    // this is what stops a stale "callsThisMonth" from blocking a run
    // forever, while still protecting the real monthly Tavily cap.
    const today = todayIso();
    const month = thisMonthIso();
    if (!state.ticketmaster) state.ticketmaster = freshState().ticketmaster;
    if (!state.tavily) state.tavily = freshState().tavily;
    if (!state.groq) state.groq = freshState().groq;
    if (!state.setlistfm) state.setlistfm = freshState().setlistfm;
    if (!state.spotify) state.spotify = freshState().spotify;
    ensureMusicbrainzState(state);
    if (!state.rotation || typeof state.rotation.nextBandIndex !== 'number') {
      state.rotation = { nextBandIndex: 0 };
    }

    // Resync every cap/limit field from config.js on every load, keeping
    // only the running counters from the persisted state. Without this, a
    // cap/limit field only ever gets its value from config the very first
    // time that service's block is created (freshState()) — editing
    // config.js afterward (tightening a cap for safety, or correcting a
    // free-tier number) would silently have no effect on enforcement, and
    // the Settings screen's usage bars (which read these same fields
    // straight from apiUsage.json) would keep showing stale numbers too.
    Object.assign(state.ticketmaster, {
      freeTierDailyLimit: config.TICKETMASTER.freeTierDailyLimit,
      perRunCap: config.TICKETMASTER.perRunCap,
    });
    Object.assign(state.tavily, {
      freeTierMonthlyLimit: config.TAVILY.freeTierMonthlyLimit,
      monthlyCap: config.TAVILY.monthlyCap,
      perRunCap: config.TAVILY.perRunCap,
    });
    Object.assign(state.groq, {
      freeTierDailyRequestLimit: config.GROQ.freeTierDailyRequestLimit,
      freeTierTpmLimit: config.GROQ.freeTierTpmLimit,
      freeTierTpdLimit: config.GROQ.freeTierTpdLimit,
      dailyCap: config.GROQ.dailyCap,
      perRunCap: config.GROQ.perRunCap,
      safeTpd: config.GROQ.safeTpd,
    });
    Object.assign(state.setlistfm, {
      freeTierDailyLimit: config.SETLISTFM.freeTierDailyLimit,
      dailyCap: config.SETLISTFM.dailyCap,
      perRunCap: config.SETLISTFM.perRunCap,
    });
    Object.assign(state.spotify, {
      dailyCap: config.SPOTIFY.dailyCap,
      perRunCap: config.SPOTIFY.perRunCap,
    });

    if (state.ticketmaster.dayOfCounts !== today) {
      state.ticketmaster.dayOfCounts = today;
      state.ticketmaster.callsToday = 0;
    }
    if (state.groq.dayOfCounts !== today) {
      state.groq.dayOfCounts = today;
      state.groq.callsToday = 0;
      state.groq.tokensToday = 0;
    }
    if (typeof state.groq.tokensToday !== 'number') state.groq.tokensToday = 0;
    if (state.tavily.monthOfCounts !== month) {
      state.tavily.monthOfCounts = month;
      state.tavily.callsThisMonth = 0;
    }
    if (state.setlistfm.dayOfCounts !== today) {
      state.setlistfm.dayOfCounts = today;
      state.setlistfm.callsToday = 0;
    }
    if (state.spotify.dayOfCounts !== today) {
      state.spotify.dayOfCounts = today;
      state.spotify.callsToday = 0;
    }
    // Always zero the per-run counters at the start of a run.
    state.ticketmaster.callsThisRun = 0;
    state.tavily.callsThisRun = 0;
    state.groq.callsThisRun = 0;
    state.groq.tokensThisRun = 0;
    state.setlistfm.callsThisRun = 0;
    state.spotify.callsThisRun = 0;
    state.musicbrainz.callsThisRun = 0;

    return new UsageTracker(state);
  }

  note(text) {
    this._notes.push(text);
    console.log(`[usage] ${text}`);
  }

  // ---------------- Ticketmaster ----------------

  canCallTicketmaster() {
    const t = this.state.ticketmaster;
    if (t.callsThisRun >= t.perRunCap) return false;
    if (t.callsToday >= t.freeTierDailyLimit * 0.5) return false; // extra-safe daily backstop
    return true;
  }

  async recordTicketmasterCall() {
    const gap = Date.now() - this._lastTicketmasterCallAt;
    if (gap < config.TICKETMASTER.minDelayMs) await sleep(config.TICKETMASTER.minDelayMs - gap);
    this._lastTicketmasterCallAt = Date.now();
    this.state.ticketmaster.callsThisRun += 1;
    this.state.ticketmaster.callsToday += 1;
  }

  // ---------------- Tavily ----------------

  canCallTavily() {
    const t = this.state.tavily;
    if (t.callsThisRun >= t.perRunCap) return false;
    if (t.callsThisMonth >= t.monthlyCap) return false;
    return true;
  }

  async recordTavilyCall() {
    const gap = Date.now() - this._lastTavilyCallAt;
    if (gap < config.TAVILY.minDelayMs) await sleep(config.TAVILY.minDelayMs - gap);
    this._lastTavilyCallAt = Date.now();
    this.state.tavily.callsThisRun += 1;
    this.state.tavily.callsThisMonth += 1;
  }

  // ---------------- Groq ----------------

  canCallGroq(estimatedTokens = 1500) {
    const g = this.state.groq;
    if (g.callsThisRun >= g.perRunCap) return false;
    if (g.callsToday >= g.dailyCap) return false;
    // TPD is the real binding constraint for this pipeline (a full run's
    // total token usage matters more than any single minute) — stop
    // making calls once today's usage plus the next call's estimate would
    // approach the safe daily budget, well under the real 200,000 TPD
    // free-tier ceiling.
    if (g.tokensToday + estimatedTokens > g.safeTpd) return false;
    return true;
  }

  // Blocks (sleeps) until it's safe to make another Groq call without
  // breaching the real TPM limit, using actual token counts from prior
  // responses in the trailing 60s window. estimatedTokens is a rough
  // guess for the upcoming call (used only to decide whether to wait
  // longer); the real count gets recorded after the call via
  // recordGroqTokens().
  async waitForGroqSlot(estimatedTokens = 1500) {
    // Minimum gap between requests (RPM safety).
    const gap = Date.now() - this._lastGroqCallAt;
    if (gap < config.GROQ.minDelayMs) await sleep(config.GROQ.minDelayMs - gap);

    // TPM safety: purge the window and wait if adding the estimate would
    // exceed the safe cap.
    for (;;) {
      const cutoff = Date.now() - 60_000;
      this._groqWindow = this._groqWindow.filter((e) => e.at >= cutoff);
      const used = this._groqWindow.reduce((sum, e) => sum + e.tokens, 0);
      if (used + estimatedTokens <= config.GROQ.safeTpm) break;
      const oldest = this._groqWindow[0];
      const waitMs = oldest ? Math.max(1000, oldest.at + 60_000 - Date.now()) : 1000;
      this.note(`Groq TPM guard: waiting ${Math.round(waitMs / 1000)}s to stay under safe TPM cap`);
      await sleep(waitMs);
    }
    this._lastGroqCallAt = Date.now();
  }

  // Call counters are incremented here, right before the request goes out —
  // matching recordTicketmasterCall/recordTavilyCall, which both record
  // before attempting the call rather than after. Groq previously only
  // recorded on a successful, JSON-parseable response (see the old
  // recordGroqCall), which meant a thrown network error or a non-ok
  // response (429, 400, etc.) consumed a real request against Groq's
  // actual free-tier RPM/RPD quota but was never reflected in our own
  // counters — a real, if usually small, undercount risk for the exact
  // invariant ("never exceed real usage") this whole module exists to
  // protect. Token counts still can't be known until the response comes
  // back, so those are added separately via recordGroqTokens() on success.
  recordGroqAttempt() {
    this.state.groq.callsThisRun += 1;
    this.state.groq.callsToday += 1;
  }

  recordGroqTokens(actualTokens) {
    const tokens = Number.isFinite(actualTokens) ? actualTokens : 1500;
    this._groqWindow.push({ at: Date.now(), tokens });
    this.state.groq.tokensThisRun += tokens;
    this.state.groq.tokensToday += tokens;
  }

  // ---------------- setlist.fm ----------------

  canCallSetlistfm() {
    const s = this.state.setlistfm;
    if (s.callsThisRun >= s.perRunCap) return false;
    if (s.callsToday >= s.dailyCap) return false;
    return true;
  }

  async recordSetlistfmCall() {
    const gap = Date.now() - this._lastSetlistfmCallAt;
    if (gap < config.SETLISTFM.minDelayMs) await sleep(config.SETLISTFM.minDelayMs - gap);
    this._lastSetlistfmCallAt = Date.now();
    this.state.setlistfm.callsThisRun += 1;
    this.state.setlistfm.callsToday += 1;
  }

  // ---------------- Spotify ----------------

  canCallSpotify() {
    const s = this.state.spotify;
    if (s.callsThisRun >= s.perRunCap) return false;
    if (s.callsToday >= s.dailyCap) return false;
    return true;
  }

  async recordSpotifyCall() {
    const gap = Date.now() - this._lastSpotifyCallAt;
    if (gap < config.SPOTIFY.minDelayMs) await sleep(config.SPOTIFY.minDelayMs - gap);
    this._lastSpotifyCallAt = Date.now();
    this.state.spotify.callsThisRun += 1;
    this.state.spotify.callsToday += 1;
  }

  // ---------------- MusicBrainz (internal courtesy cap only; no daily allowance implied) ----------------
  canCallMusicbrainz() { return this.state.musicbrainz.callsThisRun < this.state.musicbrainz.perRunCap; }
  async recordMusicbrainzAttempt() {
    const gap = Date.now() - this._lastMusicbrainzCallAt;
    if (gap < config.MUSICBRAINZ.minDelayMs) await sleep(config.MUSICBRAINZ.minDelayMs - gap);
    this._lastMusicbrainzCallAt = Date.now();
    this.state.musicbrainz.callsThisRun += 1;
    this.state.musicbrainz.lastCallAt = new Date().toISOString();
  }

  // ---------------- Persistence ----------------

  finishRun(summary) {
    this.state.lastRun = {
      startedAt: this._startedAt || new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      ticketmasterCalls: this.state.ticketmaster.callsThisRun,
      tavilyCalls: this.state.tavily.callsThisRun,
      groqCalls: this.state.groq.callsThisRun,
      groqTokens: this.state.groq.tokensThisRun,
      setlistfmCalls: this.state.setlistfm.callsThisRun,
      spotifyCalls: this.state.spotify.callsThisRun,
      musicbrainzCalls: this.state.musicbrainz.callsThisRun,
      notes: this._notes,
      ...summary,
    };
  }

  finishMusicbrainzRun(summary) {
    this.state.lastMusicbrainzRun = {
      startedAt: this._startedAt || new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      mode: 'musicbrainz-only',
      musicbrainzCalls: this.state.musicbrainz.callsThisRun,
      identityUpdates: 0,
      notes: this._notes,
      ...summary,
    };
  }

  async save() {
    await worker.writeJson('apiUsage.json', this.state);
  }
}

module.exports = { UsageTracker, freshState, ensureMusicbrainzState };
