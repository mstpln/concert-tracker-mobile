const { test, expect } = require('@playwright/test');

async function openSettings(page) {
  await page.goto('/');
  await page.getByTestId('settings-button').click();
  await expect(page.locator('#screen-settings')).toBeVisible();
}

async function expectNoHorizontalOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
}

test('Settings v123 uses one consistent Automation presentation', async ({ page }) => {
  await openSettings(page);
  const screen = page.locator('#screen-settings');
  await expect(screen.getByRole('tab', { name:'Automation' })).toHaveAttribute('aria-selected','true');
  await expect(screen.getByText('PROVIDER USAGE', { exact:true })).toBeVisible();
  await expect(screen.getByText('UPDATE ACTIVITY', { exact:true })).toBeVisible();
  await expect(screen.getByText('Ticketmaster', { exact:true })).toBeVisible();
  await expect(screen.getByText('MusicBrainz', { exact:true })).toBeVisible();
  await expect(screen.getByText('ListenBrainz', { exact:true })).toBeVisible();
  await expect(screen.locator('.settings-v123-section')).toHaveCount(2);
  const divider = screen.locator('.settings-v123-section').nth(1);
  await expect(divider).toHaveCSS('border-top-width','2px');
  await expect(divider).toHaveCSS('border-top-color','rgb(2, 77, 223)');
  expect(await screen.locator('.settings-v123-progress').count()).toBeGreaterThan(0);

  const groqRow = screen.locator('.settings-v123-provider-wrap').filter({ hasText:'Groq' });
  await groqRow.getByRole('button', { name:'Details' }).click();
  await expect(groqRow.getByText('Device key (optional)', { exact:true })).toBeVisible();
  await expect(groqRow.locator('[data-v123-groq-key]')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

test('Settings tabs support roving keyboard navigation', async ({ page }) => {
  await openSettings(page);
  const screen = page.locator('#screen-settings');
  const automation = screen.getByRole('tab', { name:'Automation' });
  await automation.focus();
  await page.keyboard.press('ArrowRight');
  await expect(screen.getByRole('tab', { name:'Review' })).toHaveAttribute('aria-selected','true');
  await expect(screen.getByRole('tab', { name:'Review' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(screen.getByRole('tab', { name:'Data' })).toHaveAttribute('aria-selected','true');
  await expect(screen.getByRole('tab', { name:'Data' })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(screen.getByRole('tab', { name:'Automation' })).toHaveAttribute('aria-selected','true');
  await expect(screen.getByRole('tab', { name:'Automation' })).toBeFocused();
});

test('Review summary stays neutral, truthful and horizontal on narrow mobile widths', async ({ page }) => {
  await page.setViewportSize({ width:360, height:800 });
  await openSettings(page);
  const screen = page.locator('#screen-settings');
  await screen.getByRole('tab', { name:'Review' }).click();
  await expect(screen.getByRole('tab', { name:'Review' })).toHaveAttribute('aria-selected','true');
  await expect(screen.getByText('REVIEW SUMMARY', { exact:true })).toBeVisible();
  const pills = screen.locator('.settings-v123-summary-grid > span');
  await expect(pills).toHaveCount(3);
  await expect(pills.nth(2)).toContainText('Deferred');
  expect(Number((await pills.nth(2).locator('b').textContent()) || 0)).toBe(0);
  const boxes = await pills.evaluateAll((nodes) => nodes.map((node) => node.getBoundingClientRect().toJSON()));
  expect(Math.max(...boxes.map((box) => box.y)) - Math.min(...boxes.map((box) => box.y))).toBeLessThan(2);
  expect(boxes.every((box) => box.width > 70)).toBe(true);
  const colors = await pills.evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).color));
  expect(new Set(colors).size).toBe(1);
  const reviewStatuses = screen.locator('.settings-v123-review-item .settings-v123-status');
  if (await reviewStatuses.count()) {
    const statusColors = await reviewStatuses.evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).color));
    expect(new Set(statusColors).size).toBe(1);
    await expect(reviewStatuses.first()).toContainText('Needs review');
  }
  await expectNoHorizontalOverflow(page);
});

test('Data presents coverage, connections, export and device controls without old branding', async ({ page }) => {
  await page.setViewportSize({ width:390, height:844 });
  await openSettings(page);
  const screen = page.locator('#screen-settings');
  await screen.getByRole('tab', { name:'Data' }).click();
  await expect(screen.getByText('DATA COVERAGE', { exact:true })).toBeVisible();
  await expect(screen.getByText('CONNECTIONS', { exact:true })).toBeVisible();
  await expect(screen.getByText('EXPORT', { exact:true })).toBeVisible();
  await expect(screen.getByText('DEVICE', { exact:true })).toBeVisible();
  for (const label of ['ARTIST IDS','ARTIST PROFILES','CONCERT DATA','LISTENING DATA']) {
    await expect(screen.getByText(label, { exact:true })).toBeVisible();
  }
  await expect(screen.getByText('Images', { exact:true })).toBeVisible();
  await expect(screen.getByText('Descriptions', { exact:true })).toBeVisible();
  await expect(screen.getByText('Venue information', { exact:true })).toBeVisible();
  await expect(screen.getByText('Songs identified', { exact:true })).toBeVisible();
  await expect(screen.getByText('Album artwork', { exact:true })).toBeVisible();
  await expect(screen).not.toContainText('Live Vault');
  await expect(screen).not.toContainText('LiveVault');
  await expect(screen.locator('.settings-v123-section')).toHaveCount(4);
  await expect(screen.locator('.settings-v123-maintenance')).toBeVisible();
  await expectNoHorizontalOverflow(page);
});

for (const colorScheme of ['light','dark']) {
  test(`Settings v123 follows the ${colorScheme} app theme`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await openSettings(page);
    const card = page.locator('#screen-settings .settings-v123-card').first();
    const values = await card.evaluate((node) => ({
      card: getComputedStyle(node).backgroundColor,
      surface: getComputedStyle(document.documentElement).getPropertyValue('--surface').trim(),
      muted: getComputedStyle(document.documentElement).getPropertyValue('--surface-muted').trim(),
    }));
    const rgb = (hex) => {
      const value = hex.replace('#','');
      return `rgb(${parseInt(value.slice(0,2),16)}, ${parseInt(value.slice(2,4),16)}, ${parseInt(value.slice(4,6),16)})`;
    };
    expect(values.card).toBe(rgb(values.surface));
    expect(values.muted).not.toBe('');
    await expectNoHorizontalOverflow(page);
  });
}

