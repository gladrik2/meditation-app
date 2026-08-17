import { expect, test, type Page } from 'playwright/test'

const largeImage = Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" width="6000" height="4000" viewBox="0 0 6000 4000">
    <rect width="6000" height="4000" fill="#f5d142"/>
    <path d="M0 400V0H400 M5600 0H6000V400 M6000 3600V4000H5600 M400 4000H0V3600" fill="none" stroke="#d71920" stroke-width="120"/>
    <text x="3000" y="2150" text-anchor="middle" font-family="sans-serif" font-size="600">ALL FOUR EDGES</text>
  </svg>
`)

const portraitViewportImage = Buffer.from(`
  <svg xmlns="http://www.w3.org/2000/svg" width="1152" height="896" viewBox="0 0 1152 896">
    <rect width="1152" height="896" fill="#f5d142"/>
    <rect width="1152" height="16" fill="#d71920"/>
    <rect y="880" width="1152" height="16" fill="#2a9d8f"/>
    <text x="576" y="480" text-anchor="middle" font-family="sans-serif" font-size="96">1152 × 896</text>
  </svg>
`)

async function uploadLargeImage(page: Page) {
  await page.goto('./')
  await page.locator('#audio-files').setInputFiles({
    name: 'large-edge-image.svg',
    mimeType: 'image/svg+xml',
    buffer: largeImage
  })
  await expect(page.getByText('large-edge-image.svg')).toBeVisible()
}

async function expectImageWithinViewport(page: Page) {
  const image = page.getByRole('dialog').locator('img')
  await expect(image).toBeVisible()
  await expect(image).toHaveJSProperty('naturalWidth', 6000)
  await expect(image).toHaveJSProperty('naturalHeight', 4000)

  const box = await image.boundingBox()
  const viewport = page.viewportSize()
  expect(box).not.toBeNull()
  expect(viewport).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.y).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width)
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height)
}

test('large image fits within every viewport edge in Theater mode', async ({
  page
}) => {
  await uploadLargeImage(page)
  await page.getByRole('button', { name: 'Theater mode' }).click()
  await expectImageWithinViewport(page)
})

test('smaller image expands until its limiting edges meet the viewport', async ({
  page
}) => {
  await page.setViewportSize({ width: 1920, height: 1162 })
  await page.goto('./')
  await page.locator('#audio-files').setInputFiles({
    name: '1152-by-896.svg',
    mimeType: 'image/svg+xml',
    buffer: portraitViewportImage
  })
  await page.getByRole('button', { name: 'Theater mode' }).click()

  const contentBox = await page
    .getByRole('dialog')
    .locator('img')
    .evaluate((image) => {
      const rect = image.getBoundingClientRect()
      const scale = Math.min(
        rect.width / image.naturalWidth,
        rect.height / image.naturalHeight
      )
      const width = image.naturalWidth * scale
      const height = image.naturalHeight * scale
      return {
        x: rect.x + (rect.width - width) / 2,
        y: rect.y + (rect.height - height) / 2,
        width,
        height
      }
    })
  expect(contentBox.y).toBeCloseTo(0)
  expect(contentBox.y + contentBox.height).toBeCloseTo(1162)
  expect(contentBox.x).toBeGreaterThan(0)
  expect(contentBox.x + contentBox.width).toBeLessThan(1920)
})

test('Full screen retains Theater mode when fullscreen is unavailable', async ({
  page
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(Element.prototype, 'requestFullscreen', {
      configurable: true,
      value: undefined
    })
  })
  await uploadLargeImage(page)
  const historyLength = await page.evaluate(() => history.length)
  await page.getByRole('button', { name: 'Full screen' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  expect(await page.evaluate(() => history.length)).toBe(historyLength + 1)
  await expectImageWithinViewport(page)
  await page.goBack()
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(
    page.getByRole('heading', { name: /Layer sounds/ })
  ).toBeVisible()
})

test('rejected fullscreen falls back to Theater mode and browser Back closes it', async ({
  page
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(Element.prototype, 'requestFullscreen', {
      configurable: true,
      value: () => Promise.reject(new Error('Fullscreen denied'))
    })
  })
  await uploadLargeImage(page)
  const historyLength = await page.evaluate(() => history.length)
  await page.getByRole('button', { name: 'Full screen' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  expect(await page.evaluate(() => history.length)).toBe(historyLength + 1)
  await page.goBack()
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(
    page.getByRole('heading', { name: /Layer sounds/ })
  ).toBeVisible()
})

test('large image fits within every viewport edge in native full screen', async ({
  page
}) => {
  await uploadLargeImage(page)
  const supportsFullscreen = await page.evaluate(
    () => typeof Element.prototype.requestFullscreen === 'function'
  )
  test.skip(
    !supportsFullscreen,
    'Fullscreen API is unavailable in this browser'
  )

  const historyLength = await page.evaluate(() => history.length)
  await page.getByRole('button', { name: 'Full screen' }).click()
  const enteredFullscreen = await page
    .waitForFunction(() => document.fullscreenElement !== null, null, {
      timeout: 1000
    })
    .then(() => true)
    .catch(() => false)
  test.skip(
    !enteredFullscreen,
    'Native fullscreen is unavailable in this automation environment'
  )
  await expectImageWithinViewport(page)
  expect(await page.evaluate(() => history.length)).toBe(historyLength)
  await page.evaluate(() => document.exitFullscreen())
  await expect(page.getByRole('dialog')).toBeHidden()
  await expect(
    page.getByRole('heading', { name: /Layer sounds/ })
  ).toBeVisible()
  expect(await page.evaluate(() => history.length)).toBe(historyLength)
})

test('repeated Theater open and Back cycles do not accumulate history entries', async ({
  page
}) => {
  await uploadLargeImage(page)
  const historyLength = await page.evaluate(() => history.length)
  for (let cycle = 0; cycle < 3; cycle += 1) {
    await page.getByRole('button', { name: 'Theater mode' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    expect(await page.evaluate(() => history.length)).toBe(historyLength + 1)
    await page.goBack()
    await expect(page.getByRole('dialog')).toBeHidden()
  }
})
