const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { EventEmitter } = require('node:events')
const fs = require('node:fs')
const fsPromises = require('node:fs/promises')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { test } = require('node:test')
const ws = require('ws')
const { EdgeTTS } = require('../dist/edge-tts.js')
const { generateSecMsGecToken_V2, CHROMIUM_FULL_VERSION, TRUSTED_CLIENT_TOKEN } = require('../dist/drm.js')

const root = path.resolve(__dirname, '..')
fs.mkdirSync(path.join(root, 'temp'), { recursive: true })
const output = fs.mkdtempSync(path.join(root, 'temp', 'edge-tts-tests-'))

class FakeSocket extends EventEmitter {
  static OPEN = 1
  static CLOSED = 3

  constructor() {
    super()
    this.readyState = FakeSocket.OPEN
    this.sent = []
    this.closeCalls = 0
    this.terminateCalls = 0
  }

  send(message) {
    this.sent.push(message)
    if (message.includes('Path:ssml') && this.onRequest) {
      queueMicrotask(() => this.onRequest())
    }
  }

  close() {
    this.closeCalls++
    this.drop(1000)
  }

  terminate() {
    this.terminateCalls++
    this.drop(1006)
  }

  drop(code = 1006) {
    if (this.readyState === FakeSocket.CLOSED) return
    this.readyState = FakeSocket.CLOSED
    this.emit('close', code, Buffer.alloc(0))
  }

  audio(payload, header = 'X-RequestId:test\r\nContent-Type:audio/mpeg\r\nPath:audio\r\n') {
    const headerData = Buffer.from(header)
    const size = Buffer.alloc(2)
    size.writeUInt16BE(headerData.length)
    this.emit('message', Buffer.concat([size, headerData, Buffer.from(payload)]), true)
  }

  metadata(items) {
    this.emit('message', Buffer.from('Path:audio.metadata\r\n\r\n' + JSON.stringify({ Metadata: items })), false)
  }

  end() {
    this.emit('message', Buffer.from('Path:turn.end\r\n\r\n'), false)
  }
}

function setup(options = {}) {
  const socket = new FakeSocket()
  const tts = new EdgeTTS({ timeout: 500, ...options })
  tts._connectWebSocket = async () => socket
  return { tts, socket }
}

function boundary(part, offset = 1000000, duration = 2000000, type = 'WordBoundary') {
  return { Type: type, Data: { Offset: offset, Duration: duration, text: { Text: part } } }
}

async function collect(iterator) {
  const chunks = []
  for await (const chunk of iterator) chunks.push(chunk)
  return chunks
}

function assertClean(socket) {
  for (const event of ['message', 'error', 'open', 'close']) {
    assert.equal(socket.listenerCount(event), 0, `remaining ${event} listeners`)
  }
}

function check(name, fn) {
  test(name, { timeout: 3000 }, fn)
}

async function withConstructor(Constructor, fn) {
  const original = ws.WebSocket
  ws.WebSocket = Constructor
  try { await fn() } finally { ws.WebSocket = original }
}

check('connection uses DRM v2 token and version without changing the WebSocket API endpoint', async () => {
  const originalNow = Date.now
  const now = 1700000000123
  Date.now = () => now
  let socket
  let address
  class ConnectingSocket extends FakeSocket {
    constructor(url) {
      super()
      socket = this
      address = new URL(url)
      queueMicrotask(() => this.emit('open'))
    }
  }
  try {
    await withConstructor(ConnectingSocket, async () => {
      await new EdgeTTS()._connectWebSocket()
      try {
        assert.equal(address.protocol, 'wss:')
        assert.equal(address.pathname, '/tts/cognitiveservices/websocket/v1')
        assert.equal(address.searchParams.get('Sec-MS-GEC-Version'), `2-${CHROMIUM_FULL_VERSION}`)
        assert.equal(address.searchParams.get('Sec-MS-GEC'), generateSecMsGecToken_V2(now / 1000))
        assert.match(address.searchParams.get('Sec-MS-GEC'), /^[0-9A-F]{16}-[0-9A-F]{64}$/)
        assert.equal(address.searchParams.get('Ocp-Apim-Subscription-Key'), TRUSTED_CLIENT_TOKEN)
      } finally {
        socket.close()
      }
      assertClean(socket)
    })
  } finally {
    Date.now = originalNow
  }
})

