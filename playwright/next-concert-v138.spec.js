const { test, expect } = require('@playwright/test');

async function openStart(page) {
  await page.goto('/');
  await expect(page.getByTestId('qa-banner')).toContainText('SYNTHETIC DATA');
  await expect(page.locator('#screen-myconcerts')).toBeVisible();
}
function localDateString(date) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }
async function appDate(page, offsetDays = 0) {
  return page.evaluate((offset) => {
    const date = typeof dlCurrentDate === 'function' ? dlCurrentDate() : new Date();
    date.setDate(date.getDate() + offset);
    return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  }, offsetDays);
}
function displayDate(date) {
  const months=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
  const [year,month,day]=date.split('-').map(Number);
  return `${day} ${months[month-1]} ${year}`;
}
async function render(page, date, overrides={}) {
  await page.evaluate(({date,overrides}) => {
    const concert={
      id:'qa-v140',bandId:'qa-artist',bandName:'The National',date,time:'20:00',venue:'Royal Arena',
      address:'Hannemanns Alle 18',postalCode:'2300',city:'Copenhagen',country:'Denmark',
      latitude:55.5,longitude:12.6,attending:true,ownedTickets:[],ticketQuantity:2,...overrides,
    };
    document.querySelector('#screen-myconcerts').innerHTML=window.countdownCardHtml(concert);
  },{date,overrides});
  return page.locator('#countdown-card');
}

test('v140 normal card uses approved tall black and white ticket geometry', async ({page}) => {
  await openStart(page);
  const future=await appDate(page,30);
  const card=await render(page,future,{ticketQuantity:4});
  await expect(card).toHaveAttribute('data-today','false');
  await expect(card.locator('.countdown-ticket-outline')).toHaveAttribute('viewBox','0 0 820 463');
  await expect(card.locator('.countdown-ticket-tear')).toHaveAttribute('x1','468');
  await expect(card.locator('.countdown-ticket-tear')).toHaveAttribute('y1','28');
  await expect(card.locator('.countdown-ticket-tear')).toHaveAttribute('y2','435');
  const frames=card.locator('.countdown-ticket-inner-frame');
  await expect(frames).toHaveCount(2);
  await expect(frames.nth(0)).toHaveAttribute('x','56');
  await expect(frames.nth(0)).toHaveAttribute('y','50');
  await expect(frames.nth(0)).toHaveAttribute('width','358');
  await expect(frames.nth(0)).toHaveAttribute('height','363');
  await expect(frames.nth(0)).toHaveAttribute('rx','17');
  await expect(frames.nth(1)).toHaveAttribute('x','525');
  await expect(frames.nth(1)).toHaveAttribute('y','50');
  await expect(frames.nth(1)).toHaveAttribute('width','238');
  await expect(frames.nth(1)).toHaveAttribute('height','363');
  await expect(frames.nth(1)).toHaveAttribute('rx','17');
  const styles=await card.evaluate(node=>({
    fill:getComputedStyle(node.querySelector('.countdown-ticket-contour')).fill,
    contour:getComputedStyle(node.querySelector('.countdown-ticket-contour')).stroke,
    contourWidth:getComputedStyle(node.querySelector('.countdown-ticket-contour')).strokeWidth,
    tear:getComputedStyle(node.querySelector('.countdown-ticket-tear')).stroke,
    frame:getComputedStyle(node.querySelector('.countdown-ticket-inner-frame')).stroke,
    frameWidth:getComputedStyle(node.querySelector('.countdown-ticket-inner-frame')).strokeWidth,
    progress:getComputedStyle(node.querySelector('.countdown-v139-progress')).stroke,
  }));
  expect(styles.fill).toBe('rgb(0, 0, 0)');
  expect(styles.contour).toBe('rgb(255, 255, 255)');
  expect(styles.tear).toBe('rgb(255, 255, 255)');
  expect(styles.frame).toBe('rgb(255, 255, 255)');
  expect(styles.contourWidth).toBe('1.5px');
  expect(styles.frameWidth).toBe('3px');
  expect(styles.progress).toBe('rgb(243, 243, 245)');
  await expect(card.locator('.countdown-v139-band')).toHaveText('The National');
  await expect(card.locator('.countdown-v139-band')).toHaveCSS('text-transform','uppercase');
  await expect(card.locator('.countdown-v139-artist-line')).toHaveCSS('background-color','rgb(255, 255, 255)');
  await expect(card.locator('.countdown-v140-ticket-count strong')).toHaveText('4 TICKETS');
  await expect(card.locator('.countdown-v140-date')).toHaveText(displayDate(future));
  await expect(card.locator('#countdown-ring-day')).toBeVisible();
  await expect(card.locator('#countdown-d')).toBeVisible();
  await expect(card.getByRole('link',{name:'Get directions'})).toHaveCount(0);
  await expect(card.getByRole('link',{name:'Open tickets'})).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
});

