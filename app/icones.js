// Gera o ícone e a tela de abertura do aplicativo: raio neon amarelo num fundo escuro (opção B em branco no preto, 04/11/2026).
// Também gera os ícones do aplicativo instalado pelo navegador (pasta img/) e a imagem usada dentro do app.
const sharp = require('sharp'), fs = require('fs'), path = require('path');
const RES = path.join(__dirname, 'android/app/src/main/res');
const IMG = path.join(__dirname, '../img');
const FUNDO = '#0a0a0a';
const RAIO = 'M290 64 132 290h108l-30 158 170-236H272z';
const DEFS = `<defs><radialGradient id="bg" cx=".5" cy=".42" r=".7"><stop offset="0" stop-color="#1f1f22"/><stop offset="1" stop-color="#060606"/></radialGradient>
  <linearGradient id="r" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset="1" stop-color="#BDBDC4"/></linearGradient>
  <filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="12" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`;
// só o desenho (anel + raio), centrado em 256,256, num quadro de 512
const MARCA = `<circle cx="256" cy="256" r="168" fill="none" stroke="#FFFFFF" stroke-opacity=".18" stroke-width="10"/>
  <circle cx="256" cy="256" r="168" fill="none" stroke="#FFFFFF" stroke-width="10" stroke-linecap="round" stroke-dasharray="260 900" transform="rotate(-120 256 256)" filter="url(#glow)"/>
  <g transform="translate(256 256) scale(.72) translate(-256 -256)"><path d="${RAIO}" fill="url(#r)" filter="url(#glow)" stroke="#FFFFFF" stroke-width="8" stroke-linejoin="round"/></g>`;
const svg = (fundo, escala) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">${DEFS}${fundo}<g transform="translate(256 256) scale(${escala || 1}) translate(-256 -256)">${MARCA}</g></svg>`);
const QUADRADO = '<rect width="512" height="512" rx="116" fill="url(#bg)"/>';
const CHEIO = '<rect width="512" height="512" fill="url(#bg)"/>';
const CIRCULO = '<circle cx="256" cy="256" r="256" fill="url(#bg)"/>';
const D = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const png = (buf, lado) => sharp(buf, { density: 300 }).resize(lado, lado).png();
(async () => {
  // aplicativo Android
  for (const [k, f] of Object.entries(D)){
    const dir = path.join(RES, 'mipmap-' + k), L = Math.round(48 * f), A = Math.round(108 * f);
    await png(svg(QUADRADO), L).toFile(path.join(dir, 'ic_launcher.png'));
    await png(svg(CIRCULO, .92), L).toFile(path.join(dir, 'ic_launcher_round.png'));
    // ícone adaptável: o desenho dentro da área segura (66 de 108), sem fundo (a cor vem de ic_launcher_background)
    await png(svg('', .62), A).toFile(path.join(dir, 'ic_launcher_foreground.png'));
  }
  fs.writeFileSync(path.join(RES, 'values/ic_launcher_background.xml'), `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${FUNDO}</color>\n</resources>\n`);
  // nome do aplicativo na tela de abertura
  const NOME = process.env.NOME_APP || 'Luz de Volta';
  // tela de abertura: fundo escuro com o raio no meio e o nome embaixo
  for (const p of fs.readdirSync(RES).filter(n => n.startsWith('drawable'))){
    const arq = path.join(RES, p, 'splash.png'); if (!fs.existsSync(arq)) continue;
    const { width, height } = await sharp(arq).metadata();
    const lado = Math.round(Math.min(width, height) * 0.42);
    const marca = await png(svg(''), lado).toBuffer();
    const fs1 = Math.round(Math.min(width, height) * 0.06), fs2 = Math.round(fs1 * 0.5);
    const texto = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${fs1 * 3}"><text x="50%" y="${fs1 * 1.1}" font-family="Segoe UI, Arial, sans-serif" font-size="${fs1}" font-weight="700" fill="#ffffff" text-anchor="middle">${NOME}</text><text x="50%" y="${fs1 * 1.1 + fs2 * 1.9}" font-family="Segoe UI, Arial, sans-serif" font-size="${fs2}" fill="#9aa0ad" text-anchor="middle">Rodrigues Litaiff Advogados</text></svg>`);
    const fundo = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${DEFS}<rect width="${width}" height="${height}" fill="url(#bg)"/></svg>`);
    const topo = Math.round(height / 2 - lado * 0.62);
    const buf = await sharp(fundo).composite([{ input: marca, left: Math.round((width - lado) / 2), top: topo }, { input: texto, left: 0, top: topo + lado + Math.round(fs1 * 0.2) }]).png().toBuffer();
    fs.writeFileSync(arq, buf);
  }
  // aplicativo pelo navegador e imagem usada dentro do app
  await png(svg(CHEIO), 180).toFile(path.join(IMG, 'icone-180.png'));
  await png(svg(QUADRADO), 192).toFile(path.join(IMG, 'icone-192.png'));
  await png(svg(QUADRADO), 512).toFile(path.join(IMG, 'icone-512.png'));
  await png(svg(CHEIO, .8), 512).toFile(path.join(IMG, 'icone-512-mask.png'));
  await png(svg(QUADRADO), 256).toFile(path.join(IMG, 'icone-energia.png'));
  console.log('ícones ok');
})();
