# videox

Download HTML5 videos from a website page using Media Source Extensions (MSE).

Note: 

1. videox is designed for pages using Media Source Extensions (MSE) technique. For pages using other techniques, just embed a HTTP URL into video tag, for example, videox will throw an error.
2. Some pages have video ads using the same technique as the actual video content, the MSE. videox can't distingush them, it just downloads all video ads and the actual video by default. The easiest way to deal with this is using a browser with ads block extension. Alternatively you can modify this program as you need as it's just a web crawler based on puppeteer.

# Prerequisites

- chrome. Needed if the websites were providing MP4 video you wanted that is usually the case. Otherwise chromium, puppeteer downloaded automatically is enough.

# Design

[https://www.tiaoxingyubolang.com/zh/article/2020-10-09_mediasource](https://www.tiaoxingyubolang.com/zh/article/2020-10-09_mediasource)

# Usage

```js
const Videox = require('videox')

const targetUrl = 'https://www.youtube.com/watch?v=h32FxBqmu_U'

(async () = {
  const videox = new Videox({
    debug: true,
    headless: true,
    downloadBrowser: false,
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
})()
```

# API

## Class: Videox

### Event: 'data'

- `objectURL` \<string> The URL created from `URL.createObjectURL`, usually starts with `blob`.
- `mimeCodec` \<string> Corresponding mimeCodec.
- `chunk` \<Buffer> The data received from page.

If `options.downloadAsFile` is specified as `false`, this event must be listened for receiving media data.

`objectURL` and `mimeCode` together identify a media file to which `chunk` corresponding.

### new Videox([options])

- `options` \<object>
    - `debug` \<bool> Default: false.
    - `headless` \<bool> Default: true.
    - `downloadBrowser` \<bool> Default: false.
    - `logTo` \<Writable> Default: process.stdout.
    - `browserExecutePath`: \<string> Default: '/usr/bin/chromium'.
    - `browserArgs`: \<array>: Default: [].
    - `downloadAsFile` \<bool> Default: true.
    - `dowloadPath` \<string> Default: ''.
    - `checkCompleteLoopInterval` \<number> The time interval  between checking whether  current download progress is commplete, in milliseconds. Default: 100,
    - `waitForNextDataTimeout`: \<number> The timeout waiting for next media data, in milliseconds. Default: 3000.
- `Returns`: \<Videox>

Usually `dowloadBrowser` is false and `browserExecutePath` is filled with common browser path to download MP4 using browsers other than the default chromium. See `puppeteer` package for more information.

### videox.init()

- `Returns`: \<Promise>

### video.get(options)

- `pageUrl` \<string> Required.
- `Returns`: \<Promise>

### videox.destroy()

- `Returns`: \<Promise>