test('v141 mobile typography fits, preserves countdown footprint, and aligns quantity/date', async ({page}, testInfo) => {
  await openStart(page);
  const future=await appDate(page,30);
  for (const width of [432,375,480]) {
    await page.setViewportSize({width,height:900});
    const card=await render(page,future,{
      bandName:'LE SSERAFIM',ticketQuantity:4,venue:'Unknown venue',
      address:'Hannemanns Alle 18-20',postalCode:'2300',city:'Copenhagen',country:'Denmark',
    });
    const metrics=await card.evaluate(node=>{
      const count=node.querySelector('.countdown-v140-ticket-count');
      const text=count.querySelector('strong');
      const lines=count.querySelectorAll('.countdown-v140-ticket-count-line');
      const date=node.querySelector('.countdown-v140-date');
      const spacer=node.querySelector('.countdown-v140-date-spacer');
      const stubContent=node.querySelector('.countdown-v139-stub-content');
      const ring=node.querySelector('.countdown-v139-countdown');
      const time=node.querySelector('.countdown-v139-time');
      const info=node.querySelector('.countdown-v139-info');
      const artist=node.querySelector('.countdown-v139-band');
      const venue=node.querySelector('.countdown-v139-venue');
      const address=node.querySelector('.countdown-v139-address');
      const textRect=text.getBoundingClientRect();
      const dateRect=date.getBoundingClientRect();
      const topRect=lines[0].getBoundingClientRect();
      const bottomRect=lines[1].getBoundingClientRect();
      const stubRect=stubContent.getBoundingClientRect();
      const ringRect=ring.getBoundingClientRect();
      const timeRect=time.getBoundingClientRect();
      const spacerStyle=getComputedStyle(spacer);
      return {
        textTop:textRect.top,dateTop:dateRect.top,
        topThickness:topRect.height,bottomThickness:bottomRect.height,
        topGap:textRect.top-topRect.bottom,bottomGap:bottomRect.top-textRect.bottom,
        infoFits:info.scrollWidth<=info.clientWidth+1,
        artistSize:getComputedStyle(artist).fontSize,
        artistWeight:getComputedStyle(artist).fontWeight,
        venueSize:getComputedStyle(venue).fontSize,
        venueWeight:getComputedStyle(venue).fontWeight,
        addressSize:getComputedStyle(address).fontSize,
        spacerVisibility:spacerStyle.visibility,
        spacerMarginTop:spacerStyle.marginTop,
        spacerText:spacer.textContent,
        stubChildren:Array.from(stubContent.children).map(child=>child.className.baseVal||child.className),
        ringTopWithinStub:ringRect.top-stubRect.top,
        timeTopWithinStub:timeRect.top-stubRect.top,
      };
    });
    expect(Math.abs(metrics.textTop-metrics.dateTop)).toBeLessThanOrEqual(0.1);
    expect(Math.abs(metrics.topThickness-metrics.bottomThickness)).toBeLessThanOrEqual(0.01);
    expect(metrics.topThickness).toBeCloseTo(1,1);
    expect(Math.abs(metrics.topGap-metrics.bottomGap)).toBeLessThanOrEqual(0.1);
    expect(metrics.topGap).toBeGreaterThanOrEqual(3.5);
    expect(metrics.topGap).toBeLessThanOrEqual(4.5);
    expect(metrics.infoFits).toBe(true);
    expect(metrics.spacerVisibility).toBe('hidden');
    expect(metrics.spacerText).toBe(displayDate(future));
    expect(metrics.stubChildren).toEqual([
      'countdown-v139-countdown',
      'countdown-breakdown countdown-v139-time',
      'countdown-v140-date-spacer',
    ]);
    expect(metrics.ringTopWithinStub).toBeGreaterThan(0);
    expect(metrics.timeTopWithinStub).toBeGreaterThan(metrics.ringTopWithinStub);
    if (width === 432 || width === 480) {
      expect(metrics.artistSize).toBe('18px');
      expect(metrics.artistWeight).toBe('780');
      expect(metrics.venueSize).toBe('13px');
      expect(metrics.venueWeight).toBe('680');
      expect(metrics.addressSize).toBe('10.5px');
      expect(metrics.spacerMarginTop).toBe('9px');
    } else {
      expect(metrics.artistSize).toBe('16px');
      expect(metrics.artistWeight).toBe('780');
      expect(metrics.venueSize).toBe('12px');
      expect(metrics.venueWeight).toBe('680');
      expect(metrics.addressSize).toBe('9.5px');
      expect(metrics.spacerMarginTop).toBe('7px');
    }
    if (width === 432 || width === 375) {
      await card.screenshot({path:testInfo.outputPath(`v141-next-concert-${width}px.png`)});
    }
  }
});

