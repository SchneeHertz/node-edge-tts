const { randomBytes } = require('node:crypto')
const { writeFileSync, createWriteStream } = require('node:fs')
const { WebSocket } = require('ws')
const { HttpsProxyAgent } = require('https-proxy-agent')


class EdgeTTS {

  voice
  lang
  outputFormat
  proxy
  saveSubtitles

  constructor ({
    voice = 'zh-CN-XiaoyiNeural',
    lang = 'zh-CN',
    outputFormat = 'audio-24khz-48kbitrate-mono-mp3',
    saveSubtitles = false,
    proxy
  }) {
    this.voice = voice
    this.lang = lang
    this.outputFormat = outputFormat
    this.saveSubtitles = saveSubtitles
    this.proxy = proxy
  }

  async _connectWebSocket () {
    const wsConnect = new WebSocket(`wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4`, {
      host: 'speech.platform.bing.com',
      origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.5060.66 Safari/537.36 Edg/103.0.1264.44',
      },
      agent: this.proxy ? new HttpsProxyAgent(this.proxy) : undefined
    })
    await new Promise((resolve, reject) => {
      wsConnect.on('open', () => {
        wsConnect.send(`Content-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n
          {
            "context": {
              "synthesis": {
                "audio": {
                  "metadataoptions": {
                    "sentenceBoundaryEnabled": "false",
                    "wordBoundaryEnabled": "true"
                  },
                  "outputFormat": "${this.outputFormat}"
                }
              }
            }
          }
        `)
        resolve()
      })
    })
    return wsConnect
  }

  _saveSubFile (subFile, text, audioPath) {
    let subPath = audioPath + '.json'
    let subChars = text.split('')
    let subCharIndex = 0
    subFile.forEach((cue, index) => {
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

  async ttsPromise (text, audioPath) {
    const _wsConnect = await this._connectWebSocket()
    return await new Promise((resolve, reject) => {
      let audioStream = createWriteStream(audioPath)
      let subFile = []
      _wsConnect.on('message', async (data, isBinary) => {
        if (isBinary) {
          let separator = 'Path:audio\r\n'
          let index = data.indexOf(separator) + separator.length
          let audioData = data.slice(index)
          audioStream.write(audioData)
        } else {
          let message = data.toString()
          if (message.includes('Path:turn.end')) {
            audioStream.end()
            if (this.saveSubtitles) {
              this._saveSubFile(subFile, text, audioPath)
            }
            resolve()
          } else if (message.includes('Path:audio.metadata')) {
            let splitTexts = message.split('\r\n')
            try {
              let metadata = JSON.parse(splitTexts[splitTexts.length - 1])
              metadata['Metadata'].forEach(element => {
                subFile.push({ part: element['Data']['text']['Text'], start: Math.floor(element['Data']['Offset'] / 10000) })
              })
            } catch {}
          }
        }
      })
      let requestId = randomBytes(16).toString('hex')
      _wsConnect.send(`X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n
      ` + `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${this.lang}">
        <voice name="${this.voice}">
          ${text}
        </voice>
      </speak>`)
    })
  }
}

module.exports = {
  EdgeTTS
}