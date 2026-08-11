import { expect, test } from 'playwright/test'

test('countdown completion starts the decoded gong without waiting in real time', async ({
  page
}) => {
  await page.addInitScript(() => {
    const playback = window as typeof window & { completionGongStarts: number }
    playback.completionGongStarts = 0
    const originalStart = AudioBufferSourceNode.prototype.start

    AudioBufferSourceNode.prototype.start = function (...args) {
      playback.completionGongStarts += 1
      return originalStart.apply(this, args)
    }
  })
  await page.goto('/')

  await page.getByLabel('Timer type').selectOption('countdown')
  await page.getByLabel('Minutes').fill('1')
  const gongResponse = page.waitForResponse((response) =>
    response.url().endsWith('/audio/built-in/gong.ogg')
  )
  await page.getByRole('button', { name: /Start Meditation/ }).click()
  expect((await gongResponse).ok()).toBe(true)

  await page.evaluate(() => {
    const completionTime = Date.now() + 60_000
    Date.now = () => completionTime
  })

  await expect(page.getByText('00:00')).toBeVisible()
  await expect(page.getByText('Meditation completed')).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { completionGongStarts: number })
            .completionGongStarts
      )
    )
    .toBe(1)
})
