'use strict';

// The scheduled release pipeline stores Spotify availability as a dedicated
// lifecycle stage. Keep the visible label tied to the actual catalogue type
// instead of falling back to the older announcement wording in app.js.
if (typeof RELEASE_ALERT_STAGES !== 'undefined') {
  RELEASE_ALERT_STAGES.spotify_album_release = {
    tag: 'NEW ALBUM',
    copy: 'A new album is available on Spotify.',
  };
  RELEASE_ALERT_STAGES.spotify_single_release = {
    tag: 'NEW SINGLE',
    copy: 'A new single is available on Spotify.',
  };
  // Compatibility for any alert produced by the short-lived generic stage.
  RELEASE_ALERT_STAGES.spotify_release = {
    tag: 'NEW RELEASE',
    copy: 'A new release is available on Spotify.',
  };
}
