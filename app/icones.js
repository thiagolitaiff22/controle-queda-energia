// Gera o ícone e a tela de abertura do aplicativo a partir do desenho da câmera (campo-icone.svg)
const sharp = require('sharp'), fs = require('fs'), path = require('path');
const RES = path.join(__dirname, 'android/app/src/main/res');
const VERDE = '#16a34a';
const glifo = '<path d="M30 34h8l4-6h12l4 6h8a4 4 0 0 1 4 4v26a4 4 0 0 1-4 4H30a4 4 0 0 1-4-4V38a4 4 0 0 1 4-4z" fill="none" stroke="#fff" stroke-width="5" stroke-linejoin="round"/><circle cx="48" cy="51" r="9" fill="none" stroke="#fff" stroke-width="5"/>';
const completo = Buffer.from(fs.readFileSync(path.join(__dirname, '../campo-icone.svg'), 'utf8'));
const redondo = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><circle cx="48" cy="48" r="48" fill="${VERDE}"/>${glifo}</svg>`);
// ícone adaptável: o desenho ocupa a área segura (66 de 108)
const frente = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="-21 -21 138 138">${glifo}</svg>`);
const D = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
(async () => {
  for (const [k, f] of Object.entries(D)){
    const dir = path.join(RES, 'mipmap-' + k);
    await sharp(completo, { density: 600 }).resize(Math.round(48 * f), Math.round(48 * f)).png().toFile(path.join(dir, 'ic_launcher.png'));
    await sharp(redondo, { density: 600 }).resize(Math.round(48 * f), Math.round(48 * f)).png().toFile(path.join(dir, 'ic_launcher_round.png'));
    await sharp(frente, { density: 600 }).resize(Math.round(108 * f), Math.round(108 * f)).png().toFile(path.join(dir, 'ic_launcher_foreground.png'));
  }
  fs.writeFileSync(path.join(RES, 'values/ic_launcher_background.xml'), `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${VERDE}</color>\n</resources>\n`);
  // tela de abertura: fundo escuro com o ícone no meio
  const pastas = fs.readdirSync(RES).filter(n => n.startsWith('drawable'));
  for (const p of pastas){
    const arq = path.join(RES, p, 'splash.png'); if (!fs.existsSync(arq)) continue;
    const { width, height } = await sharp(arq).metadata();
    const lado = Math.round(Math.min(width, height) * 0.28);
    const ic = await sharp(completo, { density: 600 }).resize(lado, lado).png().toBuffer();
    const buf = await sharp({ create: { width, height, channels: 4, background: '#0b0b0c' } }).composite([{ input: ic, gravity: 'center' }]).png().toBuffer();
    fs.writeFileSync(arq, buf);
  }
  console.log('ícones ok');
})();