for (const width of [360,390,430]) {
  test(`Settings remains contained at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height:900 });
    await openSettings(page);
    const screen = page.locator('#screen-settings');
    for (const tab of ['Automation','Review','Data']) {
      await screen.getByRole('tab', { name:tab }).click();
      await expectNoHorizontalOverflow(page);
    }
  });
}

test('Review shows safe distinct provider profile links before choosing same-name artists', async ({ page }) => {
  await page.setViewportSize({ width:360, height:800 });
  await openSettings(page);
  await page.evaluate(() => {
    bands = [{ id:'qa-mb', name:'Synthetic MusicBrainz Artist', musicbrainz:{
      status:'needs_review', reviewCandidates:[
        { mbid:'11111111-1111-4111-8111-111111111111', artistName:'Same Name', area:'Sweden' },
        { mbid:'22222222-2222-4222-8222-222222222222', artistName:'Same Name', area:'Denmark' },
      ],
    } }];
    window.ListeningSpotifyIdentityReview.auditSpotifyArtistIdentities = () => [{
      bandId:'qa-spotify', bandName:'Synthetic Spotify Artist', status:'needs_review',
      actionState:'candidate_available', duplicateConflict:false,
      candidates:[
        { id:'1111111111111111111111', artistName:'Same Name' },
        { id:'2222222222222222222222', artistName:'Same Name' },
      ],
      affectedListens:{ allTime:0, twoWeeks:0, threeMonths:0, oneYear:0, spotify:0 },
      distinctSpotifyTrackIds:0, firstAffectedAt:null, lastAffectedAt:null,
    }];
  });
  const screen = page.locator('#screen-settings');
  await screen.getByRole('tab', { name:'Review' }).click();
  const spotify = screen.locator('[data-v123-artist-review]').filter({ hasText:'Synthetic Spotify Artist' });
  const musicbrainz = screen.locator('[data-v123-artist-review]').filter({ hasText:'Synthetic MusicBrainz Artist' });
  await expect(spotify.getByRole('button', { name:'Use this artist' })).toHaveCount(2);
  await expect(spotify.getByRole('link', { name:'View on Spotify' })).toHaveCount(2);
  await expect(musicbrainz.getByRole('link', { name:'View on MusicBrainz' })).toHaveCount(2);
  const spotifyLinks = await spotify.getByRole('link', { name:'View on Spotify' }).evaluateAll((links) =>
    links.map((link) => ({ href:link.href, target:link.target, rel:link.rel })));
  expect(spotifyLinks.map((link) => link.href)).toEqual([
    'https://open.spotify.com/artist/1111111111111111111111',
    'https://open.spotify.com/artist/2222222222222222222222',
  ]);
  expect(spotifyLinks.every((link) => link.target === '_blank' && link.rel.includes('noopener') && link.rel.includes('noreferrer'))).toBe(true);
  const profileLink = spotify.getByRole('link', { name:'View on Spotify' }).first();
  for (const [scheme, expectedColor] of [['light','rgb(11, 87, 208)'], ['dark','rgb(127, 176, 255)']]) {
    await page.emulateMedia({ colorScheme:scheme });
    await expect(profileLink).toHaveCSS('color', expectedColor);
  }
  await expectNoHorizontalOverflow(page);
});
