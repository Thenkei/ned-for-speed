// Run with Chrome installed: node --test tests/browser/garage-paint.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

async function openGarage(t) {
  const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
  t.after(() => server.close());
  await server.listen();
  const browser = await chromium.launch({ channel: 'chrome' });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.goto(server.resolvedUrls.local[0]);
  const action = (name) => page.locator(`[data-action="${name}"]`);
  const garage = page.getByRole('tab', { name: 'Garage' });
  const save = () => page.evaluate(() => JSON.parse(localStorage.getItem('ned-for-speed/save/v1')));
  const look = () => page.locator('.garage-stage .car-canvas').evaluate((el) => JSON.parse(el.dataset.look));
  await action('title-new').click();
  await action('intro-skip').click();
  await garage.click();
  return { page, action, garage, save, look };
}

test('the garage charges for paint only after an explicit purchase', async (t) => {
  const { page, action, garage, save, look } = await openGarage(t);
  const swatch = (color) => page.getByRole('button', { name: `Essayer la peinture ${color}` });
  const visiblePaint = async () => (await look()).paint;
  const spray = page.locator('.paint-spray');
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
  await page.getByRole('button', { name: 'Essayer le néon Violet' }).click();
  await page.locator('[data-action="select-car"][data-uid="c2"]').click();
  assert.equal(await visiblePaint(), damaged.cars[1].paint);
  assert.equal((await look()).neon, damaged.cars[1].neon);
  await page.locator('[data-action="select-car"][data-uid="c1"]').click();
  assert.equal(await visiblePaint(), damaged.cars[0].paint);
  assert.equal((await look()).neon, damaged.cars[0].neon);
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

test('neon previews are free and only the confirmed installation or removal is saved', async (t) => {
  const { page, action, garage, save, look } = await openGarage(t);
  const neon = (name) => page.getByTitle(name, { exact: true });
  const confirm = action('confirm-neon');
  const initial = await save();
  for (const [name, hex] of [['Violet', '#b04bff'], ['Cyan', '#2ff3ff']]) {
    await neon(name).click();
    assert.deepEqual(await save(), initial);
    assert.equal((await look()).neon, hex);
  }
  await action('cancel-neon').click();
  assert.equal((await look()).neon, '');
  await neon('Violet').click();
  await page.getByRole('tab', { name: 'Courses' }).click();
  await garage.click();
  assert.equal((await look()).neon, '');

  await page.getByRole('button', { name: 'Essayer la peinture Rouge pompier' }).click();
  await neon('Cyan').click();
  assert.equal((await look()).paint, '#e03a3a');
  await confirm.dblclick();
  const installed = await save();
  assert.equal(installed.money, initial.money - 300);
  assert.equal(installed.cars[0].neon, '#2ff3ff');
  assert.equal(installed.cars[0].paint, initial.cars[0].paint);
  assert.equal((await look()).paint, '#e03a3a');
  await page.reload();
  await action('title-continue').click();
  await garage.click();
  assert.equal((await look()).neon, '#2ff3ff');
  assert.equal(await confirm.isDisabled(), true);

  await neon('Violet').click();
  assert.equal((await look()).neon, '#b04bff');
  assert.equal(await confirm.isDisabled(), true);
  assert.deepEqual(await save(), installed);
  await neon('Aucun').click();
  assert.equal((await look()).neon, '');
  assert.deepEqual(await save(), installed);
  await page.keyboard.press('Escape');
  assert.equal((await look()).neon, '#2ff3ff');
  await neon('Aucun').click();
  await confirm.click();
  const removed = await save();
  assert.equal(removed.money, installed.money);
  assert.equal(removed.cars[0].neon, '');
  assert.equal(await confirm.isDisabled(), true);
});
