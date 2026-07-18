'use strict';
// Intentionally fictional QA data. It is the only data source for QA builds.
window.LiveVaultQaFixtures = {
  bands: [
    { id: 'qa-artist-one', name: 'QA Artist One', favorite: true, musicbrainz: { mbid: 'qa-mbid-one', status: 'confirmed', artistName: 'QA Artist One', ticketmaster: { id: 'qa-tm-one', status: 'confirmed', artistName: 'QA Artist One' }, spotify: { id: 'qa-spotify-one', status: 'confirmed', artistName: 'QA Artist One' } }, futureFeatureData: { keep: true } },
    { id: 'qa-artist-two', name: 'QA Artist Two With An Intentionally Long Artist Name', muted: true, musicbrainz: { status: 'needs_review', reviewCandidates: [{ id: 'qa-candidate', artistName: 'QA Artist Two' }], spotify: { status: 'error', nextEligibleCheckAt: '2027-06-14T12:00:00.000Z' }, ticketmaster: { status: 'no_match', nextEligibleCheckAt: '2027-07-01T12:00:00.000Z' } } },
    { id: 'qa-empty', name: 'QA Empty Artist', musicbrainz: { status: 'confirmed', mbid: 'qa-empty-mbid' } }
  ],
  concerts: [
    { id: 'qa-show-day', bandId: 'qa-artist-one', bandName: 'QA Artist One', date: '2027-07-16', time: '20:00', venue: 'Example Arena', city: 'Sample City', country: 'Exampleland', attending: true, ticketUrl: 'https://qa.invalid/tickets/show-day', ownedTickets: [{ id: 'qa-url-ticket', type: 'url', url: 'https://qa.invalid/tickets/show-day', addedAt: '2027-01-01T00:00:00.000Z' }], playlistUrl: 'https://example.invalid/playlist', prepChecklist: { ticketReady: true, travelPlanned: true }, predictedSetlist: { status: 'ready', songs: [{ name: 'Synthetic Song', spotifyUrl: 'https://open.spotify.com/track/qa', spotifyUri: 'spotify:track:qa', spotifyMatched: true }] }, weather: { status: 'ready' }, sourceProvider: 'ticketmaster', providerEventId: 'qa-event-one', providerAttractionId: 'qa-tm-one', futureFeatureData: { preserved: true } },
    { id: 'qa-two-pdf', bandId: 'qa-artist-one', bandName: 'QA Artist One', date: '2027-07-18', time: '19:00', venue: 'Test Hall', city: 'Sample City', country: 'Exampleland', attending: true, ownedTickets: [{ id: 'qa-pdf-one', type: 'pdf', addedAt: '2027-01-02T00:00:00.000Z', sizeBytes: 20 }, { id: 'qa-pdf-two', type: 'pdf', addedAt: '2027-01-03T00:00:00.000Z', sizeBytes: 20 }], prepChecklist: { ticketReady: true }, ticketUrl: 'https://qa.invalid/tickets/two' },
    { id: 'qa-past', bandId: 'qa-artist-one', bandName: 'QA Artist One', date: '2027-05-01', venue: 'Example Arena', city: 'Sample City', country: 'Exampleland', attending: true, attended: true, rating: 5, notes: 'Synthetic note only', photos: ['synthetic-photo'], setlist: { url: 'https://setlist.fm/qa', songs: [{ name: 'Synthetic Song', isEncore: true, spotifyUrl: 'https://open.spotify.com/track/qa', spotifyUri: 'spotify:track:qa' }] }, setlistInsights: { status: 'ready', insights: [{ normalizedName: 'synthetic song', label: 'Rare' }] } },
    { id: 'qa-tavily', bandId: 'qa-artist-two', bandName: 'QA Artist Two With An Intentionally Long Artist Name', date: '2027-07-20', venue: 'A Very Long Example Venue Name For Responsive QA', city: 'Very Long Sample City Name', country: 'Exampleland', sourceProvider: 'tavily_groq', articleUrl: 'https://example.invalid/article' }
  ],
  news: [
    { id: 'qa-alert-one', bandId: 'qa-artist-one', bandName: 'QA Artist One', category: 'concert', headline: 'Synthetic concert alert', foundAt: '2027-06-01T00:00:00.000Z' },
    { id: 'qa-news-two', bandId: 'qa-artist-two', bandName: 'QA Artist Two With An Intentionally Long Artist Name', category: 'album', headline: 'Synthetic album release alert', foundAt: '2027-06-02T00:00:00.000Z' }
  ],
  apiUsage: { ticketmaster: { callsToday: 1, dailyCap: 2500 }, tavily: { callsThisMonth: 1, monthlyCap: 900 }, groq: { tokensToday: 1, dailyCap: 150000 }, setlistfm: { callsToday: 1, dailyCap: 1200 } }
};
