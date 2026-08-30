const { test, expect } = require('@playwright/test');

test('v174 browser runtime preserves authoritative explicit event groups', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByTestId('qa-banner')).toContainText('SYNTHETIC DATA');

  const result = await page.evaluate(() => {
    const groupId = 'event-userowned-174';
    const records = [
      {
        id: 'browser-explicit-a', bandId: 'band-a', date: '2030-10-18',
        venue: 'Aviva Studios', city: 'Manchester', country: 'United Kingdom',
        eventGroupId: groupId, attending: true, lineupRole: 'support',
      },
      {
        id: 'browser-explicit-b', bandId: 'band-b', date: '2030-10-19',
        venue: 'AFAS Dome', city: 'Antwerp', country: 'Belgium',
        eventGroupId: groupId, attending: true, lineupRole: 'headliner',
      },
    ];
    const groups = EventModelV156.groupConcertPerformances(records);
    return {
      hasCorrection: typeof CanonicalEventGroupV174 !== 'undefined',
      count: groups.length,
      relationship: groups[0]?.relationship,
      groupId: groups[0]?.eventGroupId,
      valid: groups[0]?.validation?.valid,
      ids: groups[0]?.records?.map((record) => record.id),
    };
  });

  expect(errors).toEqual([]);
  expect(result.hasCorrection).toBe(true);
  expect(result.count).toBe(1);
  expect(result.relationship).toBe('explicit');
  expect(result.groupId).toBe('event-userowned-174');
  expect(result.valid).toBe(true);
  expect(result.ids).toEqual(['browser-explicit-a', 'browser-explicit-b']);
});
