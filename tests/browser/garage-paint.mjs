// Run with Chrome installed: node --test tests/browser/garage-paint.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

test('the garage charges for paint only after an explicit purchase', async (t) => {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  t.after(() => server.close());
  await server.listen();
  const browser = await chromium.launch({ channel: 'chrome' });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(server.resolvedUrls.local[0]);
  const action = (name) => page.locator(`[data-action="${name}"]`);
  const garage = page.getByRole('tab', { name: 'Garage' });
  const swatch = (color) => page.getByRole('button', { name: `Essayer la peinture ${color}` });
  const save = () => page.evaluate(() => JSON.parse(localStorage.getItem('ned-for-speed/save/v1')));
  const visiblePaint = () => page.locator('.garage-stage .car-canvas').evaluate((el) => JSON.parse(el.dataset.look).paint);
  const spray = page.locator('.paint-spray');

  await action('title-new').click();
  await action('intro-skip').click();
  await garage.click();
  const initial = await save();
  for (const [name, hex] of [['Rouge pompier', '#e03a3a'], ['Bleu électrique', '#2f6fe0']]) {
    await swatch(name).click();
    assert.equal(await visiblePaint(), hex);
    assert.deepEqual(await save(), initial);
    assert.equal(await spray.count(), 0);
  }
  await action('cancel-paint').click();
  assert.equal(await visiblePaint(), initial.cars[0].paint);
  await swatch('Vert pomme').click();
  await page.getByRole('tab', { name: 'Courses' }).click();
  await garage.click();
  assert.equal(await visiblePaint(), initial.cars[0].paint);
  assert.deepEqual(await save(), initial);

  await swatch('Bleu électrique').click();
  await action('buy-paint').click({ clickCount: 2 });
  assert.equal(await spray.count(), 1);
  await spray.waitFor({ state: 'detached' });
  await page.reload();
  await action('title-continue').click();
  await garage.click();
  assert.equal(await visiblePaint(), '#2f6fe0');
  assert.equal((await save()).money, initial.money - 150);
  assert.equal(await action('buy-paint').isDisabled(), true);

  await page.evaluate(() => {
    const game = window.__ned.getState();
    const car = game.cars[0];
    const scrape = { kind: 'scrape', x: -8, y: -7, angle: 0, length: 6 };
    const other = { ...car, uid: 'c2', modelId: 'furet', paint: '#e03a3a' };
    window.__ned.setState({ ...game, money: 149, cars: [{ ...car, bodyDamage: [scrape] }, other] });
  });
  const damaged = await save();
  await swatch('Vert pomme').click();
  await page.locator('[data-action="select-car"][data-uid="c2"]').click();
  assert.equal(await visiblePaint(), damaged.cars[1].paint);
  await page.locator('[data-action="select-car"][data-uid="c1"]').click();
  assert.equal(await visiblePaint(), damaged.cars[0].paint);
  await swatch('Rouge pompier').click();
  assert.equal(await visiblePaint(), '#e03a3a');
  assert.equal(await action('buy-paint').isDisabled(), true);
  assert.deepEqual(await save(), damaged);
  await page.keyboard.press('Escape');
  assert.equal(await visiblePaint(), damaged.cars[0].paint);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => window.__ned.setState({ ...window.__ned.getState(), money: 150 }));
  await action('buy-paint').click();
  const repaired = await save();
  assert.equal(repaired.money, 0);
  assert.equal(repaired.cars[0].paint, damaged.cars[0].paint);
  assert.deepEqual(repaired.cars[0].bodyDamage, []);
  assert.equal(await spray.count(), 0);
});
