const { test, expect } = require('@playwright/test');

async function openStart(page) {
  await page.goto('/');
  await expect(page.getByTestId('qa-banner')).toContainText('SYNTHETIC DATA');
  await expect(page.locator('#screen-myconcerts')).toBeVisible();
}
function localDateString(date) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }
async function render(page, date, tickets=[]) {
  await page.evaluate(({date,tickets}) => {
    const concert={id:'qa-v139',bandId:'qa-artist',bandName:'The National',date,time:'20:00',venue:'Royal Arena',address:'Hannemanns Alle 18',postalCode:'2300',city:'Copenhagen',country:'Denmark',latitude:55.5,longitude:12.6,attending:true,ownedTickets:tickets};
    document.querySelector('#screen-myconcerts').innerHTML=window.countdownCardHtml(concert);
  },{date,tickets});
  return page.locator('#countdown-card');
}

test('v139 normal card matches approved ticket geometry and silver countdown', async ({page}) => {
  await openStart(page);
  const future=new Date(); future.setDate(future.getDate()+30);
  const card=await render(page,localDateString(future));
  await expect(card).toHaveAttribute('data-today','false');
  await expect(card.locator('.countdown-ticket-outline')).toHaveAttribute('viewBox','0 0 820 386');
  await expect(card.locator('.countdown-ticket-tear')).toHaveAttribute('x1','468');
  await expect(card.locator('.countdown-ticket-inner-frame')).toHaveCount(2);
  await expect(card.locator('.countdown-v139-band')).toHaveText('The National');
  await expect(card.locator('.countdown-v139-venue')).toHaveText('Royal Arena');
  await expect(card.locator('#countdown-ring-day')).toBeVisible();
  const styles=await card.evaluate(node=>({contour:getComputedStyle(node.querySelector('.countdown-ticket-contour')).stroke,tear:getComputedStyle(node.querySelector('.countdown-ticket-tear')).stroke,progress:getComputedStyle(node.querySelector('.countdown-v139-progress')).stroke}));
  expect(styles.tear).toBe(styles.contour);
  expect(styles.progress).toBe('rgb(216, 217, 220)');
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth)).toBe(true);
});

test('v139 show day keeps directions left and Open tickets yellow circle right', async ({page}) => {
  await openStart(page);
  const card=await render(page,localDateString(new Date()),[{id:'qa-ticket',type:'url',url:'https://qa.invalid/ticket',addedAt:'2027-01-01T00:00:00.000Z'}]);
  await expect(card).toHaveAttribute('data-today','true');
  await expect(card.getByRole('link',{name:'Get directions'})).toBeVisible();
  const ticket=card.getByRole('link',{name:'Open tickets'});
  await expect(ticket).toBeVisible();
  await expect(ticket.locator('.countdown-v139-ticket-symbol')).toBeVisible();
  expect(await ticket.evaluate(node=>getComputedStyle(node).backgroundColor)).toBe('rgb(242, 194, 48)');
  await expect(card).not.toContainText('🎟');
  await expect(card.locator('#countdown-ring-day')).toHaveCount(0);
});

test('v139 PDF ticket controls preserve OwnedTickets delegated hooks', async ({page}) => {
  await openStart(page);
  const card=await render(page,localDateString(new Date()),[{id:'pdf-a',type:'pdf',sizeBytes:128,addedAt:'2027-01-01T00:00:00.000Z'},{id:'pdf-b',type:'pdf',sizeBytes:129,addedAt:'2027-01-02T00:00:00.000Z'}]);
  await card.getByText('Open tickets',{exact:true}).click();
  await expect(card.getByRole('button',{name:'Ticket 1'})).toHaveClass(/countdown-pdf-open-btn/);
  await expect(card.getByRole('button',{name:'Ticket 2'})).toHaveClass(/countdown-pdf-open-btn/);
});
