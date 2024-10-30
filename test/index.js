const { EdgeTTS } = require('../dist/edge-tts.js')
const path = require('node:path')


const tts = new EdgeTTS({
  voice: 'pt-BR-ThalitaNeural',
  lang: 'pt-BR',
  outputFormat: 'audio-24khz-96kbitrate-mono-mp3',
  saveSubtitles: true,
  proxy: 'http://localhost:7890',
  timeout: 10000
})
;(async () => {
  try {
    await tts.ttsPromise(`No Brasil, a diversidade cultural é uma das características mais marcantes. Com influências indígenas, africanas e europeias, o país desenvolveu uma mistura única de tradições e costumes. As festas populares, como o Carnaval, atraem visitantes de todo o mundo, encantados pelas cores, músicas e danças vibrantes.
    A culinária brasileira também reflete essa diversidade. Pratos como a feijoada, a moqueca e o acarajé são apenas alguns exemplos da rica gastronomia do país, preparados com ingredientes locais que variam conforme a região.
    Além disso, o Brasil é conhecido por suas belezas naturais. Com florestas tropicais, pantanais e um extenso litoral, oferece uma variedade de paisagens e ecossistemas. A Amazônia, muitas vezes chamada de "pulmão do mundo", destaca-se pela sua vastidão e biodiversidade.
    Assim, explorar o Brasil é uma experiência enriquecedora, que proporciona um encontro com uma multiplicidade de culturas, sabores e paisagens.`, path.join(__dirname, 'test.mp3'))
    console.log('end')
  } catch (e) {
    console.error(e)
  }
})()