check('DRM v2 SHA-256 suffix matches independently constructed prefix and rounded FILETIME', () => {
  const seconds = 1700000000
  const epochSeconds = BigInt(seconds) + 11644473600n
  const ticks = (epochSeconds / 300n) * 300n * 10000000n
  const expected = createHash('sha256')
    .update('Copyright (C) Microsoft Corporation. All rights reserved.', 'ascii')
    .update(`${ticks}${TRUSTED_CLIENT_TOKEN}`, 'ascii')
    .digest('hex').toUpperCase()
  const token = generateSecMsGecToken_V2(seconds)
  assert.match(token, /^[0-9A-F]{16}-[0-9A-F]{64}$/)
  assert.equal(token.split('-')[1], expected)
})

check('DRM v2 rounds fractional timestamps into five-minute windows', () => {
  const token = generateSecMsGecToken_V2(1699999800)
  assert.equal(generateSecMsGecToken_V2(1700000000), token)
  assert.equal(generateSecMsGecToken_V2(1700000099.999), token)
  assert.notEqual(generateSecMsGecToken_V2(1700000100), token)
})

check('DRM v2 defaults to the current Unix timestamp', () => {
  const originalNow = Date.now
  Date.now = () => 1700000000123
  try {
    assert.equal(generateSecMsGecToken_V2(), generateSecMsGecToken_V2(1700000000.123))
  } finally {
    Date.now = originalNow
  }
})

check('DRM v2 rejects non-finite timestamps', () => {
  for (const timestamp of [NaN, Infinity, -Infinity]) {
    assert.throws(() => generateSecMsGecToken_V2(timestamp), {
      name: 'TypeError',
      message: 'unixSeconds must be a finite number'
    })
  }
})

check('stream preserves audio, filters boundaries, converts timestamps and sends configuration first', async () => {
  const { tts, socket } = setup({ saveSubtitles: true })
  socket.onRequest = () => {
    socket.audio('first')
    socket.metadata([boundary('Hello'), boundary('ignored', 0, 1, 'SentenceBoundary')])
    socket.audio('second')
    socket.end()
  }
  const chunks = await collect(tts.streamAudio('Hello'))
  assert.equal(Buffer.concat(chunks.filter(Buffer.isBuffer)).toString(), 'firstsecond')
  assert.deepEqual(chunks.filter(chunk => !Buffer.isBuffer(chunk)), [{ part: 'Hello', start: 100, end: 300 }])
  assert(socket.sent[0].includes('Path:speech.config'))
  const config = JSON.parse(socket.sent[0].split('\r\n\r\n')[1])
  assert.equal(config.context.synthesis.audio.outputFormat, 'audio-24khz-48kbitrate-mono-mp3')
  assert.equal(socket.closeCalls, 1)
  assert.equal(socket.terminateCalls, 0)
  assertClean(socket)
})

check('stream excludes metadata when subtitles are disabled', async () => {
  const { tts, socket } = setup()
  socket.onRequest = () => { socket.metadata([boundary('Hello')]); socket.audio('audio'); socket.end() }
  const chunks = await collect(tts.streamAudio('Hello'))
  assert.equal(chunks.length, 1)
  assert(Buffer.isBuffer(chunks[0]))
})

