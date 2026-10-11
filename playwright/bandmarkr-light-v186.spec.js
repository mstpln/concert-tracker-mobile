'use strict';
const { test, expect } = require('@playwright/test');

async function setup(page, width, colorScheme) {
  await page.emulateMedia({ colorScheme, reducedMotion:'reduce' });
  await page.setViewportSize({ width, height:880 });
  await page.goto('/');
  await expect(page.getByTestId('qa-banner')).toContainText('SYNTHETIC DATA');
}
const DATE = days => {
  // Executed in the test runner only; actual synthetic fixtures are created
  // relative to dlCurrentDate inside page.evaluate to avoid clock drift.
  return days;
};
async function installShows(page) {
  await page.evaluate(() => {
    const now = typeof dlCurrentDate === 'function' ? dlCurrentDate() : new Date();
    const dateAt = (days) => {
      const d = new Date(now);
      d.setDate(d.getDate() + days);
      return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
    };
    const make = (id, band, days, rest = {}) => ({
      id, bandId:band.id, bandName:band.name, date:dateAt(days), time:'19:30',
      venue:'Synthetic Arena', city:'QA City', country:'Denmark',
      venueAddress:'1 Fixture Road', attending:true, ownedTickets:[],
      prepChecklist:{}, ...rest,
    });
    concerts = [
      make('qa-v186-next',bands[0],12),
      make('qa-v186-upcoming',bands[1],36),
      make('qa-v186-past',bands[0],-33),
      make('qa-v186-cancelled',bands[1],-18,{personalLifecycleStatus:'cancelled'}),
    ];
    renderMyConcertsScreen();
    concertsSubTab = 'concerts';
    renderConcertsScreen();
  });
}

