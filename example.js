const Videox = require('.')
const path = require('path')
const { exit } = require('process')

const targetUrl1 = 'https://www.youtube.com/watch?v=h32FxBqmu_U'
const targetUrl2 = 'https://www.bilibili.com/video/BV13D4y1o7rj'

const targetUrl = process.env.NODE_ENV === 'test' ? targetUrl1 : targetUrl2

run()
  .then(() => exit(0))
  .catch((e) => {
    console.error(e)

    exit(1)
  })

async function run() {
  const videox = new Videox({
    debug: true,
    headless: process.env.NODE_ENV === 'test' ? true : false,
    downloadBrowser: process.env.NODE_ENV === 'test' ? true : false,
    logTo: process.stdout,
    browserExecutePath: '/usr/bin/chromium',
    browserArgs: ['--no-sandbox'],
    downloadAsFile: true,
    downloadPath: path.join(__dirname, 'download'),
    checkCompleteLoopInterval: 100,
    waitForNextDataTimeout: 8000,
  })

  await videox.init()

  await videox.get(targetUrl)

  await videox.destroy()
}
