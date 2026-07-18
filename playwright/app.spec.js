const { test, expect } = require('@playwright/test');
test('synthetic app starts, navigates, persists checklist, and resets', async ({ page }, testInfo) => {
    const forbidden = []; page.on('request', (request) => { if (!['http://127.0.0.1:4173', 'https://qa.invalid'].includes(new URL(request.url()).origin)) forbidden.push(request.url()); });
    await page.goto('/'); await expect(page.getByTestId('qa-banner')).toContainText('SYNTHETIC DATA'); await expect(page.locator('#onboarding')).toBeHidden();
    await page.getByRole('button', { name: 'Bands' }).click(); await expect(page.locator('#screen-mybands')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`${testInfo.project.name}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Concerts' }).click(); const checklist = page.locator('[data-prep-key]').first(); await checklist.check(); await page.reload(); await expect(page.locator('[data-prep-key]').first()).toBeChecked();
    await page.getByTestId('qa-reset').click(); await page.waitForLoadState('domcontentloaded'); expect(forbidden).toEqual([]); await expect(page.locator('body')).not.toHaveCSS('overflow-x', 'scroll');
});
