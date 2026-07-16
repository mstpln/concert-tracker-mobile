'use strict';
// Minimal, dependency-free inline SVG icon set (no external font/CDN —
// MV3 extensions shouldn't rely on remote resources for core UI).

const ICONS = {
  music:
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="18" r="3"/><path d="M9 18V4l10-2v14"/><circle cx="19" cy="16" r="3"/></svg>',
  users:
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="8" r="3"/><path d="M2 20c0-3.3 3-6 7-6s7 2.7 7 6"/><circle cx="17" cy="9" r="2.5"/><path d="M16 14c2.8 0 6 1.6 6 5"/></svg>',
  chevronRight:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg>',
  chevronDown:
    '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>',
  mapPin:
    '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s7-6.5 7-11.5A7 7 0 0 0 5 9.5C5 14.5 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.3"/></svg>',
  back:
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 6l-6 6 6 6"/></svg>',
  plus:
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>',
  settings:
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.2a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H2a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3h.1a1.7 1.7 0 0 0 1-1.5V2a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5h.1a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9v.1a1.7 1.7 0 0 0 1.5 1H22a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  ticket:
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z"/><path d="M13 6v12" stroke-dasharray="2 2"/></svg>',
  ticketStub:
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z"/><path d="M13 6v12" stroke-dasharray="2 2"/></svg>',
  link:
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 14L20 4"/><path d="M14 4h6v6"/><path d="M20 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h5"/></svg>',
  // Dedicated photo/album-link icon (My Concerts, past shows) — replaces the
  // generic `link` glyph so a photo link reads as "photos" at a glance
  // instead of a plain hyperlink.
  photo:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="14" rx="2"/><circle cx="8.5" cy="9.5" r="1.5"/><path d="M21 15l-5-5L5 19"/></svg>',
  // Setlist icon (My Concerts, past shows) — "ordered list" concept chosen
  // over 9 alternatives (sheet music, clipboard, torn ticket, mic, queue,
  // guitar pick, vinyl, megaphone, list+note) since a lock-shaped earlier
  // draft read ambiguously; three ruled lines with a leading dot each reads
  // clearly as a numbered/ordered list of songs.
  setlistOrdered:
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><line x1="9" y1="6" x2="20" y2="6"/><line x1="9" y1="12" x2="20" y2="12"/><line x1="9" y1="18" x2="20" y2="18"/><circle cx="4.5" cy="6" r="1.3" fill="currentColor" stroke="none"/><circle cx="4.5" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="4.5" cy="18" r="1.3" fill="currentColor" stroke="none"/></svg>',
  edit:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  trash:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>',
  close:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>',
  instagram:
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1"/></svg>',
  spotify:
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M7.5 10.5c3-1 6.5-1 9 .8M8 14c2.3-.7 5-.7 7 .6"/></svg>',
  folder:
    '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  globe:
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.5 2.5 3.8 5.7 3.8 9s-1.3 6.5-3.8 9c-2.5-2.5-3.8-5.7-3.8-9s1.3-6.5 3.8-9z"/></svg>',
  check:
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 6L9 17l-5-5"/></svg>',
  calendarCheck:
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18"/><path d="M8 2v4M16 2v4"/><path d="M8.5 14l2 2 4.5-4.5"/></svg>',
  calendarPlus:
    '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18"/><path d="M8 2v4M16 2v4"/><path d="M12 13v6M9 16h6"/></svg>',
  moon:
    '<svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5z"/></svg>',
  // App brand mark for the header (root tab level, next to "CONCERTDATES").
  // Sized to 32x32 to match the height of the EU-filter/settings icon
  // buttons in #app-header for visual alignment. Simplified to a single
  // blue square accent (top-right) — the full 3x2 grid read as visual
  // noise at this small size.
  calendarBrand:
    '<svg viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="5" width="18" height="16" rx="3"/><line x1="3" y1="9" x2="21" y2="9"/><rect x="7" y="2.5" width="2" height="4" rx="1" fill="currentColor" stroke="none"/><rect x="15" y="2.5" width="2" height="4" rx="1" fill="currentColor" stroke="none"/><rect x="15" y="12" width="3" height="3" rx="0.5" fill="#024ddf" stroke="none"/></svg>',
  // Header "Nearby" filter button glyph, next to the EU pill. Simple outline
  // pin — same visual language as the settings gear/back chevron — sized to
  // 16x16 for the 32x32 #app-header icon-btn.
  nearbyPin:
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-6.5 7-11.5A7 7 0 0 0 5 9.5C5 14.5 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.3"/></svg>',
  // News tab icon — simple article/page glyph (rounded page + 3 text
  // lines), matching the tab bar's 16x16 line-icon sizing.
  newsArticle:
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="3" width="14" height="18" rx="2"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="16" y2="12"/><line x1="8" y1="16" x2="13" y2="16"/></svg>',
  // Rating stars (My Concerts, past shows). Outline for the unfilled state,
  // solid-fill reusing the same path for the filled state — kept to the
  // app's blue accent (--accent) via currentColor, never a separate hue.
  star:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>',
  starFill:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="none"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/></svg>',
  // Favorite-band toggle (band profile header) + favorited-alert badge
  // (Alerts list). Deliberately a single neutral color via currentColor in
  // both states, same as the star rating icons above — outline vs filled is
  // the only signal, no blue accent, per explicit design direction (favoriting
  // a band is a different concept from the 5-star concert rating, so it gets
  // its own glyph, but stays inside the app's grey/white/black/blue palette
  // by not introducing a new hue for it).
  heart:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>',
  heartFill:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" stroke="none"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>',
  // Alerts tab icon — replaces the old News-only article glyph now that
  // this tab covers both the News feed and the new "show added" alerts.
  bell:
    '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
  // Mute-band toggle (band profile header). Bell-off reads as "silence
  // future alerts from this band" — chosen over eye-off/speaker-mute since
  // it pairs directly with the plain `bell` glyph already used for Alerts,
  // making clear this only affects the alert/discovery side, not deleting
  // or hiding the band itself. Same single-color, outline-only treatment as
  // heart/star — currentColor, no new hue.
  bellOff:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13.73 21a2 2 0 0 1-3.46 0"/><path d="M18 8a6 6 0 0 0-9.33-5"/><path d="M6.26 6.26A6 6 0 0 0 6 8c0 7-3 9-3 9h14"/><path d="M18 12.5V8"/><line x1="1" y1="1" x2="23" y2="23"/></svg>',
  // Show/hide toggle for the Groq API key password field in Settings (long
  // key, easy to mistype blind) — plain eye / eye-with-slash pair, same
  // single-color outline treatment as every other icon here.
  eye:
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff:
    '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.4 17.4A11 11 0 0 1 12 19c-7 0-11-7-11-7a19.6 19.6 0 0 1 4.6-5.4"/><path d="M9.9 5.2A8.6 8.6 0 0 1 12 5c7 0 11 7 11 7a19.4 19.4 0 0 1-2.2 3.1"/><path d="M14.1 14.1a3 3 0 1 1-4.2-4.2"/><line x1="1" y1="1" x2="23" y2="23"/></svg>',
  // Settings > Research pipeline usage cards (4 icons below) — small
  // detail-row glyphs, same 13px outline treatment as the rest of the set.
  key:
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7.5" cy="15.5" r="4.5"/><path d="M10.9 12.1L20 3"/><path d="M15.5 7.5l3 3"/><path d="M18 5l3 3"/></svg>',
  // Plain calendar (no internal mark) — distinct from calendarCheck/
  // calendarPlus above, used where the date itself is the only signal.
  calendarPlain:
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18"/><path d="M8 2v4M16 2v4"/></svg>',
  // Ascending bars — "limits/usage" concept, paired with shieldCheck below
  // for the "real limit vs our own safety cap" distinction on usage cards.
  gauge:
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="21" x2="5" y2="13"/><line x1="12" y1="21" x2="12" y2="7"/><line x1="19" y1="21" x2="19" y2="3"/></svg>',
  shieldCheck:
    '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5c0 5-3.3 8.5-7 10-3.7-1.5-7-5-7-10V6z"/><path d="M9 12l2 2 4-4"/></svg>',
  // Local, compact provider marks used only on Settings usage cards. They
  // are inline SVGs so no third-party asset or runtime network request is
  // needed to render recognizable provider branding.
  providerTicketmaster:
    '<svg viewBox="0 0 28 28" aria-hidden="true"><rect width="28" height="28" rx="5" fill="#026CDF"/><text x="14" y="19.5" text-anchor="middle" fill="#fff" font-family="Arial,sans-serif" font-size="15" font-style="italic" font-weight="700">tm</text></svg>',
  providerTavily:
    '<svg viewBox="0 0 28 28" aria-hidden="true"><rect width="28" height="28" rx="5" fill="#0497A5"/><text x="14" y="17.5" text-anchor="middle" fill="#fff" font-family="Arial,sans-serif" font-size="10" font-weight="700">tavily</text></svg>',
  providerGroq:
    '<svg viewBox="0 0 28 28" aria-hidden="true"><rect width="28" height="28" rx="5" fill="#fff"/><text x="14" y="17.5" text-anchor="middle" fill="#171717" font-family="Arial,sans-serif" font-size="9" font-weight="700">groq</text></svg>',
  providerSetlistfm:
    '<svg viewBox="0 0 28 28" aria-hidden="true"><rect width="28" height="28" rx="5" fill="#07100d"/><text x="14" y="14" text-anchor="middle" fill="#fff" font-family="Arial,sans-serif" font-size="7" font-weight="700">setlist</text><text x="14" y="20" text-anchor="middle" fill="#c8df00" font-family="Arial,sans-serif" font-size="7" font-weight="700">.fm</text></svg>',
  providerSpotify:
    '<svg viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="14" fill="#1DB954"/><path d="M7.2 10.8c4.3-1.3 9.2-.8 13.2 1.1M7.8 14.4c3.5-1 7.3-.6 10.5.9M8.6 17.7c2.6-.7 5.4-.4 7.7.7" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round"/></svg>',
};

function icon(name) {
  return ICONS[name] || '';
}
