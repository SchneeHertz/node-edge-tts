#!/usr/bin/env node
const { EdgeTTS } = require('./dist/edge-tts.js')
const yargs = require('yargs/yargs')
const { hideBin } = require('yargs/helpers')
const argv = yargs(hideBin(process.argv))
  .usage('Usage: npx node-edge-tts <text> [options]')
  .options({
    text: { type: 'string', demandOption: true, alias: 't' },
    path: { type: 'string', alias: 'p' }
  })
  .default({
    path: `./output.mp3`
  })
  .argv

console.log(argv)
const { text, path } = argv

const tts = new EdgeTTS({
  lang: undefined,
  saveSubtitles: true
})


;(async () => {
  await tts.ttsPromise(text, path)
  console.log(tts)
  process.exit()
})()
