'use strict';
const { test, expect } = require('@playwright/test');
async function setup(page, width, scheme, past=true) {
  await page.emulateMedia({ colorScheme:scheme, reducedMotion:'reduce' });
  await page.setViewportSize({ width, height:900 });
  await page.goto('/');
  await expect(page.getByTestId('qa-banner')).toContainText('SYNTHETIC DATA');
  await page.evaluate(withPast => {
    const b = bands[0], now = typeof dlCurrentDate==='function' ? dlCurrentDate() : new Date();
    if (!b) throw new Error('Missing synthetic QA band');
    now.setDate(now.getDate() - 12);
    const date = [now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
    concerts = withPast ? [{id:'qa-v185-past',bandId:b.id,bandName:b.name,date,time:'19:30',
      venue:'Synthetic Hall',city:'QA City',country:'Denmark',attending:true,ownedTickets:[],prepChecklist:{}}] : [];
    renderMyConcertsScreen();
  },past);
  await expect(page.locator('#screen-myconcerts')).toHaveAttribute('data-music-section-v183','highlights');
  await expect(page.locator('#screen-myconcerts .start-top-bands-card')).toBeVisible();
  if (past) await expect(page.locator('#screen-myconcerts .stats-teaser-card')).toBeVisible();
}
const geometry = page => page.evaluate(() => {
  const screen = document.querySelector('#screen-myconcerts');
  const tab = screen.querySelector(':scope > .music-primary-tabs-v183').getBoundingClientRect();
  const listening = screen.querySelector(':scope > .myconcerts-summary > .start-top-bands-card').getBoundingClientRect();
  const stats = screen.querySelector(':scope > .myconcerts-summary > .stats-teaser-card')?.getBoundingClientRect();
  return {
    tabTop:tab.top,tabHeight:tab.height,
    belowTabs:listening.top-tab.bottom,between:stats?stats.top-listening.bottom:null,
    listeningHeight:listening.height,statsHeight:stats?.height??null,
    lastBottom:stats?.bottom??listening.bottom,
    bottomNavTop:document.querySelector('#tabbar').getBoundingClientRect().top
  };
});
for (const [width,scheme] of [[320,'dark'],[375,'dark'],[390,'light'],[480,'light']]) {
  test('v185 balanced Highlights ' + width + 'px ' + scheme, async ({page},testInfo) => {
    await setup(page,width,scheme);
    const revised = await geometry(page);
    expect(revised.tabHeight).toBe(33);
    expect(revised.belowTabs).toBeGreaterThanOrEqual(11);
    expect(revised.belowTabs).toBeLessThanOrEqual(13);
    expect(revised.between).toBeGreaterThanOrEqual(11);
    expect(revised.between).toBeLessThanOrEqual(13);
    const style = await page.addStyleTag({content:[
      '#screen-myconcerts[data-music-section-v183="highlights"] > .music-primary-tabs-v183 {margin-bottom:14px !important;}',
      '#screen-myconcerts[data-music-section-v183="highlights"] > .myconcerts-summary {margin-top:20px !important;}',
      '#screen-myconcerts[data-music-section-v183="highlights"] > .myconcerts-summary > .start-top-bands-card {margin-bottom:16px !important;}'
    ].join('\n')});
    const previous = await geometry(page);
    expect(previous.tabTop).toBe(revised.tabTop);
    expect(previous.tabHeight).toBe(revised.tabHeight);
    expect(previous.listeningHeight).toBe(revised.listeningHeight);
    expect(previous.statsHeight).toBe(revised.statsHeight);
    expect(previous.bottomNavTop).toBe(revised.bottomNavTop);
    expect(previous.belowTabs-revised.belowTabs).toBeGreaterThanOrEqual(7);
    expect(previous.between-revised.between).toBeGreaterThanOrEqual(3);
    expect(previous.lastBottom-revised.lastBottom).toBeGreaterThanOrEqual(10);
    expect(previous.lastBottom-revised.lastBottom).toBeLessThanOrEqual(14);
    await style.evaluate(node=>node.remove());
    await page.locator('#screen-myconcerts').screenshot({path:testInfo.outputPath('v185-highlights-'+width+'-'+scheme+'.png')});
    await page.locator('#music-tab-concerts').click();
    await expect(page.locator('#screen-myconcerts .music-last-v183')).toBeVisible();
    await expect(page.locator('#screen-myconcerts .music-primary-tabs-v183')).toHaveCSS('margin-bottom','14px');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });
}
test('v185 Highlights with no attended concerts remains a single card',async ({page})=>{
  await setup(page,375,'dark',false);
  await expect(page.locator('#screen-myconcerts .stats-teaser-card')).toHaveCount(0);
  const g=await geometry(page);
  expect(g.belowTabs).toBeGreaterThanOrEqual(11);
  expect(g.belowTabs).toBeLessThanOrEqual(13);
  await expect(page.locator('#tabbar')).toBeVisible();
});
