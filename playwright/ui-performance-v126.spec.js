const { test, expect } = require('@playwright/test');

test('v126 reuses an unchanged large My Bands DOM and rerenders visible changes', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');
  await expect(page.getByTestId('qa-banner')).toContainText('SYNTHETIC DATA');

  const result = await page.evaluate(() => {
    bands = Array.from({ length: 400 }, (_, index) => ({
      id: `perf-band-${index}`,
      name: `Performance Band ${String(index).padStart(3, '0')}`,
      genre: index % 2 ? 'Rock' : 'Metal',
      muted: false,
      lastKnownConcertDate: index % 4 === 0 ? '2020-01-01' : null,
      socials: {},
    }));
    concerts = Array.from({ length: 5000 }, (_, index) => ({
      id: `perf-show-${index}`,
      bandId: `perf-band-${index % 400}`,
      bandName: `Performance Band ${String(index % 400).padStart(3, '0')}`,
      date: `${2020 + (index % 6)}-06-01`,
      venue: 'Synthetic Hall',
      city: 'Synthetic City',
      country: 'Sweden',
      distanceKm: 10,
      attending: false,
    }));

    const screen = document.getElementById('screen-mybands');
    renderMyBandsScreen();
    const firstRowCount = screen.querySelectorAll('.row-card[data-band-id]').length;

    let mutations = 0;
    const observer = new MutationObserver((records) => { mutations += records.length; });
    observer.observe(screen, { childList: true, subtree: true });
    renderMyBandsScreen();
    observer.disconnect();

    bands[0].name = 'Performance Band Renamed';
    let changedMutations = 0;
    const changedObserver = new MutationObserver((records) => { changedMutations += records.length; });
    changedObserver.observe(screen, { childList: true, subtree: true });
    renderMyBandsScreen();
    changedObserver.disconnect();

    return {
      firstRowCount,
      unchangedMutations: mutations,
      changedMutations,
      renamedVisible: screen.textContent.includes('Performance Band Renamed'),
    };
  });

  expect(result.firstRowCount).toBe(400);
  expect(result.unchangedMutations).toBe(0);
  expect(result.changedMutations).toBeGreaterThan(0);
  expect(result.renamedVisible).toBe(true);
  expect(pageErrors).toEqual([]);
});
