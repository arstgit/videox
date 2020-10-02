const puppeteer = require('puppeteer-core')
const stream = require('stream')
const fs = require('fs')
const path = require('path')
const { exit } = require('process')
const { Stream } = require('stream')
const { create } = require('domain')
const { EventEmitter } = require('events')

const logPrefix = '[videox]'
let deviceModel = puppeteer.devices['iPad']
deviceModel = null

module.exports = NewInstance

// Exposed videox class constructor.
function NewInstance(options) {
  EventEmitter.call(this)

  // Default options.
  this.options = {
    debug: false,
    headless: true,
    downloadBrowser: false,
    logTo: process.stdout,
    browserExecutePath: '/usr/bin/chromium',
    browserArgs: [],
    downloadAsFile: true,
    downloadPath: '',
    checkCompleteLoopInterval: 100,
    waitForNextDataTimeout: 5000,
  }

  Object.assign(this.options, options)

  if (this.options.downloadAsFile) {
    this.on('data', writeToFile)
  }

  return this
}

NewInstance.prototype = EventEmitter.prototype

// Open browser and a new page, be prepared for nevigating.
NewInstance.prototype.init = async function () {
  options = this.options

  if (options.downloadBrowser) {
    const browserFetcher = puppeteer.createBrowserFetcher()

    const revisionInfo = await this._to(
      browserFetcher.download('800071'),
      'download browser'
    )

    options.browserExecutePath = revisionInfo.executablePath
    this._log('downloaded browser in path: ' + options.browserExecutePath)
  }

  this.browser = await this._to(
    puppeteer.launch({
      headless: options.headless,
      args: options.browserArgs,
      executablePath: path.resolve(options.browserExecutePath),
    }),
    'launch puppeteer'
  )
}

