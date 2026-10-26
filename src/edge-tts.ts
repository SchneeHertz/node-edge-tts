import { randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { open } from 'node:fs/promises'
import { WebSocket } from 'ws'
import { HttpsProxyAgent } from 'https-proxy-agent'
import { generateSecMsGecToken_V2, TRUSTED_CLIENT_TOKEN, CHROMIUM_FULL_VERSION, SEC_MS_GEC_VERSION_V2 } from './drm'

function escapeXml (unsafe: string): string {
  return unsafe.replace(/[<>&"']/g, (c) => {
    switch (c) {
      case '<': return '&lt;'
      case '>': return '&gt;'
      case '&': return '&amp;'
      case '"': return '&quot;'
      case "'": return '&apos;'
      default: return c
    }
  })
}

type subLine = {
  part: string
  start: number
  end: number
}

type audioMetadata = {
  Metadata: {
    Type: string
    Data: {
      Offset: number
      Duration: number
      text: {
        Text: string
      }
    }
  }[]
}

type configure = {
  voice?: string
  lang?: string
  outputFormat?: string
  saveSubtitles?: boolean
  proxy?: string
  rate?: string
  pitch?: string
  volume?: string
  timeout?: number
}

class EdgeTTS {

  private voice: string
  private lang: string
  private outputFormat: string
  private saveSubtitles: boolean
  private proxy?: string
  private rate: string
  private pitch: string
  private volume: string
  private timeout: number

  constructor ({
    voice = 'zh-CN-XiaoyiNeural',
    lang = 'zh-CN',
    outputFormat = 'audio-24khz-48kbitrate-mono-mp3',
    saveSubtitles = false,
    proxy,
    rate = 'default',
    pitch = 'default',
    volume = 'default',
    timeout = 10000
  }: configure = {}) {
    this.voice = voice
    this.lang = lang
    this.outputFormat = outputFormat
    this.saveSubtitles = saveSubtitles
    this.proxy = proxy
    this.rate = rate
    this.pitch = pitch
    this.volume = volume
    this.timeout = timeout
  }

  async _connectWebSocket (): Promise<WebSocket> {
    const wsConnect = new WebSocket(`wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1?Ocp-Apim-Subscription-Key=${TRUSTED_CLIENT_TOKEN}&Sec-MS-GEC=${generateSecMsGecToken_V2()}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION_V2}`, {
      host: 'speech.platform.bing.com',
      origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
      headers: {
        'Pragma': 'no-cache',
        'Cache-Control': 'no-cache',
        'User-Agent': `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_FULL_VERSION.split('.')[0]}.0.0.0 Safari/537.36 Edg/${CHROMIUM_FULL_VERSION.split('.')[0]}.0.0.0`,
        'Accept-Encoding': 'gzip, deflate, br, zstd',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      agent: this.proxy ? new HttpsProxyAgent(this.proxy) : undefined
    })
    return new Promise<WebSocket>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Timed out while connecting to Edge TTS'))
        wsConnect.terminate()
      }, this.timeout)
      const onOpen = () => {
        clearTimeout(timeout)
        resolve(wsConnect)
      }
      // Keep the error listener until close to handle errors during termination.
      const onError = (error: Error) => {
        clearTimeout(timeout)
        reject(error)
      }
      const onClose = () => {
        clearTimeout(timeout)
        wsConnect.off('open', onOpen)
        wsConnect.off('error', onError)
        reject(new Error('WebSocket closed before the connection was established'))
      }
      wsConnect.once('open', onOpen)
      wsConnect.on('error', onError)
      wsConnect.once('close', onClose)
    })
  }

  _saveSubFile (subFile: subLine[], text: string, audioPath: string) {
    let subPath = audioPath + '.json'
    let subChars = text.split('')
    let subCharIndex = 0
    subFile.forEach((cue: subLine, index: number) => {
      let fullPart = ''
      let stepIndex = 0
      for (let sci = subCharIndex; sci < subChars.length; sci++) {
        if (subChars[sci] === cue.part[stepIndex]) {
          fullPart = fullPart + subChars[sci]
          stepIndex += 1
        } else if (subChars[sci] === subFile?.[index + 1]?.part?.[0]) {
          subCharIndex = sci
          break
        } else {
          fullPart = fullPart + subChars[sci]
        }
      }
      cue.part = fullPart
    })
    writeFileSync(subPath, JSON.stringify(subFile, null, '  '), { encoding: 'utf-8' })
  }

  async ttsPromise (text: string, audioPath: string): Promise<void> {
    const audioFile = await open(audioPath, 'w')
    const subtitles: subLine[] = []
    try {
      for await (const chunk of this.streamAudio(text)) {
        if (Buffer.isBuffer(chunk)) {
          await audioFile.writeFile(chunk)
        } else {
          subtitles.push(chunk)
        }
      }
      if (this.saveSubtitles) {
        this._saveSubFile(subtitles, text, audioPath)
      }
    } finally {
      await audioFile.close()
    }
  }

  /**
   * Stream audio and optional word boundaries until turn.end.
   * The timeout includes the handshake. Errors reject the pending iteration;
   * stopping consumption early terminates the connection.
   */
  async * streamAudio (text: string): AsyncGenerator<Buffer | subLine> {
    const started = Date.now()
    const wsConnect = await this._connectWebSocket()
    const queue: (Buffer | subLine)[] = []
    let done = false
    let failure: Error | undefined
    let resolveWait: (() => void) | undefined

    const wake = () => {
      const resolve = resolveWait
      resolveWait = undefined
      if (resolve) resolve()
    }
    const cleanup = () => {
      clearTimeout(timeout)
      wsConnect.off('message', onMessage)
      wsConnect.off('error', onError)
      wsConnect.off('close', onClose)
    }
    const finish = (error?: Error) => {
      if (done) return
      done = true
      failure = error
      cleanup()
      wake()
      if (error) wsConnect.terminate()
      else wsConnect.close()
    }
    const onError = (error: Error) => finish(error)
    const onClose = (code: number) =>
      finish(new Error(`WebSocket closed before turn.end (code ${code})`))
    const onMessage = (data: Buffer, isBinary: boolean) => {
      if (isBinary) {
        if (data.length < 2) {
          finish(new Error('Invalid audio frame header'))
          return
        }
        const payloadOffset = data.readUInt16BE(0) + 2
        if (payloadOffset > data.length) {
          finish(new Error('Invalid audio frame header length'))
          return
        }
        const audioData = data.subarray(payloadOffset)
        if (audioData.length > 0) {
          queue.push(audioData)
          wake()
        }
      } else {
        const message = data.toString()
        if (message.includes('Path:turn.end')) {
          finish()
        } else if (message.includes('Path:audio.metadata') && this.saveSubtitles) {
          try {
            const metadata: audioMetadata = JSON.parse(message.slice(message.indexOf('\r\n\r\n') + 4))
            metadata.Metadata.forEach((element) => {
              if (element.Type === 'WordBoundary') {
                queue.push({
                  part: element.Data.text.Text,
                  start: Math.floor(element.Data.Offset / 10000),
                  end: Math.floor((element.Data.Offset + element.Data.Duration) / 10000)
                })
              }
            })
            wake()
          } catch (error) {
            finish(error)
          }
        }
      }
    }
    const timeout = setTimeout(
      () => finish(new Error('Timed out waiting for Edge TTS')),
      Math.max(0, this.timeout - (Date.now() - started))
    )

    wsConnect.on('message', onMessage)
    wsConnect.on('error', onError)
    wsConnect.on('close', onClose)
    try {
      if (wsConnect.readyState !== WebSocket.OPEN) {
        throw new Error('WebSocket closed before synthesis started')
      }
      wsConnect.send(`Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` + JSON.stringify({
        context: {
          synthesis: {
            audio: {
              metadataoptions: {
                sentenceBoundaryEnabled: 'false',
                wordBoundaryEnabled: 'true'
              },
              outputFormat: this.outputFormat
            }
          }
        }
      }))
      const requestId = randomBytes(16).toString('hex')
      wsConnect.send(`X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n` +
        `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${this.lang}">
          <voice name="${this.voice}">
            <prosody rate="${this.rate}" pitch="${this.pitch}" volume="${this.volume}">
              ${escapeXml(text)}
            </prosody>
          </voice>
        </speak>`)

      while (true) {
        if (failure) throw failure
        const chunk = queue.shift()
        if (chunk !== undefined) {
          yield chunk
        } else if (done) {
          return
        } else {
          await new Promise<void>((resolve) => { resolveWait = resolve })
        }
      }
    } finally {
      cleanup()
      if (!done) {
        done = true
        wsConnect.terminate()
      }
    }
  }
}

export { EdgeTTS }
