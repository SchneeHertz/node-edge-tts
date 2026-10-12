const { EdgeTTS } = require('../dist/edge-tts.js')
const { join } = require('node:path')
const express = require('express')

const tts = new EdgeTTS({
  outputFormat: 'audio-24khz-96kbitrate-mono-mp3',
  saveSubtitles: true,
  timeout: 10000,
  // proxy: 'http://localhost:7890',
})
const app = express()
const subtitleStreams = new Map()

app.get('/', (req, res) => {
  res.sendFile(join(__dirname, 'streamAudio.html'))
})

app.get('/api/tts-subtitles', (req, res) => {
  const id = req.query.id
  if (typeof id !== 'string' || !id) {
    res.status(400).send('缺少请求 ID')
    return
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  subtitleStreams.set(id, res)
  res.on('close', () => subtitleStreams.delete(id))
  res.write('event: ready\ndata: {}\n\n')
})

app.get('/api/tts-stream', async (req, res) => {
  const text = typeof req.query.text === 'string' ? req.query.text : '请输入文字'
  const subtitles = subtitleStreams.get(req.query.id)
  if (!subtitles) {
    res.status(400).send('请先连接字幕流')
    return
  }

  res.setHeader('Content-Type', 'audio/mpeg')
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Transfer-Encoding', 'chunked')
  res.on('close', () => subtitles.end())

  try {
    for await (const chunk of tts.streamAudio(text)) {
      if (res.destroyed) break
      if (Buffer.isBuffer(chunk)) {
        res.write(chunk)
      } else if (!subtitles.writableEnded) {
        subtitles.write(`event: subtitle\ndata: ${JSON.stringify(chunk)}\n\n`)
      }
    }

    if (!subtitles.writableEnded) {
      subtitles.write('event: done\ndata: {}\n\n')
    }
    console.log('TTS stream ended')
  } catch (error) {
    console.error(error)
    if (!subtitles.writableEnded) {
      subtitles.write(`event: tts-error\ndata: ${JSON.stringify({ message: String(error) })}\n\n`)
    }
    if (!res.headersSent) res.status(500)
  } finally {
    subtitles.end()
    res.end()
  }
})

app.listen(3000, () => {
  console.log('Open http://localhost:3000 to play audio with subtitles')
})
