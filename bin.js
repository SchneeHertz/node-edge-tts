#!/usr/bin/env node
const { EdgeTTS } = require('./dist/edge-tts.js')
const yargs = require('yargs/yargs')
const { hideBin } = require('yargs/helpers')
const argv = yargs(hideBin(process.argv))
  .usage('Usage: npx node-edge-tts [options]')
  .options({
    text: { type: 'string', demandOption: true, alias: 't', describe: 'The text to be converted to speech' },
    filepath: { type: 'string', alias: 'f', describe: 'The output file path' },
    voice: { type: 'string', alias: 'v', describe: 'The voice to be used' },
    lang: { type: 'string', alias: 'l', describe: 'The language to be used' },
    outputFormat: { type: 'string', alias: 'o', describe: 'The output format' },
    pitch: { type: 'string', describe: 'The pitch of the voice' },
    rate: { type: 'string', alias: 'r', describe: 'The rate of the voice' },
    volume: { type: 'string', describe: 'The volume of the voice'},
    saveSubtitles: { type: 'boolean', alias: 's', describe: 'Whether to save subtitles' },
    proxy: { type: 'string', alias: 'p', describe: 'example: http://localhost:7890' },
    timeout: { type: 'number', describe: 'The timeout of the request' }
  })
  .default({
    filepath: `./output.mp3`,
    voice: 'zh-CN-XiaoyiNeural',
    lang: 'zh-CN',
    outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
    pitch: 'default',
    rate: 'default',
    volume: 'default',
    saveSubtitles: false,
    timeout: 10000
  })
  .example(`npx node-edge-tts -t 'Hello world' -f './output.mp3'`)
  .argv

const { text, filepath, voice, lang, outputFormat, pitch, rate, volume, saveSubtitles, proxy } = argv
const tts = new EdgeTTS({ voice, lang, outputFormat, pitch, rate, volume, saveSubtitles, proxy })

;(async () => {
  await tts.ttsPromise(text, filepath)
  console.log(`Converted to ${filepath}`)
  if (saveSubtitles) {
    console.log(`Saved subtitles to ${filepath}.json`)
  }
  process.exit()
})()