// Launch download process.
NewInstance.prototype.get = async function (pageUrl) {
  let createdDownloadStream = false

  let totalBytes = 0

  const page = (this.page = await this._to(
    this.browser.newPage(),
    'open a new page'
  ))

  if (deviceModel) {
    await this._to(page.emulate(deviceModel), 'emulate device')
  }

  await page.exposeFunction('__videoxLog__', async (str) => {
    this._log(str)
  })

  await page.exposeFunction('__videoxLogRaw__', async (str) => {
    this._logRaw(str)
  })

  await page.exposeFunction('__videoxFatal__', async (str) => {
    this._log(str)

    await page.close()
  })

  // chunk is base64 string.
  await page.exposeFunction(
    '__videoxWrite__',
    async (objectUrl, mimeCodec, base64Chunk) => {
      const buf = Buffer.from(base64Chunk, 'base64')

      totalBytes += buf.length

      this.emit('data', objectUrl, mimeCodec, buf)
    }
  )

  // Overwrite some functions MSE would use.
  // See: https://developer.mozilla.org/en-US/docs/Web/API/Media_Source_Extensions_API
  await page.evaluateOnNewDocument(async () => {
    await window.__videoxLog__('evaluateOnNewDocument:')

    // Used to record some data.
    window.__videoxObj = {
      mediaSources: {},
      sourceBufferIndex: 0,
      enumDownloadStatus: {
        DS_UNINTIALIZED: 0,
        DS_DOWNLOADING: 1,
        DS_COMPLETED: 2,
        DS_END: 3,
      },
    }

    window.__videoxObj.downloadStatus =
      window.__videoxObj.enumDownloadStatus.DS_UNINTIALIZED

    const createObjectURLOrigin = URL.createObjectURL
    const addSourceBufferOrigin = MediaSource.prototype.addSourceBuffer
    const endOfStreamOrigin = MediaSource.prototype.endOfStream
    const appendBufferOrigin = SourceBuffer.prototype.appendBuffer

    URL.createObjectURL = function () {
      const objUrl = createObjectURLOrigin.apply(this, arguments)

      if (!arguments[0] instanceof MediaSource) {
        return objUrl
      }

      window.__videoxLog__('createObjectURL: ' + objUrl)

      arguments[0].__videoxUrl = objUrl

      // Register this mediasource in window.
      window.__videoxObj.mediaSources[objUrl] = {
        self: arguments[0],
        sourceBuffers: {},
      }

      return objUrl
    }

    MediaSource.prototype.addSourceBuffer = function () {
      window.__videoxLog__('addSourceBuffer, mimeCodec: ' + arguments[0])

      const sourceBuf = addSourceBufferOrigin.apply(this, arguments)

      const obj = window.__videoxObj

      sourceBuf.addEventListener('updateend', seek)

      sourceBuf.__videoxMediaSource = this

      sourceBuf.__videoxKey = Number.prototype.toString.call(
        obj.sourceBufferIndex++
      )
      obj.mediaSources[this.__videoxUrl].sourceBuffers[
        sourceBuf.__videoxKey
      ] = {
        self: sourceBuf,
        mimeCodec: arguments[0],
      }

      window.__videoxLog__('download status: ' + obj.downloadStatus)
      switch (obj.downloadStatus) {
        case obj.enumDownloadStatus.DS_END:
        case obj.enumDownloadStatus.DS_COMPLETED:
        case obj.enumDownloadStatus.DS_UNINTIALIZED:
          obj.downloadStatus = obj.enumDownloadStatus.DS_DOWNLOADING
          break
        case obj.enumDownloadStatus.DS_DOWNLOADING:
          // There may be multiple sourceBuffer added.
          break
        default:
          window.__videoxFatal__(
            'addSourceBuffer wrong download status: ' + obj.downloadStatus
          )
          break
      }
      window.__videoxLog__('download status changed to: ' + obj.downloadStatus)

      return sourceBuf
    }

    MediaSource.prototype.endOfStream = function () {
      window.__videoxLog__('endOfStream')

      const obj = window.__videoxObj

      Array.prototype.forEach.call(this.sourceBuffers, (e) => {
        e.removeEventListener('updateend', seek)
      })

      window.__videoxLog__('download status: ' + obj.downloadStatus)
      switch (obj.downloadStatus) {
        case obj.enumDownloadStatus.DS_DOWNLOADING:
          obj.downloadStatus = obj.enumDownloadStatus.DS_COMPLETED
          break
        case obj.enumDownloadStatus.DS_COMPLETED:
        case obj.enumDownloadStatus.DS_UNINTIALIZED:
        case obj.enumDownloadStatus.DS_END:
        default:
          window.__videoxFatal__(
            'endOfStream wrong download status: ' + obj.downloadStatus
          )
          break
      }
      window.__videoxLog__('download status changed to: ' + obj.downloadStatus)

      return endOfStreamOrigin.apply(this, arguments)
    }

    SourceBuffer.prototype.appendBuffer = function () {
      const obj = window.__videoxObj

      // Get mimeCodec string corresponding to this sourceBuffer instance.

      const mediaSource = this.__videoxMediaSource
      const sourceBufferInfo =
        obj.mediaSources[mediaSource.__videoxUrl].sourceBuffers[
          this.__videoxKey
        ]

      if (obj.downloadStatus !== obj.enumDownloadStatus.DS_DOWNLOADING) {
        window.__videoxFatal__(
          'appendBuffer wrong download status: ' +
            obj.downloadStatus +
            mediaSource.__videoxUrl
        )
      }
      if (!sourceBufferInfo.mimeCodec) {
        window.__videoxFatal__('empty mimeCodec')
      }

      // Serialize the bytes chunk. Needed for tranmitting data between browser and program.
      const arr = new Uint8Array(arguments[0])
      const len = arr.byteLength
      let b = ''
      for (let i = 0; i < len; i++) {
        b += String.fromCharCode(arr[i])
      }
      const sed = window.btoa(b)
      window.__videoxWrite__(
        mediaSource.__videoxUrl,
        sourceBufferInfo.mimeCodec,
        sed
      )

      return appendBufferOrigin.apply(this, arguments)
    }

    function seek() {
      // Seek to max buffered time.
      const seekNext = () => {
        const obj = window.__videoxObj

        const mediaSource = this.__videoxMediaSource

        const sourceBuffers =
          obj.mediaSources[mediaSource.__videoxUrl].sourceBuffers

        if (Object.keys(sourceBuffers).length === 0) {
          window.__videoxFatal__('suorceBuffers size 0')
        }

        const videoEle = document.querySelector('video')
        if (!videoEle) {
          window.__videoxFatal__('seek, videoEle null')
        }

        if (
          videoEle.buffered.length === 1 &&
          videoEle.currentTime < videoEle.buffered.end(0)
        ) {
          videoEle.currentTime = videoEle.buffered.end(0)
        }

        // Print download progress in percentage.
        let percent =
          ((videoEle.currentTime / mediaSource.duration) * 100).toFixed(2) + '%'
        let str =
          '[videox] download progress: ' +
          percent +
          ' video.currentTime: ' +
          videoEle.currentTime

        window.__videoxLog__(str)
      }

      // Place seek operation in next eventloop waiting for updated timeEnd value.
      setTimeout(seekNext, 1)
    }
  })

  await this._to(
    page.goto(pageUrl, { waitUntil: 'networkidle2' }),
    'page goto: ' + pageUrl
  )

  // Check download status.
  await this._to(
    page.evaluate(
      async (options) => {
        const obj = window.__videoxObj

        if (Object.keys(obj.mediaSources).length === 0) {
          await window.__videoxFatal__(
            "can't find MediaSource object in this page"
          )
        }

        checkLoop: for (;;) {
          const videoEle = document.querySelector('video')
          if (!videoEle) {
            window.__videoxFatal__('videoEle null')
          }

          if (videoEle.paused) {
            // await window.__videoxLog__('playing video')
            //await videoEle.play()
          }

          switch (obj.downloadStatus) {
            case obj.enumDownloadStatus.DS_UNINTIALIZED:
            case obj.enumDownloadStatus.DS_DOWNLOADING:
              break
            case obj.enumDownloadStatus.DS_END:
              break checkLoop
            case obj.enumDownloadStatus.DS_COMPLETED:
              window.__videoxLog__('download status: ' + obj.downloadStatus)
              obj.downloadStatus = obj.enumDownloadStatus.DS_END
              window.__videoxLog__(
                'download status changed to: ' + obj.downloadStatus
              )

              await new Promise((resolve) =>
                setTimeout(() => resolve(), options.waitForNextDataTimeout)
              )
              continue checkLoop
            default:
              window.__videoxFatal__(
                'endOfStream wrong download status: ' + obj.downloadStatus
              )
              break
          }

          await new Promise((resolve) =>
            setTimeout(() => resolve(), options.checkCompleteLoopInterval)
          )
        }
      },
      {
        checkCompleteLoopInterval: this.options.checkCompleteLoopInterval,
        waitForNextDataTimeout: this.options.waitForNextDataTimeout,
      }
    ),
    'page evaluate'
  )

  await this._to(page.close(), 'close page: ' + pageUrl)

  this._log('downloaded total bytes: ' + totalBytes)
}