check('SSML escapes all five XML text entities and retains voice options', async () => {
  const { tts, socket } = setup({ voice: 'en-US-AriaNeural', lang: 'en-US', rate: '+10%', pitch: '-10%', volume: '-50%' })
  socket.onRequest = () => socket.end()
  await collect(tts.streamAudio('<tag> & "quote" \'apostrophe\''))
  const ssml = socket.sent[1]
  assert(ssml.includes('&lt;tag&gt; &amp; &quot;quote&quot; &apos;apostrophe&apos;'))
  assert(ssml.includes('xml:lang="en-US"'))
  assert(ssml.includes('name="en-US-AriaNeural"'))
  assert(ssml.includes('rate="+10%" pitch="-10%" volume="-50%"'))
})

check('binary framing uses the declared header length, not the position of Path:audio', async () => {
  const { tts, socket } = setup()
  socket.onRequest = () => { socket.audio('payload', 'Path:audio\r\nContent-Type:audio/mpeg\r\n'); socket.audio(''); socket.end() }
  const chunks = await collect(tts.streamAudio('text'))
  assert.equal(Buffer.concat(chunks).toString(), 'payload')
})

check('stream timeout rejects the pending iteration and cleans up', async () => {
  const { tts, socket } = setup({ timeout: 25 })
  await assert.rejects(tts.streamAudio('timeout').next(), /Timed out/)
  assert.equal(socket.terminateCalls, 1)
  assertClean(socket)
})

check('timeout also terminates a stream paused at yield', async () => {
  const { tts, socket } = setup({ timeout: 25 })
  socket.onRequest = () => socket.audio('first')
  const iterator = tts.streamAudio('timeout')
  await iterator.next()
  await new Promise(resolve => setTimeout(resolve, 60))
  assert.equal(socket.terminateCalls, 1)
  assertClean(socket)
  await assert.rejects(iterator.next(), /Timed out/)
})

for (const code of [1000, 1006]) {
  check(`socket close ${code} before turn.end rejects instead of hanging`, async () => {
    const { tts, socket } = setup()
    socket.onRequest = () => socket.drop(code)
    await assert.rejects(tts.streamAudio('closed').next(), /closed before turn.end/)
    assertClean(socket)
  })
}

check('WebSocket errors reach the consumer unchanged', async () => {
  const { tts, socket } = setup()
  const error = new Error('simulated network failure')
  socket.onRequest = () => socket.emit('error', error)
  await assert.rejects(collect(tts.streamAudio('error')), actual => actual === error)
  assert.equal(socket.terminateCalls, 1)
  assertClean(socket)
})

check('breaking out of the stream terminates the connection', async () => {
  const { tts, socket } = setup()
  socket.onRequest = () => socket.audio('first')
  for await (const chunk of tts.streamAudio('cancel')) { assert(Buffer.isBuffer(chunk)); break }
  assert.equal(socket.terminateCalls, 1)
  assertClean(socket)
})

check('explicit generator return terminates the connection', async () => {
  const { tts, socket } = setup()
  socket.onRequest = () => socket.audio('first')
  const iterator = tts.streamAudio('cancel')
  await iterator.next()
  await iterator.return()
  assert.equal(socket.terminateCalls, 1)
  assertClean(socket)
})

check('consumer exceptions terminate the connection', async () => {
  const { tts, socket } = setup()
  socket.onRequest = () => socket.audio('first')
  await assert.rejects((async () => {
    for await (const chunk of tts.streamAudio('cancel')) throw new Error('consumer failed')
  })(), /consumer failed/)
  assert.equal(socket.terminateCalls, 1)
  assertClean(socket)
})

check('synchronous send errors reject and clean up', async () => {
  const { tts, socket } = setup()
  socket.send = () => { throw new Error('send failed') }
  await assert.rejects(tts.streamAudio('error').next(), /send failed/)
  assert.equal(socket.terminateCalls, 1)
  assertClean(socket)
})

check('a connection closed before listener registration rejects', async () => {
  const { tts, socket } = setup()
  socket.readyState = FakeSocket.CLOSED
  await assert.rejects(tts.streamAudio('closed').next(), /closed before synthesis started/)
  assertClean(socket)
})

