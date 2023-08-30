# node-edge-tts

node-edge-tts is a module that utilizes Microsoft Edge's online TTS (Text-to-Speech) service on Node.js

## Installation

```
npm install node-edge-tts
```

## Example usage

```
const { EdgeTTS } = require('node-edge-tts')
```
or
```
import { EdgeTTS } from 'node-edge-tts'
```

```
const tts = new EdgeTTS()
await tts.ttsPromise('Hello world', path_to_audiofile_with_extension)
```

### configure
```
const tts = new EdgeTTS({
  voice: 'en-US-AriaNeural',
  lang: 'en-US',
  outputFormat: 'audio-24khz-96kbitrate-mono-mp3'
  proxy: 'http://localhost:7890',
  saveSubtitles: true
})
```
You can find the available options for speechconfig at [voice/lang](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=tts)|[outputFormat](https://learn.microsoft.com/en-us/dotnet/api/microsoft.cognitiveservices.speech.speechsynthesisoutputformat?view=azure-dotnet), but not all options are accessible due to limitations of the services provided by Microsoft Edge.