// Close the browser.
NewInstance.prototype.destroy = async function () {
  await this._to(this.browser.close(), 'close browser')
}

// Catch promise and log.
NewInstance.prototype._to = async function (pms, msg) {
  let err, data

  this._log(msg + ' ...')
  ;[err, data] = await to(pms)
  if (err) {
    throw new Error(msg + ' error: ' + err)
  }

  this._log(msg + ' OK')

  return data
}

NewInstance.prototype._logRaw = function (str) {
  tlog(this.options.logTo, str, true)
}

NewInstance.prototype._log = function (str) {
  tlog(this.options.logTo, str, false)
}

function tlog(out, msg, raw) {
  if (out && out instanceof stream.Writable) {
    let str

    if (!raw) {
      str = `${logPrefix} ${new Date().toISOString()}: ${msg}\n`
    } else {
      str = msg
    }

    out.write(str)
  }
}

function to(pms) {
  return pms.then((data) => [null, data]).catch((err) => [err, null])
}

function writeToFile(objectUrl, mimeCodec, chunk) {
  options = this.options

  const mimeCodecSplited = String.prototype.split.call(mimeCodec, /\/|;/)
  if (mimeCodecSplited.length < 2) {
    throw new Error('invalid type: ' + mimeCodec)
  }

  let videoOrAudio = mimeCodecSplited[0]
  let ext = mimeCodecSplited[1]

  const childPath = path.normalize(
    objectUrl.replace(/("|:|<|>|\||\*|\?|\/|\\)/g, '-')
  )

  const filePath = path.resolve(
    options.downloadPath,
    childPath,
    videoOrAudio + '.' + ext
  )

  fs.mkdirSync(path.dirname(filePath), { recursive: true })

  fs.writeFileSync(filePath, chunk, { flag: 'as' })
}
