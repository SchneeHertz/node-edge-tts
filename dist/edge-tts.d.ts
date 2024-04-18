import { WebSocket } from 'ws';
type subLine = {
    part: string;
    start: number;
    end: number;
};
type configure = {
    voice?: string;
    lang?: string;
    outputFormat?: string;
    saveSubtitles?: boolean;
    proxy?: string;
    rate?: string;
    pitch?: string;
    volume?: string;
};
declare class EdgeTTS {
    private voice;
    private lang;
    private outputFormat;
    private saveSubtitles;
    private proxy;
    private rate;
    private pitch;
    private volume;
    constructor({ voice, lang, outputFormat, saveSubtitles, proxy, rate, pitch, volume }?: configure);
    _connectWebSocket(): Promise<WebSocket>;
    _saveSubFile(subFile: subLine[], text: string, audioPath: string): void;
    ttsPromise(text: string, audioPath: string): Promise<unknown>;
}
export { EdgeTTS };