for (const frame of [Buffer.from([0]), Buffer.from([0, 20, 1])]) {
  check(`invalid binary header (${frame.length} bytes) rejects cleanly`, async () => {
    const { tts, socket } = setup()
    socket.onRequest = () => socket.emit('message', frame, true)
    await assert.rejects(tts.streamAudio('invalid').next(), /Invalid audio frame/)
    assertClean(socket)
  })
}

check('malformed requested subtitle metadata rejects cleanly', async () => {
  const { tts, socket } = setup({ saveSubtitles: true })
  socket.onRequest = () => socket.emit('message', Buffer.from('Path:audio.metadata\r\n\r\n{invalid'), false)
  await assert.rejects(tts.streamAudio('invalid').next(), SyntaxError)
  assertClean(socket)
})

check('file synthesis writes every chunk and restores punctuation in subtitles', async () => {
  const { tts, socket } = setup({ saveSubtitles: true })
  const file = path.join(output, 'happy.bin')
  socket.onRequest = () => { socket.audio('first'); socket.metadata([boundary('Hello'), boundary('world', 4000000)]); socket.audio('second'); socket.end() }
  await tts.ttsPromise('Hello, world!', file)
  assert.equal(fs.readFileSync(file, 'utf8'), 'firstsecond')
  assert.deepEqual(JSON.parse(fs.readFileSync(file + '.json', 'utf8')), [
    { part: 'Hello, ', start: 100, end: 300 }, { part: 'world!', start: 400, end: 600 }
  ])
  assertClean(socket)
})

check('file synthesis does not write subtitles when disabled', async () => {
  const { tts, socket } = setup()
  const file = path.join(output, 'no-subtitles.bin')
  socket.onRequest = () => { socket.audio('audio'); socket.end() }
  await tts.ttsPromise('text', file)
  assert.equal(fs.readFileSync(file, 'utf8'), 'audio')
  assert.equal(fs.existsSync(file + '.json'), false)
})

check('invalid file paths reject normally before connecting', async () => {
  const { tts, socket } = setup()
  await assert.rejects(tts.ttsPromise('text', path.join(output, 'missing-parent', 'audio.mp3')), { code: 'ENOENT' })
  assert.equal(socket.sent.length, 0)
})

check('mid-write failures close both file and WebSocket', async () => {
  const { tts, socket } = setup()
  const error = new Error('disk write failed')
  const original = fsPromises.open
  let closed = false
  fsPromises.open = async () => ({ async writeFile() { throw error }, async close() { closed = true } })
  socket.onRequest = () => socket.audio('first')
  try { await assert.rejects(tts.ttsPromise('text', 'unused'), actual => actual === error) }
  finally { fsPromises.open = original }
  assert(closed)
  assert.equal(socket.terminateCalls, 1)
  assertClean(socket)
})

for (const scenario of ['timeout', 'error', 'close']) {
  check(`file synthesis rejects and releases its file on ${scenario}`, async () => {
    const { tts, socket } = setup({ timeout: scenario === 'timeout' ? 25 : 500 })
    const original = fsPromises.open
    let closed = false
    fsPromises.open = async () => ({ async writeFile() {}, async close() { closed = true } })
    if (scenario === 'error') socket.onRequest = () => socket.emit('error', new Error('network failed'))
    if (scenario === 'close') socket.onRequest = () => socket.drop()
    try { await assert.rejects(tts.ttsPromise('text', 'unused'), /Timed out|network failed|closed before turn.end/) }
    finally { fsPromises.open = original }
    assert(closed)
    assertClean(socket)
  })
}

check('subtitle write failures reject instead of crashing', async () => {
  const { tts, socket } = setup({ saveSubtitles: true })
  const file = path.join(output, 'subtitle-error.bin')
  fs.mkdirSync(file + '.json')
  socket.onRequest = () => { socket.audio('audio'); socket.end() }
  await assert.rejects(tts.ttsPromise('text', file), /EISDIR|EPERM|EACCES/)
  assertClean(socket)
})

