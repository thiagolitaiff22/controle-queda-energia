// Três propostas de ícone com tema de energia para o aplicativo (prévia lado a lado para o usuário escolher)
const sharp = require('sharp'), path = require('path');
const RAIO = 'M290 64 132 290h108l-30 158 170-236H272z';
const OPCOES = {
  a: `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFC21A"/><stop offset="1" stop-color="#FF6A00"/></linearGradient>
    <filter id="s" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#7a2a00" flood-opacity=".35"/></filter></defs>
    <rect width="512" height="512" rx="116" fill="url(#g)"/>
    <circle cx="410" cy="96" r="150" fill="#fff" opacity=".10"/>
    <path d="${RAIO}" fill="#fff" filter="url(#s)" stroke="#fff" stroke-width="10" stroke-linejoin="round"/></svg>`,
  b: `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
    <defs><radialGradient id="bg" cx=".5" cy=".42" r=".7"><stop offset="0" stop-color="#1a1f2e"/><stop offset="1" stop-color="#05070c"/></radialGradient>
    <linearGradient id="r" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF36B"/><stop offset="1" stop-color="#FFB300"/></linearGradient>
    <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="16" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
    <rect width="512" height="512" rx="116" fill="url(#bg)"/>
    <circle cx="256" cy="256" r="168" fill="none" stroke="#FFD43B" stroke-opacity=".28" stroke-width="10"/>
    <circle cx="256" cy="256" r="168" fill="none" stroke="#FFD43B" stroke-width="10" stroke-linecap="round" stroke-dasharray="260 900" transform="rotate(-120 256 256)" filter="url(#glow)"/>
    <g transform="translate(256 256) scale(.72) translate(-256 -256)"><path d="${RAIO}" fill="url(#r)" filter="url(#glow)" stroke="#FFE066" stroke-width="8" stroke-linejoin="round"/></g></svg>`,
  c: `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2F6BFF"/><stop offset="1" stop-color="#00C2A8"/></linearGradient></defs>
    <rect width="512" height="512" rx="116" fill="url(#g)"/>
    <g fill="none" stroke="#fff" stroke-width="26" stroke-linecap="round" stroke-linejoin="round">
      <path d="M256 92c-70 0-122 52-122 118 0 44 22 72 44 96 14 15 22 30 22 48v18h112v-18c0-18 8-33 22-48 22-24 44-52 44-96 0-66-52-118-122-118z"/>
      <path d="M206 420h100"/></g>
    <path d="M272 140 214 236h44l-14 70 62-100h-46z" fill="#FFE066" stroke="#FFE066" stroke-width="8" stroke-linejoin="round"/></svg>`
};
(async () => {
  const out = path.join(process.argv[2] || '.', 'opcoes-icone.png');
  const W = 1500, H = 680, comps = [];
  const nomes = { a: 'A · Raio laranja', b: 'B · Raio neon no escuro', c: 'C · Lâmpada com raio' };
  let x = 70;
  for (const k of ['a', 'b', 'c']){
    const png = await sharp(Buffer.from(OPCOES[k])).resize(380, 380).png().toBuffer();
    comps.push({ input: png, left: x, top: 90 });
    comps.push({ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="440" height="80"><text x="190" y="50" font-family="Segoe UI, Arial" font-size="34" font-weight="700" fill="#111" text-anchor="middle">${nomes[k]}</text></svg>`), left: x - 30, top: 500 });
    x += 480;
  }
  await sharp({ create: { width: W, height: H, channels: 4, background: '#f4f4f5' } }).composite(comps).png().toFile(out);
  for (const k of Object.keys(OPCOES)) await sharp(Buffer.from(OPCOES[k])).resize(512, 512).png().toFile(path.join(process.argv[2] || '.', 'icone-' + k + '.png'));
  console.log(out);
})();
module.exports = OPCOES;