test('v141 keeps the approved v140 concert-day typography and spacing', async ({page}, testInfo) => {
  await openStart(page);
  const today=await appDate(page,0);
  for (const width of [432,375]) {
    await page.setViewportSize({width,height:900});
    const card=await render(page,today,{
      bandName:'LE SSERAFIM',venue:'Royal Arena',city:'Copenhagen',ticketQuantity:4,
      ownedTickets:[{id:'qa-ticket',type:'url',url:'https://qa.invalid/ticket',addedAt:'2026-01-01T00:00:00.000Z'}],
    });
    const styles=await card.evaluate(node=>{
      const info=getComputedStyle(node.querySelector('.countdown-v139-info'));
      const band=getComputedStyle(node.querySelector('.countdown-v139-band'));
      const showVenue=getComputedStyle(node.querySelector('.countdown-v139-show-venue'));
      const directions=getComputedStyle(node.querySelector('.countdown-v139-directions'));
      return {
        paddingTop:info.paddingTop,paddingRight:info.paddingRight,paddingBottom:info.paddingBottom,paddingLeft:info.paddingLeft,
        bandMarginTop:band.marginTop,bandWeight:band.fontWeight,
        showVenueMarginTop:showVenue.marginTop,directionsMarginTop:directions.marginTop,
      };
    });
    if (width === 432) {
      expect(styles.paddingTop).toBe('25px');
      expect(styles.paddingRight).toBe('27px');
      expect(styles.paddingBottom).toBe('25px');
      expect(styles.paddingLeft).toBe('27px');
      expect(styles.bandMarginTop).toBe('15px');
      expect(styles.showVenueMarginTop).toBe('24px');
      expect(styles.directionsMarginTop).toBe('18px');
    } else {
      expect(styles.paddingTop).toBe('18px');
      expect(styles.paddingRight).toBe('16px');
      expect(styles.paddingBottom).toBe('18px');
      expect(styles.paddingLeft).toBe('16px');
      expect(styles.bandMarginTop).toBe('10px');
      expect(styles.showVenueMarginTop).toBe('15px');
      expect(styles.directionsMarginTop).toBe('12px');
    }
    expect(styles.bandWeight).toBe('760');
    await expect(card.locator('.countdown-v140-date-spacer')).toHaveCount(0);
    await card.screenshot({path:testInfo.outputPath(`v141-show-day-${width}px.png`)});
  }
});

test('v140 quantity uses ticketQuantity with singular, plural and missing behavior', async ({page}) => {
  await openStart(page);
  const future=await appDate(page,30);
  let card=await render(page,future,{ticketQuantity:1,ownedTickets:[{id:'only-file',type:'pdf',sizeBytes:128,addedAt:'2026-01-01T00:00:00.000Z'}]});
  await expect(card.locator('.countdown-v140-ticket-count strong')).toHaveText('1 TICKET');
  card=await render(page,future,{ticketQuantity:2,ownedTickets:[]});
  await expect(card.locator('.countdown-v140-ticket-count strong')).toHaveText('2 TICKETS');
  card=await render(page,future,{ticketQuantity:4,ownedTickets:[{id:'only-file',type:'pdf',sizeBytes:128,addedAt:'2026-01-01T00:00:00.000Z'}]});
  await expect(card.locator('.countdown-v140-ticket-count strong')).toHaveText('4 TICKETS');
  card=await render(page,future,{ticketQuantity:0,ownedTickets:[{id:'pdf-a',type:'pdf',sizeBytes:128,addedAt:'2026-01-01T00:00:00.000Z'}]});
  await expect(card.locator('.countdown-v140-ticket-count')).toHaveCount(0);
  card=await render(page,future,{ticketQuantity:null});
  await expect(card.locator('.countdown-v140-ticket-count')).toHaveCount(0);
  card=await render(page,future,{ticketQuantity:-2});
  await expect(card.locator('.countdown-v140-ticket-count')).toHaveCount(0);
  card=await render(page,future,{ticketQuantity:'not-a-number'});
  await expect(card.locator('.countdown-v140-ticket-count')).toHaveCount(0);
});

test('v140 silver countdown remains live-updating through the established IDs', async ({page}) => {
  await openStart(page);
  const future=await appDate(page,30);
  const card=await render(page,future,{ticketQuantity:2});
  const beforeSeconds=await card.locator('#countdown-s').textContent();
  const beforeOffset=await card.locator('#countdown-ring-inner').getAttribute('stroke-dashoffset');
  const after=await page.evaluate(() => {
    const current=dlCurrentDate();
    window.__LIVEVAULT_QA_NOW__=new Date(current.getTime()+1000).toISOString();
    tickCountdownCard();
    return {
      seconds:document.querySelector('#countdown-s').textContent,
      offset:document.querySelector('#countdown-ring-inner').getAttribute('stroke-dashoffset'),
    };
  });
  expect(after.seconds).not.toBe(beforeSeconds);
  expect(after.offset).not.toBe(beforeOffset);
  await expect(card.locator('.countdown-v139-progress')).toHaveCSS('stroke','rgb(243, 243, 245)');
});

