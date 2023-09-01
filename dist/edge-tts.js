"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EdgeTTS = void 0;
const node_crypto_1 = require("node:crypto");
const node_fs_1 = require("node:fs");
const ws_1 = require("ws");
const https_proxy_agent_1 = require("https-proxy-agent");
class EdgeTTS {
    constructor({ voice = 'zh-CN-XiaoyiNeural', lang = 'zh-CN', outputFormat = 'audio-24khz-48kbitrate-mono-mp3', saveSubtitles = false, proxy } = {}) {
        this.voice = voice;
        this.lang = lang;
        this.outputFormat = outputFormat;
        this.saveSubtitles = saveSubtitles;
        this.proxy = proxy;
    }
    _connectWebSocket() {
        return __awaiter(this, void 0, void 0, function* () {
            const wsConnect = new ws_1.WebSocket(`wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=6A5AA1D4EAFF4E9FB37E23D68491D6F4`, {
                host: 'speech.platform.bing.com',
                origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/103.0.5060.66 Safari/537.36 Edg/103.0.1264.44',
                },
                agent: this.proxy ? new https_proxy_agent_1.HttpsProxyAgent(this.proxy) : undefined
            });
            return new Promise((resolve) => {
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
        `);
                    resolve(wsConnect);
                });
            });
        });
    }
    _saveSubFile(subFile, text, audioPath) {
        let subPath = audioPath + '.json';
        let subChars = text.split('');
        let subCharIndex = 0;
        subFile.forEach((cue, index) => {
            var _a, _b;
            let fullPart = '';
            let stepIndex = 0;
            for (let sci = subCharIndex; sci < subChars.length; sci++) {
                if (subChars[sci] === cue.part[stepIndex]) {
                    fullPart = fullPart + subChars[sci];
                    stepIndex += 1;
                }
                else if (subChars[sci] === ((_b = (_a = subFile === null || subFile === void 0 ? void 0 : subFile[index + 1]) === null || _a === void 0 ? void 0 : _a.part) === null || _b === void 0 ? void 0 : _b[0])) {
                    subCharIndex = sci;
                    break;
                }
                else {
                    fullPart = fullPart + subChars[sci];
                }
            }
            cue.part = fullPart;
        });
        (0, node_fs_1.writeFileSync)(subPath, JSON.stringify(subFile, null, '  '), { encoding: 'utf-8' });
    }
    ttsPromise(text, audioPath) {
        return __awaiter(this, void 0, void 0, function* () {
            const _wsConnect = yield this._connectWebSocket();
            return new Promise((resolve) => {
                let audioStream = (0, node_fs_1.createWriteStream)(audioPath);
                let subFile = [];
                _wsConnect.on('message', (data, isBinary) => __awaiter(this, void 0, void 0, function* () {
                    if (isBinary) {
                        let separator = 'Path:audio\r\n';
                        let index = data.indexOf(separator) + separator.length;
                        let audioData = data.subarray(index);
                        audioStream.write(audioData);
                    }
                    else {
                        let message = data.toString();
                        if (message.includes('Path:turn.end')) {
                            audioStream.end();
                            if (this.saveSubtitles) {
                                this._saveSubFile(subFile, text, audioPath);
                            }
                            resolve();
                        }
                        else if (message.includes('Path:audio.metadata')) {
                            let splitTexts = message.split('\r\n');
                            try {
                                let metadata = JSON.parse(splitTexts[splitTexts.length - 1]);
                                metadata['Metadata'].forEach((element) => {
                                    subFile.push({
                                        part: element['Data']['text']['Text'],
                                        start: Math.floor(element['Data']['Offset'] / 10000),
                                        end: Math.floor((element['Data']['Offset'] + element['Data']['Duration']) / 10000)
                                    });
                                });
                            }
                            catch (_a) { }
                        }
                    }
                }));
                let requestId = (0, node_crypto_1.randomBytes)(16).toString('hex');
                _wsConnect.send(`X-RequestId:${requestId}\r\nContent-Type:application/ssml+xml\r\nPath:ssml\r\n\r\n
      ` + `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${this.lang}">
        <voice name="${this.voice}">
          ${text}
        </voice>
      </speak>`);
            });
        });
    }
}
exports.EdgeTTS = EdgeTTS;
