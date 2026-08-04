  assert.ok(values.some((item) => item.source === 'spotify_import' && item.listenedAtMs == null && /^\d+$/.test(String(item.listenedAt))));
  assert.ok(values.some((item) => item.source === 'listenbrainz' && Number.isFinite(item.timestamp)));
  assert.ok(values.some((item) => item.listenedAt === 'not-a-real-date' && item.futureOptionalMetadata?.malformedButNonFatal));
  assert.ok(values.some((item) => stats.listenTimeMs(item) < Date.UTC(2011, 0, 1)));
});

test('current build facts, contrast and shell entries remain deterministic', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'listeningV81.css'), 'utf8');
  const concertCss = fs.readFileSync(path.join(__dirname, '..', 'concertCardsV86.css'), 'utf8');
  const brandCss = fs.readFileSync(path.join(__dirname, '..', 'bandmarkrV87.css'), 'utf8');
  const state = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'docs', 'LIVEVAULT_BUILD_STATE.json'), 'utf8'));
  assert.match(css, /start-refresh-btn svg/);
  assert.match(css, /@media\(min-width:391px\)/);
  assert.match(concertCss, /--concert-card-background-v86:\s*#232a32/);
  assert.match(brandCss, /--bandmarkr-blue:\s*#024ddf/);
  assert.equal(state.appVersion, 'v89');
  assert.equal(state.serviceWorkerCacheVersion, 'v89');
  assert.ok(state.shellFiles.includes('concertCardsV86.css'));
  assert.ok(state.shellFiles.includes('bandmarkrV87.css'));
  assert.ok(state.shellFiles.includes('listeningV82Corrections.js'));
  assert.ok(state.shellFiles.includes('listeningV82GenreFix.js'));
  assert.ok(state.shellFiles.includes('listeningV83ChartFix.js'));
  assert.ok(state.shellFiles.includes('listeningV84ChartRenderFix.js'));
  assert.ok(state.shellFiles.includes('listeningV85RankingAndStatsUnits.js'));
  assert.ok(state.shellFiles.includes('listeningDerivedStorage.js'));
});