test('v140 show day keeps directions and OwnedTickets neon ticket action', async ({page}) => {
  await openStart(page);
  const today=await appDate(page,0);
  const card=await render(page,today,{ticketQuantity:4,ownedTickets:[{id:'qa-ticket',type:'url',url:'https://qa.invalid/ticket',addedAt:'2026-01-01T00:00:00.000Z'}]});
  await expect(card).toHaveAttribute('data-today','true');
  await expect(card).toContainText('Show today');
  await expect(card.locator('.countdown-v139-band')).toHaveCSS('text-transform','uppercase');
  await expect(card.getByRole('link',{name:'Get directions'})).toBeVisible();
  const ticket=card.getByRole('link',{name:'Open tickets'});
  await expect(ticket).toBeVisible();
  await expect(ticket.locator('.countdown-v139-ticket-symbol')).toBeVisible();
  expect(await ticket.evaluate(node=>getComputedStyle(node).backgroundColor)).toBe('rgb(94, 216, 255)');
  expect(await ticket.evaluate(node=>getComputedStyle(node).color)).toBe('rgb(0, 19, 27)');
  await expect(ticket).toHaveAttribute('href','https://qa.invalid/ticket');
  await expect(card.locator('.countdown-v140-ticket-count')).toHaveCount(0);
  await expect(card.locator('.countdown-v140-date')).toHaveCount(0);
  await expect(card.locator('#countdown-ring-day')).toHaveCount(0);
  await expect(card.locator('#countdown-d')).toHaveCount(0);
});

test('v140 single PDF ticket preserves the existing delegated hook', async ({page}) => {
  await openStart(page);
  const today=await appDate(page,0);
  const card=await render(page,today,{ownedTickets:[
    {id:'pdf-only',type:'pdf',sizeBytes:128,addedAt:'2026-01-01T00:00:00.000Z'},
  ]});
  const ticket=card.getByRole('button',{name:'Open tickets'});
  await expect(ticket).toHaveClass(/countdown-pdf-open-btn/);
  await expect(ticket).toHaveAttribute('data-concert-id','qa-v140');
  await expect(ticket).toHaveAttribute('data-ticket-id','pdf-only');
});

test('v140 PDF ticket controls preserve OwnedTickets delegated hooks', async ({page}) => {
  await openStart(page);
  const today=await appDate(page,0);
  const card=await render(page,today,{ownedTickets:[
    {id:'pdf-a',type:'pdf',sizeBytes:128,addedAt:'2026-01-01T00:00:00.000Z'},
    {id:'pdf-b',type:'pdf',sizeBytes:129,addedAt:'2026-01-02T00:00:00.000Z'},
  ]});
  await card.getByText('Open tickets',{exact:true}).click();
  await expect(card.getByRole('button',{name:'Ticket 1'})).toHaveClass(/countdown-pdf-open-btn/);
  await expect(card.getByRole('button',{name:'Ticket 1'})).toHaveAttribute('data-concert-id','qa-v140');
  await expect(card.getByRole('button',{name:'Ticket 1'})).toHaveAttribute('data-ticket-id','pdf-a');
  await expect(card.getByRole('button',{name:'Ticket 2'})).toHaveClass(/countdown-pdf-open-btn/);
  await expect(card.getByRole('button',{name:'Ticket 2'})).toHaveAttribute('data-ticket-id','pdf-b');
});

test('v140 ticket remains contained at 375px and 480px with long content', async ({page}) => {
  await openStart(page);
  const future=await appDate(page,30);
  for (const width of [375,480]) {
    await page.setViewportSize({width,height:900});
    const card=await render(page,future,{
      bandName:'A Deliberately Very Long Synthetic Artist Name',ticketQuantity:4,
      venue:'A Deliberately Very Long Synthetic Arena Name',
      address:'12345 A Deliberately Very Long Synthetic Address Boulevard',
      city:'Synthetic Metropolitan District',country:'Exampleland',
    });
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
    expect(await card.evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
    expect(await card.locator('.countdown-v139-info').evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
    expect(await card.locator('.countdown-v139-stub').evaluate(node=>node.scrollWidth<=node.clientWidth+1)).toBe(true);
    await expect(card.locator('.countdown-v140-ticket-count strong')).toBeVisible();
    await expect(card.locator('.countdown-v140-date')).toBeVisible();
  }
});
