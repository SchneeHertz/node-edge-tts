#!/usr/bin/env node
const { EdgeTTS } = require('./dist/edge-tts.js')
const yargs = require('yargs/yargs')
const { hideBin } = require('yargs/helpers')
const argv = yargs(hideBin(process.argv))
  .usage('Usage: npx node-edge-tts [options]')
  .options({
    text: { type: 'string', demandOption: true, alias: 't' },
    filepath: { type: 'string', alias: 'f' },
    voice: { type: 'string', alias: 'v' },
    lang: { type: 'string', alias: 'l' },
    outputFormat: { type: 'string', alias: 'o' },
    saveSubtitles: { type: 'boolean', alias: 's' },
    proxy: { type: 'string', alias: 'p' },
  })
  .default({
    filepath: `./output.mp3`,
    voice: 'zh-CN-XiaoyiNeural',
    lang: 'zh-CN',
    outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
    saveSubtitles: false
  })
  .example(`npx node-edge-tts -t 'Hello world' -f './output.mp3'`)
  .argv

console.log(argv)
const { text, filepath, voice, lang, outputFormat, saveSubtitles, proxy } = argv
const tts = new EdgeTTS({ voice, lang, outputFormat, saveSubtitles, proxy })

;(async () => {
  await tts.ttsPromise(text, filepath)
  console.log(tts)
  process.exit()
})()
