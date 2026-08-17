import { expect, test } from 'playwright/test'

test('saved soundscapes remain readable without horizontal overflow at 320px', async ({
  page
}) => {
  await page.setViewportSize({ width: 320, height: 700 })
  await page.goto('./')
  await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('local-soundscape-manifests', 1)
      request.onupgradeneeded = () =>
        request.result.createObjectStore('soundscapes', { keyPath: 'id' })
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction('soundscapes', 'readwrite')
      transaction.objectStore('soundscapes').put({
        id: 'responsive-layout',
        manifest: {
          version: 1,
          id: 'responsive-layout',
          name: 'A very long morning meditation soundscape name that should truncate cleanly',
          updatedAt: '2026-08-16T00:00:00.000Z',
          masterVolume: 1,
          tracks: []
        }
      })
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
    })
    database.close()
  })
  await page.reload()

  const name = page.locator('.saved-soundscape-name')
  const actions = page.locator('.saved-soundscapes li button')
  await expect(name).toBeVisible()
  await expect(actions).toHaveCount(3)
  const nameBox = await name.boundingBox()
  const actionBox = await actions.first().boundingBox()
  expect(nameBox!.width).toBeGreaterThan(200)
  expect(nameBox!.y + nameBox!.height).toBeLessThanOrEqual(actionBox!.y)
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth)
  ).toBeLessThanOrEqual(320)
})
