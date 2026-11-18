// Testes de regressão do LE Pocket. Uso: node tests/run-all.js
// Usam só programas de teste próprios (tests/fixtures, fontes em tests/fixtures-src). Nenhum jogo comercial.
'use strict';
const fs = require('fs'), path = require('path');
const C = (f) => require(path.join(__dirname, '..', 'src', 'cores', f));
const { GB } = C('gbcore.js'), { GBA } = C('gba.js'), { NDS } = C('nds.js');
const fx = (n) => new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', n)));
const hex = (v) => (v >>> 0).toString(16);
let pass = 0, failN = 0, group = '';
function check(name, got, exp) {
  const ok = typeof exp === 'function' ? exp(got) : got === exp;
  if (ok) pass++; else failN++;
  console.log(`${ok ? 'ok   ' : 'FALHA'} ${group} · ${name}: ${typeof got === 'number' ? got + ' (0x' + hex(got) + ')' : got}${ok || typeof exp === 'function' ? '' : ' — esperado ' + exp}`);
}
function section(n, fn) { group = n; try { fn(); } catch (e) { failN++; console.log(`FALHA ${n} · exceção: ${e.stack}`); } }

section('GB CPU', () => {
  const rom = new Uint8Array(0x8000); let p = 0x100; const put = (...b) => { for (const x of b) rom[p++] = x; };
  put(0xC3, 0x50, 0x01); 'TESTE'.split('').forEach((c, i) => { rom[0x134 + i] = c.charCodeAt(0); });
  p = 0x150;
  put(0x31, 0xFE, 0xFF, 0x3E, 0x15, 0xC6, 0x27, 0x27, 0xEA, 0x00, 0xC0);                 // DAA
  put(0x21, 0x34, 0x12, 0x01, 0xFF, 0x0F, 0x09, 0x7C, 0xEA, 0x01, 0xC0, 0x7D, 0xEA, 0x02, 0xC0); // ADD HL
  put(0xF5, 0xC1, 0x79, 0xEA, 0x03, 0xC0, 0x06, 0x0A);
  const loop = p; put(0xCD, 0x00, 0x02); put(0x05, 0x20, (loop - (p + 3)) & 0xFF);   // CALL x10
  put(0x21, 0x10, 0x80, 0x0E, 0x10, 0x3E, 0xFF); const l2 = p; put(0x22, 0x0D, 0x20, (l2 - (p + 4)) & 0xFF);
  put(0x3E, 0x01, 0xEA, 0x00, 0x98, 0x3E, 0x81, 0xCB, 0x07, 0xCB, 0x37, 0xEA, 0x05, 0xC0); // RLC, SWAP
  put(0x3E, 0x10, 0x37, 0xDE, 0x05, 0xEA, 0x06, 0xC0, 0x3E, 0x01, 0xE0, 0xFF, 0xFB);     // SBC, IE
  const hl = p; put(0x76, 0x00, 0x18, (hl - (p + 4)) & 0xFF);
  p = 0x200; put(0xFA, 0x04, 0xC0, 0x3C, 0xEA, 0x04, 0xC0, 0xC9);
  p = 0x40; put(0xF5, 0xF0, 0x80, 0x3C, 0xE0, 0x80, 0xF1, 0xD9);
  const gb = new GB(rom); for (let i = 0; i < 10; i++) gb.runFrame();
  check('DAA', gb.rb(0xC000), 0x42); check('ADD HL alto', gb.rb(0xC001), 0x22); check('ADD HL baixo', gb.rb(0xC002), 0x33);
  check('flags após ADD HL', gb.rb(0xC003), 0x20); check('CALL/RET x10', gb.rb(0xC004), 10); check('RLC+SWAP', gb.rb(0xC005), 0x30);
  check('SBC', gb.rb(0xC006), 0x0A); check('interrupções VBlank', gb.rb(0xFF80), (v) => v >= 9 && v <= 10);
  check('pixel do tile', gb.out[0], gb.shades[3]);
});
section('GB cartuchos', () => {
  for (const [type, name, banks] of [[0x01, 'MBC1', 31], [0x13, 'MBC3', 63], [0x1B, 'MBC5', 63]]) {
    const rom = new Uint8Array(0x4000 * 64); for (let b = 0; b < 64; b++) rom[b * 0x4000 + 0x10] = b;
    rom[0x147] = type; rom[0x149] = 3; rom[0x143] = 0x80;
    const gb = new GB(rom); let ok = true;
    for (let b = 1; b <= banks; b++) { gb.wb(0x2000, b); if (gb.rb(0x4010) !== b) ok = false; }
    check(name + ' troca de banco', ok, true);
    gb.wb(0x0000, 0x0A); gb.wb(0x4000, 2); gb.wb(0xA000, 0x77); gb.wb(0x4000, 0);
    check(name + ' RAM banco 0 depois de gravar no 2', gb.rb(0xA000), type === 0x01 ? 0x77 : 0);
  }
  const rom = new Uint8Array(0x8000); rom[0x143] = 0xC0; const gb = new GB(rom);
  gb.wb(0xFF68, 0x80); gb.wb(0xFF69, 0x1F); gb.wb(0xFF69, 0x00); gb.wb(0xFF6A, 0x82); gb.wb(0xFF6B, 0xE0); gb.wb(0xFF6B, 0x03);
  for (let i = 0; i < 16; i += 2) gb.vram[0x20 + i] = 0xFF;
  gb.oam[0] = 16; gb.oam[1] = 12; gb.oam[2] = 2; gb.oam[3] = 0; gb.lcdc = 0x93; gb.ly = 0; gb.renderLine();
  check('GBC paleta de fundo (vermelho)', gb.fb[0], (v) => (v & 0xFF) > 0xC0 && ((v >> 16) & 0xFF) < 0x40);
  check('GBC sprite (verde)', gb.fb[4], (v) => ((v >> 8) & 0xFF) > 0xA0);
  const s = JSON.parse(JSON.stringify(gb.saveState())); gb.pc = 0x1234; gb.loadState(s); check('save state restaura PC', gb.pc, 0x100);
});
section('GB demo', () => {
  const gb = new GB(fx('gb-demo.gb')); for (let i = 0; i < 5; i++) gb.runFrame();
  const x0 = gb.oam[1]; gb.press(0, true); for (let i = 0; i < 10; i++) gb.runFrame(); gb.press(0, false);
  check('sprite anda para a direita', gb.oam[1] - x0, (d) => d >= 8);
  gb.press(4, true); for (let i = 0; i < 3; i++) gb.runFrame();
  check('save de bateria gravado', gb.cart.ram[0] > 0 && gb.cart.dirty, true);
});
section('GBA CPU', () => {
  for (const n of ['arm_O0', 'arm_O2', 'arm_Os', 'th_O0', 'th_O2', 'th_Os']) {
    const g = new GBA(fx(`gba-cpu-${n}.gba`)); let f = 0;
    while (g.read32(0x02000004) !== 0xC0FFEE && f < 400) { g.runFrame(); f++; }
    check(n + ' (igual ao computador)', g.read32(0x02000000) >>> 0, n.startsWith('arm') ? 0x1ee60b58 : 0xe0947876);
  }
});
section('GBA hardware', () => {
  const g = new GBA(fx('gba-hw.gba')); let f = 0; while (g.read32(0x02000004) !== 0xC0FFEE && f < 300) { g.runFrame(); f++; }
  const exp = [[0, 6], [0xffffffff, 0xa], [0x80000001, 8], [0, 6], [0, 4], [0x80000000, 0xa], [0x80000000, 8], [0, 6], [0x80000000, 9], [0xfffffffe, 8], [0, 6], [0x00030201], [0xffffff80], [0xfffff00f], [0xf00f], [12], [0x22], [0x332211], [0], [0x332211], [0xaa55], [0], [0x1000, 0], [0xffffffff], [0xd], [0x407], [0xc]];
  let bad = 0; exp.forEach((e, i) => { const v = g.read32(0x02000400 + i * 8) >>> 0, fl = g.read32(0x02000404 + i * 8) >>> 0; if (v !== e[0] || (e.length > 1 && fl !== e[1])) bad++; });
  check('27 casos de borda (deslocamentos, flags, LDM/STM, SWP, modos, multiplicação longa, Thumb)', bad, 0);
  const R = (i) => g.read32(0x02000000 + (32 + i) * 4) >>> 0;
  check('BIOS Div', R(0), 14); check('BIOS Div negativo', R(1), (-14) >>> 0); check('BIOS Sqrt', R(2), 1000);
  check('BIOS CpuSet cópia', R(3), 0x10101010); check('BIOS CpuSet preenche', R(4), 0x0D0D0D0D); check('BIOS LZ77', R(5), 0x44434241);
  check('VBlankIntrWait x5', R(6), 5); check('VCOUNT depois da espera', R(7), 160); check('timer /64 em um quadro', R(8), (v) => Math.abs(v - 4389) <= 2);
  check('timers em cascata (IRQs/quadro)', R(9), (v) => Math.abs(v - 548) <= 2); check('DMA cópia', R(10), 0x09090D09); check('DMA fonte fixa', R(11), 0x0B0B0B0B);
  check('SRAM', R(12), 0x5A); check('teclas soltas', R(13), 0x3FF);
});
section('GBA vídeo, som e estados', () => {
  const g = new GBA(fx('gba-demo.gba'));
  const run = (n) => { let mx = 0, sum = 0, cnt = 0, zc = 0, prev = 0; for (let i = 0; i < n; i++) { g.audioLen = 0; g.runFrame(); for (let k = 0; k < g.audioLen; k += 2) { const v = g.audioBuf[k]; mx = Math.max(mx, Math.abs(v)); sum += v; cnt++; if ((prev < 0) !== (v < 0)) zc++; prev = v; } } return { mx, mean: sum / Math.max(1, cnt), zc, cnt }; };
  run(40);
  check('imagem desenhada (modo 0 + sprites)', new Set(g.out).size, (v) => v > 5);
  g.press(4, true); g.runFrame(); g.press(4, false); let a = run(10);
  check('som PSG toca', a.mx, (v) => v > 0.03 && v < 0.98); check('som PSG frequência', a.zc, (v) => Math.abs(v - 147) < 20);
  run(60); g.press(5, true); g.runFrame(); g.press(5, false); a = run(10);
  check('som direto (DMA) toca', a.mx, (v) => v > 0.2 && v < 0.98); check('som direto frequência', a.zc, (v) => Math.abs(v - 86) < 12);
  check('som sem nível contínuo', Math.abs(a.mean), (v) => v < 0.02); check('amostras por quadro', a.cnt / 10, (v) => Math.abs(v - 548.6) < 3);
  const st = g.saveState(); const pc = g.r[15]; for (let i = 0; i < 5; i++) g.runFrame(); g.loadState(st); check('save state restaura PC', g.r[15], pc);
});
section('DS dois processadores', () => {
  const g = new NDS(fx('nds-test.nds')); const O = (i) => g.ram.w[(0x300000 >> 2) + i] >>> 0;
  let f = 0; while (O(1) !== 0xC0FFEE && f < 600) { g.runFrame(); f++; }
  const exp = { 0: [0x1ee60b58, 'CPU ARM9 igual ao computador'], 2: [126, 'troca ARM/Thumb'], 3: [(-14) >>> 0, 'divisor de hardware'], 4: [(-2) >>> 0, 'resto do divisor'], 5: [1000, 'raiz de hardware'], 6: [30, 'BIOS Div'], 7: [15, 'CLZ'], 8: [3, 'VBlank x3'], 9: [[...Array(0x80).keys()].reduce((s, i) => s + i * 3 + 1, 0), 'leitura do cartucho (soma)'], 10: [0x80, 'leitura do cartucho (palavras)'] };
  for (const k in exp) check(exp[k][1], O(+k), exp[k][0]);
  for (let i = 0; i < 5; i++) g.runFrame();
  check('firmware lido pelo ARM7', O(20), (v) => (v >>> 31) === 1);
  g.touch(100, 50, true); for (let i = 0; i < 4; i++) g.runFrame(); check('tela de toque', O(21), 0x13264);
  g.press(4, true); for (let i = 0; i < 2; i++) g.runFrame(); check('botão A', O(22) & 0xFFFF, 0x3FE);
});
section('DS 3D e captura', () => {
  const g = new NDS(fx('nds-test.nds')); for (let i = 0; i < 12; i++) g.runFrame();
  const W = (a, v) => g.w32(0, a >>> 0, v | 0), F = (v) => Math.round(v * 4096) | 0;
  g.w8(0, 0x04000243, 0x80); g.w8(0, 0x04000245, 0x80);
  for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) { const c0 = ((x * 2 ^ y) & 1) ? 1 : 2, c1 = (((x * 2 + 1) ^ y) & 1) ? 1 : 2; g.w8(0, 0x06860000 + y * 4 + x, c0 | (c1 << 4)); }
  g.w16(0, 0x06890002, 0x7FFF); g.w16(0, 0x06890004, 0x001F); g.w8(0, 0x04000243, 0x83); g.w8(0, 0x04000245, 0x83);
  W(0x04000000, 0x00010108); g.w16(0, 0x04000060, 0x0009); W(0x04000350, 0x001F0000 | (4 << 10)); W(0x04000580, (191 << 24) | (255 << 16));
  W(0x04000440, 0); W(0x04000454, 0); W(0x04000440, 2); W(0x04000454, 0);
  W(0x04000400, 0x1B1C); [F(-0.1), 0, 0, F(0.9), F(0.9), F(1)].forEach((v) => W(0x04000400, v));
  const vtx = (x, y, z) => { W(0x0400048C, (F(x) & 0xFFFF) | (F(y) << 16)); W(0x0400048C, F(z) & 0xFFFF); };
  W(0x040004A4, (31 << 16) | 0xC0); W(0x040004A8, 0); W(0x04000500, 0);
  W(0x04000480, 0x001F); vtx(-0.8, -0.6, 0.2); W(0x04000480, 0x03E0); vtx(0.2, -0.6, 0.2); W(0x04000480, 0x7C00); vtx(-0.3, 0.8, 0.2); W(0x04000504, 0);
  W(0x040004A8, (3 << 26) | (1 << 16) | (1 << 17)); W(0x040004AC, 0); W(0x04000480, 0x7FFF); W(0x04000500, 1);
  const tc = (s, t) => W(0x04000488, ((s * 16) & 0xFFFF) | ((t * 16) << 16));
  tc(0, 0); vtx(0.1, 0.5, -0.2); tc(0, 32); vtx(0.1, -0.3, -0.2); tc(32, 32); vtx(0.9, -0.3, -0.2); tc(32, 0); vtx(0.9, 0.5, -0.2); W(0x04000504, 0);
  check('polígonos na fila', g.g.polys.length, 2);
  check('matriz de recorte lida', Math.round(g.r32(0, 0x04000640) / 4096 * 1000), 900);
  W(0x04000540, 0); for (let i = 0; i < 3; i++) g.runFrame();
  const px = (x, y) => g.out[y * 256 + x] >>> 0;
  check('textura (pixel vermelho)', px(160, 60), 0xff0000ff); check('textura (pixel branco)', px(168, 64), 0xffffffff);
  check('degradê do triângulo', new Set([px(60, 120), px(90, 100), px(80, 60)]).size, 3);
  g.w8(0, 0x04000241, 0x80); W(0x04000064, 0x80000000 | (1 << 16) | (3 << 20)); W(0x04000540, 0); g.runFrame(); g.runFrame();
  check('captura termina', g.r32(0, 0x04000064) >>> 31, 0); check('captura grava a cena', g.vram.h[(0x20000 + (60 * 256 + 160) * 2) >> 1], 0x801F);
  const L = []; const pk = (ops, params) => { L.push(ops.reduce((a, o, i) => a | (o << (8 * i)), 0) >>> 0); L.push(...params); };
  pk([0x10, 0x15], [2]); pk([0x29, 0x2A, 0x40], [(31 << 16) | 0xC0, 0, 0]); pk([0x20, 0x23], [0x7C00, (F(-0.5) & 0xFFFF) | (F(-0.5) << 16), 0]);
  pk([0x20, 0x23], [0x03E0, (F(0.5) & 0xFFFF) | (F(-0.5) << 16), 0]); pk([0x20, 0x23, 0x41], [0x001F, (F(0) & 0xFFFF) | (F(0.6) << 16), 0]); pk([0x50], [0]);
  L.forEach((v, i) => { g.ram.w[(0x250000 >> 2) + i] = v; });
  W(0x040000B0, 0x02250000); W(0x040000B4, 0x04000400); W(0x040000B8, 0x80000000 | (7 << 27) | (1 << 26) | (2 << 21) | L.length);
  check('DMA da fila 3D termina', g.r32(0, 0x040000B8) >>> 31, 0); check('DMA da fila 3D entrega o polígono', g.g.polys.length, 1);
  g.runFrame(); const before = g.out[100 * 256 + 128]; g.skipDraw = true; g.runFrame(); g.skipDraw = false;
  check('pular quadro mantém a imagem', g.out[100 * 256 + 128], before);
});
section('DS 3D sombreamento', () => {
  const g = new NDS(fx('nds-test.nds')); for (let i = 0; i < 12; i++) g.runFrame();
  const W = (a, v) => g.w32(0, a >>> 0, v | 0), F = (v) => Math.round(v * 4096) | 0;
  W(0x04000000, 0x00010108); W(0x04000350, 0x001F0000); W(0x04000580, (191 << 24) | (255 << 16));
  W(0x04000440, 0); W(0x04000454, 0); W(0x04000440, 2); W(0x04000454, 0);
  for (let i = 0; i < 32; i++) g.w16(0, 0x04000380 + i * 2, i === 5 ? 0x03E0 : 0x001F); // tabela: índice 5 = verde
  const vtx = (x, y) => { W(0x0400048C, (F(x) & 0xFFFF) | (F(y) << 16)); W(0x0400048C, 0); };
  const quad = (mode, color) => { W(0x040004A4, (31 << 16) | 0xC0 | (mode << 4)); W(0x040004A8, 0); W(0x04000500, 1); W(0x04000480, color); vtx(-0.5, 0.5); vtx(-0.5, -0.5); vtx(0.5, -0.5); vtx(0.5, 0.5); W(0x04000504, 0); W(0x04000540, 0); g.runFrame(); g.runFrame(); return g.out[96 * 256 + 128] >>> 0; };
  g.w16(0, 0x04000060, 0); check('toon: cor vem da tabela (verde)', quad(2, 5), 0xff00ff00);
  g.w16(0, 0x04000060, 2); check('highlight: cinza da cor + tabela', quad(2, 5), (v) => ((v >> 8) & 0xFF) === 0xFF && (v & 0xFF) > 0x20 && (v & 0xFF) < 0x40);
  g.w16(0, 0x04000060, 0); check('modulação normal mantém a cor do vértice', quad(0, 0x7FFF), 0xffffffff);
  // sombra: polígono de sombra (modo 3) sem máscara não escurece o personagem
  const poly = (attr, color, z) => { W(0x040004A4, attr); W(0x040004A8, 0); W(0x04000500, 1); W(0x04000480, color); const v = (x, y) => { W(0x0400048C, (F(x) & 0xFFFF) | (F(y) << 16)); W(0x0400048C, F(z) & 0xFFFF); }; v(-0.5, 0.5); v(-0.5, -0.5); v(0.5, -0.5); v(0.5, 0.5); W(0x04000504, 0); };
  poly((31 << 16) | 0xC0 | (1 << 24), 0x7FFF, 0); poly((20 << 16) | 0xC0 | 0x30 | (2 << 24), 0, -0.1); W(0x04000540, 0); g.runFrame(); g.runFrame();
  check('sombra sem máscara não pinta de preto', g.out[96 * 256 + 128] >>> 0, 0xffffffff);
  g.w16(0, 0x04000060, 8); poly((31 << 16) | 0xC0 | (1 << 24), 0x7FFF, 0); poly((20 << 16) | 0xC0 | 0x30, 0, 0.2); poly((20 << 16) | 0xC0 | 0x30 | (2 << 24), 0, -0.1); W(0x04000540, 0); g.runFrame(); g.runFrame();
  check('sombra com máscara escurece o chão', g.out[96 * 256 + 128] >>> 0, (v) => v !== 0xffffffff && ((v >>> 0) & 0xFF) > 0x40);
  // portas diretas não bagunçam um comando compactado pela metade
  W(0x04000440, 1); W(0x04000400, 0x16); for (let i = 0; i < 8; i++) W(0x04000400, (i % 5 === 0) ? 4096 : 0); W(0x04000480, 0x7FFF); for (let i = 8; i < 16; i++) W(0x04000400, (i % 5 === 0) ? 4096 : 0);
  check('matriz compactada intacta com escrita direta no meio', Array.from(g.g.pos).join(','), '1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1'); W(0x04000440, 2);
  g.w16(0, 0x04000060, 0);
  // 3D por cima com mistura ligada (EVA=EVB=0): usa o alfa do 3D, não fica preto
  g.w16(0, 0x04000050, 0x2041); g.w16(0, 0x04000052, 0); check('3D com mistura 2D não vira preto', quad(0, 0x7FFF), 0xffffffff); g.w16(0, 0x04000050, 0);
  // a porta compactada ocupa 0x4000400..0x400043F (cópia com endereço subindo, como stmia)
  { W(0x04000440, 1); const words = [0x15 | (0x1B << 8), F(2), F(3), F(4)]; words.forEach((w, i) => W(0x04000400 + i * 4, w));
    check('porta compactada nos endereços espelhados', [g.g.pos[0], g.g.pos[5], g.g.pos[10]].join(','), '2,3,4'); W(0x04000440, 2); }
  // coordenada de textura vinda da matriz de textura (modo 1): translação de 8 texels = 128 em 1/16 de texel
  W(0x04000440, 3); W(0x04000454, 0); W(0x04000470, 0); W(0x04000470, 0); W(0x04000470, 0); // MTX_TRANS zero
  W(0x04000440, 3); W(0x04000454, 0); W(0x04000470, F(128)); W(0x04000470, 0); W(0x04000470, 0); W(0x04000440, 2);
  W(0x040004A8, (1 << 30)); W(0x04000488, 0); check('texcoord pela matriz (modo 1) em texels', g.g.s, 8);
});
section('DS salvar estado', () => {
  const g = new NDS(fx('nds-test.nds')); for (let i = 0; i < 40; i++) g.runFrame();
  const st = g.saveState(); const ram = g.ram.b.slice(0, 0x100000), pc9 = g.cpu[0].r[15], pc7 = g.cpu[1].r[15], vc = g.dFrame;
  g.touch(10, 10, true); for (let i = 0; i < 30; i++) g.runFrame(); g.ram.b[123] ^= 0xFF;
  g.loadState(st);
  check('estado restaura o ARM9', g.cpu[0].r[15], pc9); check('estado restaura o ARM7', g.cpu[1].r[15], pc7);
  let same = true; for (let i = 0; i < ram.length; i++) if (g.ram.b[i] !== ram[i]) { same = false; break; } check('estado restaura a memória', same, true);
  const h = new NDS(fx('nds-test.nds')); h.loadState(st);
  for (let i = 0; i < 20; i++) { g.runFrame(); h.runFrame(); }
  let eq = true; for (let i = 0; i < g.out.length; i++) if (g.out[i] !== h.out[i]) { eq = false; break; }
  check('continuar do estado dá o mesmo resultado em outra cópia', eq && g.cpu[0].r[15] === h.cpu[0].r[15], true);
});
section('DS cartucho e save', () => {
  const g = new NDS(fx('nds-test.nds')); for (let i = 0; i < 15; i++) g.runFrame();
  const W = (a, v) => g.w32(0, a >>> 0, v | 0);
  W(0x040000B0, 0x04100010); W(0x040000B4, 0x02200000); W(0x040000B8, 0x80000000 | (5 << 27) | (1 << 26) | (1 << 25) | (2 << 23) | 1);
  W(0x040001A8, 0x800000B7); W(0x040001AC, 0); W(0x040001A4, 0xA1000000);
  let s = 0; for (let i = 0; i < 0x80; i++) s += g.ram.w[(0x200000 >> 2) + i];
  check('DMA do cartucho palavra a palavra', s, 0x5FC0); check('cartucho livre depois', g.romctrl >>> 31, 0);
  const rom = new Uint8Array(0x8200); rom[0x0C] = 0x49; const h = new NDS(rom);
  const w = (v, hold) => { h.auxspicnt = hold ? 0x40 : 0; h.auxSpiWrite(v); return h.auxspidata; };
  w(8, 1); check('chip infravermelho responde', w(0, 0), 0xAA);
  w(0, 1); w(6, 0); w(0, 1); w(5, 1); check('flash pronto para gravar', w(0, 0), 2);
  w(0, 1); w(0x0A, 1); w(0, 1); w(1, 1); w(0, 1); w(0x12, 1); w(0x34, 0);
  w(0, 1); w(3, 1); w(0, 1); w(1, 1); w(0, 1); check('flash grava e lê', (w(0, 1) << 8) | w(0, 0), 0x1234);
});
section('DS som', () => {
  const g = new NDS(fx('nds-test.nds')); for (let i = 0; i < 10; i++) g.runFrame();
  const W = (a, v) => g.w32(1, a >>> 0, v | 0), N = 3520;
  for (let i = 0; i < N; i++) g.ram.b[0x100000 + i] = Math.round(Math.sin(i / 32 * 2 * Math.PI) * 100) & 0xFF;
  W(0x04000500, 0x807F); W(0x04000404, 0x02100000); g.w16(1, 0x04000408, (0x10000 - Math.round(16756991 / 14080)) & 0xFFFF); g.w16(1, 0x0400040A, 0); W(0x0400040C, N / 4);
  W(0x04000400, 0x80000000 | (2 << 27) | (64 << 16) | 127);
  let zc = 0, pk = 0, prev = 0, frames = 0;
  while ((g.r32(1, 0x04000400) >>> 31) && frames < 60) { g.audioLen = 0; g.runFrame(); frames++; for (let k = 0; k < g.audioLen; k += 2) { const v = g.audioBuf[k]; if ((prev < 0) !== (v < 0)) zc++; prev = v; pk = Math.max(pk, Math.abs(v)); } }
  check('som de um disparo avisa que terminou', frames, (v) => v >= 14 && v <= 16); check('frequência de 440 Hz', zc, (v) => Math.abs(v - 220) <= 4); check('volume', pk, (v) => v > 0.1 && v < 0.98);
  const r = g.cpu[1].r; const sw = (n, a) => { r[0] = a; g.swi(1, g.cpu[1], n); return r[0] >>> 0; };
  check('BIOS tabela de volume (0 dB)', sw(0x1C, 723), 127); check('BIOS tabela de tom (oitava)', sw(0x1B, 767), (v) => v > 0xFF00);
});
console.log(`\n${pass} testes passaram, ${failN} falharam`);
process.exit(failN ? 1 : 0);