async function cardColor(locator, expected) {
  await expect(locator).toBeVisible();
  await expect.poll(() => locator.evaluate(el => getComputedStyle(el).backgroundColor)).toBe(expected);
}
async function primarySource(page, selector) {
  const button = page.locator(selector).first();
  await expect(button).toBeVisible();
  await expect.poll(() => button.evaluate(b => b.style.getPropertyValue('--v186-first-letter-x'))).toMatch(/px$/);
  const outcome = await button.evaluate(btn => {
    const firstNode = (() => {
      const walker = document.createTreeWalker(btn, NodeFilter.SHOW_TEXT); let n;
      while ((n=walker.nextNode())) { if (/\S/.test(n.textContent)) return n; }
      return null;
    })();
    const offset = firstNode.textContent.search(/\S/);
    const r = document.createRange();
    r.setStart(firstNode,offset);r.setEnd(firstNode,offset+1);
    const letter = r.getBoundingClientRect(), box = btn.getBoundingClientRect();
    const expected = letter.left+letter.width/2-box.left;
    return { configured:parseFloat(btn.style.getPropertyValue('--v186-first-letter-x')),
      expected, height:box.height, image:getComputedStyle(btn).backgroundImage };
  });
  expect(Math.abs(outcome.configured-outcome.expected)).toBeLessThan(1.5);
  expect(outcome.image).toContain('linear-gradient');
  return outcome;
}
for(const width of [320,375,480]){
  for(const scheme of ['dark','light']){
    test('v186 blue lighting, content isolation and all concert surfaces at '+width+'px '+scheme, async({page},testInfo)=>{
      await setup(page,width,scheme);
      await installShows(page);
      const color = scheme==='dark' ? 'rgb(35, 42, 50)' : 'rgb(238, 241, 245)';
      const banner = page.locator('.brand-banner');
      await expect(banner).toHaveCSS('background-image',/radial-gradient.*linear-gradient/s);
      const oldBrandSize = await banner.evaluate(el => ({
        height:el.getBoundingClientRect().height,
        width:el.querySelector('.brand-wordmark')?.getBoundingClientRect().width,
      }));
      expect(oldBrandSize.height).toBe(60);
      expect(oldBrandSize.width).toBe(150);
      const music = await primarySource(page,'#screen-myconcerts .music-primary-tabs-v183 .stats-subtab-btn.active');
      // Existing v181 geometry is a 33px outer tab strip with 1px borders,
      // so its inner buttons are 31px. The new effect must not change either.
      await expect(page.locator('#screen-myconcerts .music-primary-tabs-v183')).toHaveCSS('height','33px');
      expect(music.height).toBe(31);
      const nav = page.locator('#tabbar .tabitem.active');
      await expect(nav).toHaveCSS('background-image',/linear-gradient/);
      await expect(nav).toHaveCSS('background-color','rgb(2, 77, 223)');
      await expect(nav).toContainText('Music');
      const topList = page.locator('#screen-myconcerts .start-top-bands-card');
      const stats = page.locator('#screen-myconcerts .stats-teaser-card');
      await expect(topList).toBeVisible();
      await expect(stats).toBeVisible();
      for(const card of [topList,stats]){
        const pseudo=await card.evaluate(el=>({
          border:getComputedStyle(el).borderTopWidth,
          glow:getComputedStyle(el,'::before').backgroundImage,
          mask:getComputedStyle(el,'::before').maskComposite,
        }));
        expect(pseudo.border).toBe('1px');
        expect(pseudo.glow).toContain('linear-gradient');
      }
      await page.locator('#music-tab-concerts').click();
      await primarySource(page,'#music-tab-concerts');
      await expect(page.locator('#screen-myconcerts .music-history-tabs-v183 .myconcerts-history-tab.active')).not.toHaveCSS('background-image',/linear-gradient/);
      const featured = page.locator('#screen-myconcerts .next-concert-merged-v167');
      await cardColor(featured,color);
      await expect(featured.locator('.next-concert-stage-v182')).toHaveCSS('background-image',/radial-gradient.*linear-gradient/s);
      await cardColor(page.locator('#screen-myconcerts #my-history-upcoming .row-card-mc').first(),color);
      const history = page.locator('#screen-myconcerts .music-history-tabs-v183');
      await history.locator('[data-my-history-tab="past"]').click();
      await cardColor(page.locator('#my-history-past .row-card-mc').first(),color);
      await history.locator('[data-my-history-tab="cancelled"]').click();
      await cardColor(page.locator('#my-history-cancelled .row-card-mc.is-cancelled').first(),color);
      await expect(page.locator('#my-history-cancelled .my-lifecycle-status.cancelled')).toHaveText('CANCELLED');

      // The real app renders separate concert rows in the Discover dates list
      // and Band Detail, while artist recommendation cards stay independent.
      await page.locator('#tabbar [data-tab="concerts"]').click();
      await cardColor(page.locator('#screen-concerts .row-card[data-band-id]').first(),color);
      await page.evaluate(() => openProfile(bands[0].id,{selectedTab:'concerts'}));
      await cardColor(page.locator('#screen-profile .profile-divider .row-card').first(),color);
      const profileTab = page.locator('#screen-profile .profile-tab-switch .profile-tab-btn.active');
      await primarySource(page,'#screen-profile .profile-tab-switch .profile-tab-btn.active');
      const pastOnProfile = page.locator('#screen-profile .profile-divider .row-card-mc.is-past').first();
      await cardColor(pastOnProfile,color);

      // Venue detail uses the same exact concert surface, not generic cards.
      await page.evaluate(() => {
        const panel = document.querySelector('#screen-venue-detail');
        const row = document.createElement('div');
        row.className = 'row-card clickable';
        row.dataset.bandId = bands[0].id;
        row.dataset.qaV186VenueConcert = '1';
        row.textContent = 'Synthetic venue concert';
        panel.appendChild(row);
        const generic = document.createElement('div');
        generic.className = 'row-card';
        generic.dataset.qaV186Other = '1';
        generic.textContent = 'Synthetic generic band card';
        document.querySelector('#screen-mybands').appendChild(generic);
      });
      const venueBg = await page.locator('[data-qa-v186-venue-concert]').evaluate(el=>getComputedStyle(el).backgroundColor);
      expect(venueBg).toBe(color);
      const genericBg = await page.locator('[data-qa-v186-other]').evaluate(el=>getComputedStyle(el).backgroundColor);
      expect(genericBg).not.toBe(color);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
      await page.screenshot({path:testInfo.outputPath('v186-light-'+width+'-'+scheme+'.png')});
    });
  }
}

test('v186 first-letter light source follows active tab and never changes muted nested tabs',async({page})=>{
  await setup(page,375,'dark');
  await primarySource(page,'#music-tab-highlights');
  await page.locator('#music-tab-concerts').click();
  const next=await primarySource(page,'#music-tab-concerts');
  expect(next.configured).toBeGreaterThan(0);
  const muted=page.locator('#screen-myconcerts .music-history-tabs-v183 .myconcerts-history-tab.active');
  await expect(muted).toBeVisible();
  await expect(muted).not.toHaveCSS('background-image',/linear-gradient/);
});