check('handshake timeout terminates the pending connection and handles late errors', async () => {
  let socket
  class ConnectingSocket extends FakeSocket {
    constructor() { super(); this.readyState = 0; socket = this }
    terminate() {
      this.terminateCalls++
      queueMicrotask(() => { this.emit('error', new Error('late handshake error')); this.drop() })
    }
  }
  await withConstructor(ConnectingSocket, async () => {
    await assert.rejects(new EdgeTTS({ timeout: 25 })._connectWebSocket(), /Timed out while connecting/)
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(socket.terminateCalls, 1)
    assertClean(socket)
  })
})

check('handshake errors propagate and listeners are removed on close', async () => {
  let socket
  const error = new Error('handshake failed')
  class ConnectingSocket extends FakeSocket {
    constructor() { super(); socket = this; queueMicrotask(() => { this.emit('error', error); this.drop() }) }
  }
  await withConstructor(ConnectingSocket, async () => {
    await assert.rejects(new EdgeTTS()._connectWebSocket(), actual => actual === error)
    assertClean(socket)
  })
})

check('closing before handshake completes rejects', async () => {
  let socket
  class ConnectingSocket extends FakeSocket {
    constructor() { super(); socket = this; queueMicrotask(() => this.drop()) }
  }
  await withConstructor(ConnectingSocket, async () => {
    await assert.rejects(new EdgeTTS()._connectWebSocket(), /closed before the connection was established/)
    assertClean(socket)
  })
})

check('successful handshake keeps a late-error guard only until close', async () => {
  let socket
  class ConnectingSocket extends FakeSocket {
    constructor() { super(); socket = this; queueMicrotask(() => this.emit('open')) }
  }
  await withConstructor(ConnectingSocket, async () => {
    assert.equal(await new EdgeTTS()._connectWebSocket(), socket)
    socket.emit('error', new Error('late connection error'))
    socket.drop()
    assertClean(socket)
  })
})

check('synthesis timeout includes elapsed handshake time', async () => {
  const { tts, socket } = setup({ timeout: 500 })
  const original = Date.now
  const started = original()
  let now = started
  Date.now = () => now
  tts._connectWebSocket = async () => { now += 480; return socket }
  try {
    await assert.rejects(tts.streamAudio('timeout').next(), /Timed out/)
    assert(original() - started < 300, 'synthesis incorrectly received a fresh timeout budget')
  } finally { Date.now = original }
  assertClean(socket)
})

function runCli(fail = false) {
  const bin = path.join(root, 'bin.js')
  const modulePath = require.resolve('../dist/edge-tts.js')
  const script = `require(${JSON.stringify(modulePath)}); require.cache[${JSON.stringify(modulePath)}].exports = { EdgeTTS: class { constructor(options) { console.log(JSON.stringify(options)) } async ttsPromise() { ${fail ? "throw new Error('CLI synthesis failed')" : ''} } } }; process.argv = [process.execPath, ${JSON.stringify(bin)}, '-t', 'text', '--timeout', '123']; require(${JSON.stringify(bin)});`
  return spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 3000 })
}

check('CLI forwards the configured timeout', () => {
  const result = runCli()
  assert.equal(result.status, 0, result.stderr)
  assert.equal(JSON.parse(result.stdout.split('\n')[0]).timeout, 123)
  assert(result.stdout.includes('Converted to'))
})

check('CLI reports failures and exits with code 1', () => {
  const result = runCli(true)
  assert.equal(result.status, 1)
  assert.match(result.stderr, /CLI synthesis failed/)
  assert.doesNotMatch(result.stderr, /UnhandledPromiseRejection/)
  assert.doesNotMatch(result.stdout, /Converted to/)
})
