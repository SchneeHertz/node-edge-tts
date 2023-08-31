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
  outputFormat: 'audio-24khz-96kbitrate-mono-mp3',
  saveSubtitles: true,
  proxy: 'http://localhost:7890',
})
```
You can find the available options for speechconfig at [voice/lang](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/language-support?tabs=tts)|[outputFormat](https://learn.microsoft.com/en-us/dotnet/api/microsoft.cognitiveservices.speech.speechsynthesisoutputformat?view=azure-dotnet), but not all options are accessible due to limitations of the services provided by Microsoft Edge.

### subtitles
Subtitles are json files with the same name as the audio file, as shown below:
```
\\ the *start* is the time point at which the *part* begins, measured in milliseconds.
[
  { "part": "node-edge-tts ", "start": 212 },
  { "part": "is ", "start": 1412 },
  { "part": "a ", "start": 1575 },
  { "part": "module ", "start": 1625 },
  { "part": "that ", "start": 2175 },
  { "part": "utilizes ", "start": 2512 },
  { "part": "Microsoft ", "start": 3300 },
  { "part": "Edge's ", "start": 3912 },
  { "part": "online ", "start": 4337 },
  { "part": "TTS (", "start": 4875 },
  { "part": "Text-to-Speech) ", "start": 5712 },
  { "part": "service ", "start": 6900 },
  { "part": "on ", "start": 7487 },
  { "part": "Node.", "start": 7687 },
  { "part": "js\"", "start": 8087 }
]
```