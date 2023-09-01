#!/usr/bin/env node
const { EdgeTTS } = require('./dist/edge-tts.js')
const yargs = require('yargs/yargs')
const { hideBin } = require('yargs/helpers')
const argv = yargs(hideBin(process.argv))
  .usage('Usage: npx node-edge-tts <text> [options]')
  .options({
    text: { type: 'string', demandOption: true, alias: 't' }
  })
  .argv

const { text } = argv

const tts = new EdgeTTS({
  lang: undefined,
  saveSubtitles: true
})

console.log(argv)

;(async () => {
  // await tts.ttsPromise('Hello world', './example.mp3')
  console.log(tts)
  process.exit()
})()
