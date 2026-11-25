// ===== Nintendo 3DS — fase inicial (esqueleto) =====
// O que já faz: lê o cabeçalho do cartucho (.3ds/.cci NCSD ou .cxi NCCH), descobre se está criptografado,
// lê o ExHeader e o ExeFS (quando o arquivo está descriptografado), descompacta o código (BLZ),
// coloca o código na memória virtual do aplicativo e roda os primeiros passos no processador ARM11
// (instruções ARMv6 mais comuns), registrando as chamadas ao sistema (SVC).
// Ainda não tem: GPU PICA200, serviços do sistema operacional, som, entrada. Os jogos ainda não aparecem.
// Não há chaves de console aqui: arquivos criptografados só são identificados.

const N3DS_W = 400, N3DS_H = 480; // tela de cima 400x240 + de baixo 320x240 (centralizada)

// fonte 5x7 (só os caracteres usados na tela de informações)
const N3DS_FONT = (() => {
  const g = {
    ' ': '00000000000000000000000000000000000', '0': '01110100011001110101110011000101110', '1': '00100011000010000100001000010001110',
    '2': '01110100010000100010001000100011111', '3': '11110000010000101110000010000111110', '4': '00010001100101010010111110001000010',
    '5': '11111100001111000001000011000101110', '6': '00110010001000011110100011000101110', '7': '11111000010001000100010000100001000',
    '8': '01110100011000101110100011000101110', '9': '01110100011000101111000010001001100', 'A': '01110100011000111111100011000110001',
    'B': '11110100011000111110100011000111110', 'C': '01110100011000010000100001000101110', 'D': '11100100101000110001100011001011100',
    'E': '11111100001000011110100001000011111', 'F': '11111100001000011110100001000010000', 'G': '01110100011000010111100011000101111',
    'H': '10001100011000111111100011000110001', 'I': '01110001000010000100001000010001110', 'J': '00111000100001000010000101001001100',
    'K': '10001100101010011000101001001010001', 'L': '10000100001000010000100001000011111', 'M': '10001110111010110101100011000110001',
    'N': '10001100011100110101100111000110001', 'O': '01110100011000110001100011000101110', 'P': '11110100011000111110100001000010000',
    'Q': '01110100011000110001101011001001101', 'R': '11110100011000111110101001001010001', 'S': '01111100001000001110000010000111110',
    'T': '11111001000010000100001000010000100', 'U': '10001100011000110001100011000101110', 'V': '10001100011000110001100010101000100',
    'W': '10001100011000110101101011010101010', 'X': '10001100010101000100010101000110001', 'Y': '10001100011000101010001000010000100',
    'Z': '11111000010001000100010001000011111', ':': '00000011000110000000011000110000000', '.': '00000000000000000000000000110001100',
    '-': '00000000000000011111000000000000000', '/': '00001000010001000100010001000010000', '(': '00010001000100001000010000010000010',
    ')': '01000001000001000010000100010001000', '%': '11000110010001000100010001001100011', '+': '00000001000010011111001000010000000',
    '_': '00000000000000000000000000000011111', '!': '00100001000010000100001000000000100', ',': '00000000000000000000001100010001000',
    '?': '01110100010000100010001000000000100', '=': '00000000001111100000111110000000000', '>': '01000001000001000001000100010001000',
  };
  return g;
})();

class N3DS {
  constructor(rom) {
    this.rom = rom; this.sys = '3ds'; this.width = N3DS_W; this.height = N3DS_H;
    this.out = new Uint32Array(N3DS_W * N3DS_H); this.hasSave = false; this.saveDirty = false;
    this.audioBuf = new Float32Array(4096); this.audioLen = 0; this.audioRate = 32768;
    this.dv = new DataView(rom.buffer, rom.byteOffset, rom.byteLength);
    this.info = this.parse();
    this.title = this.info.code || this.info.name || '3DS';
    this.mem = new N3DSMem(); this.svcLog = []; this.svcCount = new Map(); this.steps = 0; this.stopped = ''; this.frame = 0;
    this.cpu = null;
    if (this.info.codeBin) this.boot();
    this.drawInfo();
  }

  // ---------- cabeçalhos ----------
  u32(o) { return o + 4 <= this.rom.length ? this.dv.getUint32(o, true) : 0; }
  str(o, n) { let s = ''; for (let i = 0; i < n && o + i < this.rom.length; i++) { const c = this.rom[o + i]; if (!c) break; s += c >= 32 && c < 127 ? String.fromCharCode(c) : '?'; } return s; }
  parse() {
    const r = this.rom, info = { kind: '?', encrypted: false, problems: [] };
    const magic = (o) => this.str(o + 0x100, 4);
    let ncch = -1;
    if (magic(0) === 'NCSD') { info.kind = 'NCSD (.3ds/.cci)'; const off = this.u32(0x120) * 0x200; if (magic(off) === 'NCCH') ncch = off; }
    else if (magic(0) === 'NCCH') { info.kind = 'NCCH (.cxi)'; ncch = 0; }
    else if (this.u32(0) === 0x2020) { info.kind = 'CIA'; info.problems.push('arquivo .cia: instale e exporte como .3ds/.cxi'); return info; }
    if (ncch < 0) { info.problems.push('cabeçalho NCCH não encontrado'); return info; }
    info.ncch = ncch;
    info.code = this.str(ncch + 0x150, 16);
    info.programId = this.u32(ncch + 0x11C).toString(16).toUpperCase().padStart(8, '0') + this.u32(ncch + 0x118).toString(16).toUpperCase().padStart(8, '0');
    const flags7 = r[ncch + 0x18F], flags3 = r[ncch + 0x18B];
    info.encrypted = !(flags7 & 4);
    info.isApp = (flags3 & 2) !== 0; // executável
    const exhSize = this.u32(ncch + 0x180), exefsOff = this.u32(ncch + 0x1A0) * 0x200, exefsSize = this.u32(ncch + 0x1A4) * 0x200;
    info.exefs = exefsOff ? ncch + exefsOff : 0;
    if (info.encrypted) { info.problems.push('criptografado: precisa de cópia descriptografada do seu console'); return info; }
    if (exhSize >= 0x400) {
      const e = ncch + 0x200;
      info.name = this.str(e, 8);
      info.compressed = (r[e + 0xD] & 1) !== 0;
      const seg = (o) => ({ addr: this.u32(e + o), pages: this.u32(e + o + 4), size: this.u32(e + o + 8) });
      info.text = seg(0x10); info.ro = seg(0x20); info.data = seg(0x30);
      info.stack = this.u32(e + 0x1C); info.bss = this.u32(e + 0x3C);
    }
    if (info.exefs && exefsSize) {
      for (let i = 0; i < 10; i++) {
        const h = info.exefs + i * 16, name = this.str(h, 8), off = this.u32(h + 8), size = this.u32(h + 12);
        if (!name) continue;
        const start = info.exefs + 0x200 + off;
        if (name === '.code') info.codeBin = r.subarray(start, start + size);
        if (name === 'icon') info.icon = r.subarray(start, start + size);
      }
      if (info.icon && this.str(info.icon.byteOffset - r.byteOffset, 4) === 'SMDH') {
        const ib = info.icon.byteOffset - r.byteOffset, t = ib + 8 + 0x200 * 1; // título em inglês
        let s = ''; for (let i = 0; i < 0x40; i++) { const c = r[t + 8 + i * 2] | (r[t + 9 + i * 2] << 8); if (!c) break; s += String.fromCharCode(c); }
        if (s) info.longName = s;
      }
    }
    if (!info.codeBin) info.problems.push('ExeFS sem .code');
    return info;
  }

  // ---------- descompactação BLZ (código dos jogos de 3DS) ----------
  static blz(c) {
    const n = c.length, dv = new DataView(c.buffer, c.byteOffset, n);
    const tb = dv.getUint32(n - 8, true), add = dv.getUint32(n - 4, true);
    if (!add) return c.slice();
    const outLen = n + add, out = new Uint8Array(outLen); out.set(c);
    let index = n - ((tb >>> 24) & 0xFF), stop = n - (tb & 0xFFFFFF), o = outLen;
    while (index > stop) {
      let ctl = c[--index];
      for (let i = 0; i < 8; i++) {
        if (index <= stop || index <= 0 || o <= 0) break;
        if (ctl & 0x80) {
          index -= 2; const code = c[index] | (c[index + 1] << 8), size = ((code >> 12) & 15) + 3, off = (code & 0x0FFF) + 2;
          for (let j = 0; j < size; j++) { const d = out[o + off]; out[--o] = d; }
        } else out[--o] = c[--index];
        ctl = (ctl << 1) & 0xFF;
      }
    }
    return out;
  }

  // ---------- início do aplicativo ----------
  boot() {
    const I = this.info; let code;
    try { code = I.compressed ? N3DS.blz(I.codeBin) : I.codeBin; } catch (e) { I.problems.push('falha ao descompactar o código'); return; }
    I.codeSize = code.length;
    const put = (seg, from) => { if (!seg || !seg.size) return from; this.mem.load(seg.addr, code.subarray(from, from + seg.size)); return from + seg.pages * 0x1000; };
    let p = put(I.text, 0); p = put(I.ro, p); put(I.data, p);
    const self = this, mem = this.mem;
    const bus = {
      m16: mem.low16, m32: mem.low32, a16: mem.low16, a32: mem.low32, aLo: 0x00100000, aHi: 0x01000000, aMask: 0x00FFFFFF,
      r8: (a) => mem.r8(a), r16: (a) => mem.r16(a), r32: (a) => mem.r32(a), w8: (a, v) => mem.w8(a, v), w16: (a, v) => mem.w16(a, v), w32: (a, v) => mem.w32(a, v),
      swi: (cpu, n) => self.svc(n), cp15r: (id) => self.cp15r(id), cp15w: () => {},
    };
    const cpu = new Arm11(bus, true, 0, 1);
    cpu.mode = 0x10; cpu.r[13] = 0x10000000; cpu.r[15] = (I.text ? I.text.addr : 0x100000) + 4; cpu.cT = 0;
    this.cpu = cpu; this.tls = 0x1FF82000;
  }
  cp15r(id) { return id === 0xD03 ? this.tls : 0; } // c13,c0,3: endereço local da thread
  svc(n) {
    const c = this.cpu, r = c.r;
    this.svcCount.set(n, (this.svcCount.get(n) || 0) + 1);
    if (this.svcLog.length < 24) this.svcLog.push(n);
    switch (n) {
      case 0x01: { // ControlMemory: devolve o endereço pedido (memória é criada sob demanda)
        const op = r[0] & 0xFF; r[1] = (op & 0x10000) ? 0x14000000 : (r[1] || 0x08000000); r[0] = 0; return; }
      case 0x03: this.stopped = 'o jogo pediu para encerrar (ExitProcess)'; c.halted = true; return;
      case 0x08: case 0x21: case 0x17: case 0x13: r[0] = 0; r[1] = 0x100 + this.svcCount.size; return; // cria objeto: devolve um identificador
      case 0x0A: case 0x0B: case 0x23: case 0x22: case 0x24: case 0x25: r[0] = 0; return;
      case 0x28: { const t = Math.floor(this.frame * 268111856 / 60); r[0] = t | 0; r[1] = Math.floor(t / 4294967296); return; } // GetSystemTick
      case 0x2D: r[0] = 0; r[1] = 0x200 + this.svcCount.size; return; // ConnectToPort
      case 0x32: // SendSyncRequest: serviços ainda não existem; responde "ok" com resultado 0
        { const cmd = this.mem.r32(this.tls + 0x80); this.lastIpc = cmd; this.mem.w32(this.tls + 0x84, 0); r[0] = 0; return; }
      case 0x3C: this.stopped = 'Break chamado pelo jogo'; c.halted = true; return;
      case 0x3D: r[0] = 0; return; // OutputDebugString
      default: r[0] = 0; return;
    }
  }

  // ---------- quadro ----------
  runFrame() {
    this.frame++;
    if (this.cpu && !this.cpu.halted && this.steps < 50e6) {
      const c = this.cpu; c.tgt = c.cycles + 200000;
      try { c.run(); } catch (e) { this.stopped = 'erro no processador: ' + e.message; c.halted = true; }
      this.steps = c.cycles;
      if (c.unknown && !this.stopped) { this.stopped = 'instrução ainda não suportada ' + (c.unknown >>> 0).toString(16).toUpperCase().padStart(8, '0') + ' em ' + ((c.unknownPc >>> 0).toString(16).toUpperCase()); c.halted = true; }
    }
    if ((this.frame & 15) === 1) this.drawInfo();
  }

  // ---------- tela de informações ----------
  drawInfo() {
    const o = this.out; o.fill(0xFF000000);
    const rect = (x, y, w, h, c) => { for (let j = y; j < y + h; j++) o.fill(c, j * N3DS_W + x, j * N3DS_W + x + w); };
    rect(0, 0, 400, 240, 0xFF2A1A1A); rect(40, 240, 320, 240, 0xFF3A2424); rect(0, 0, 400, 22, 0xFF7A4FE0);
    let y = 6;
    const text = (s, x, yy, col) => {
      s = s.toUpperCase();
      for (let i = 0; i < s.length; i++) {
        const gl = N3DS_FONT[s[i]] || N3DS_FONT['?'];
        for (let py = 0; py < 7; py++) for (let px = 0; px < 5; px++) if (gl[py * 5 + px] === '1') { const X = x + i * 6 + px, Y = yy + py; if (X < N3DS_W && Y < N3DS_H) o[Y * N3DS_W + X] = col; }
      }
    };
    const W = 0xFFFFFFFF, G = 0xFFB0B0B0, OK = 0xFF7AE07A, BAD = 0xFF6A6AFF;
    text('LE POCKET 3DS - FASE INICIAL', 8, y, W); y = 30;
    const I = this.info, line = (s, c) => { text(s.slice(0, 64), 8, y, c || G); y += 11; };
    line('FORMATO: ' + I.kind, W);
    if (I.code) line('CODIGO: ' + I.code);
    if (I.programId) line('ID: ' + I.programId);
    if (I.longName) line('NOME: ' + I.longName.replace(/[^\x20-\x7E]/g, ''));
    if (I.name) line('EXHEADER: ' + I.name);
    line('CRIPTOGRAFADO: ' + (I.encrypted ? 'SIM' : 'NAO'), I.encrypted ? BAD : OK);
    if (I.codeSize) line('CODIGO CARREGADO: ' + (I.codeSize / 1024 | 0) + ' KB' + (I.compressed ? ' (DESCOMPACTADO)' : ''), OK);
    if (I.text) line('TEXT ' + I.text.addr.toString(16) + ' RO ' + I.ro.addr.toString(16) + ' DATA ' + I.data.addr.toString(16));
    for (const p of I.problems) line(p.normalize('NFD').replace(/[̀-ͯ]/g, ''), BAD);
    y = 250;
    text('PROCESSADOR ARM11', 48, y, W); y += 12;
    const L = (s, c) => { text(s.slice(0, 52), 48, y, c || G); y += 11; };
    if (!this.cpu) L('NAO INICIADO');
    else {
      L('CICLOS: ' + this.cpu.cycles);
      L('PC: ' + ((this.cpu.r[15] >>> 0).toString(16).toUpperCase()) + (this.cpu.cT ? ' THUMB' : ' ARM'));
      L('SVC: ' + this.svcLog.map((n) => n.toString(16).toUpperCase()).join(' '));
      if (this.stopped) L('PAROU: ' + this.stopped.normalize('NFD').replace(/[̀-ͯ]/g, ''), BAD); else L('RODANDO', OK);
    }
    y = 440; L('GPU E SERVICOS: PROXIMAS ETAPAS', G);
  }

  // ---------- contrato comum ----------
  press() {} touch() {} reset() { this.svcLog = []; this.svcCount.clear(); this.stopped = ''; this.mem = new N3DSMem(); if (this.info.codeBin) this.boot(); }
  getSave() { return new Uint8Array(0); } loadSave() {} setAudioRate() {}
  saveState() { return null; } loadState() {}
  diag() {
    const I = this.info, c = this.cpu;
    return ['3DS fase inicial', 'formato ' + I.kind + ' · código ' + (I.code || '-') + ' · criptografado ' + (I.encrypted ? 'sim' : 'não'),
      c ? 'ARM11 pc ' + (c.r[15] >>> 0).toString(16) + ' ciclos ' + c.cycles : 'ARM11 não iniciado',
      'SVC ' + this.svcLog.map((n) => n.toString(16)).join(' '), this.stopped ? 'parou: ' + this.stopped : 'rodando'].concat(I.problems).join('\n');
  }
}

// memória virtual do aplicativo: 16 MB fixos no começo (código) + páginas de 1 MB criadas sob demanda
class N3DSMem {
  constructor() {
    this.low = new ArrayBuffer(0x1000000); this.low8 = new Uint8Array(this.low); this.low16 = new Uint16Array(this.low); this.low32 = new Int32Array(this.low);
    this.pages = new Map();
  }
  pg(a) { let p = this.pages.get(a >>> 20); if (!p) { const b = new ArrayBuffer(0x100000); p = { b8: new Uint8Array(b), b16: new Uint16Array(b), b32: new Int32Array(b) }; this.pages.set(a >>> 20, p); } return p; }
  load(addr, data) { for (let i = 0; i < data.length; i++) this.w8(addr + i, data[i]); }
  r8(a) { return a < 0x1000000 ? this.low8[a] : this.pg(a).b8[a & 0xFFFFF]; }
  r16(a) { return a < 0x1000000 ? this.low16[a >> 1] : this.pg(a).b16[(a & 0xFFFFF) >> 1]; }
  r32(a) { return a < 0x1000000 ? this.low32[a >> 2] : this.pg(a).b32[(a & 0xFFFFF) >> 2]; }
  w8(a, v) { if (a < 0x1000000) this.low8[a] = v; else this.pg(a).b8[a & 0xFFFFF] = v; }
  w16(a, v) { if (a < 0x1000000) this.low16[a >> 1] = v; else this.pg(a).b16[(a & 0xFFFFF) >> 1] = v; }
  w32(a, v) { if (a < 0x1000000) this.low32[a >> 2] = v; else this.pg(a).b32[(a & 0xFFFFF) >> 2] = v; }
}

// ARM11 (ARMv6K): o ARM9 do DS + as instruções novas mais usadas pelos jogos
const ArmBase = (typeof Arm !== 'undefined') ? Arm : require('./armcpu.js').Arm;
class Arm11 extends ArmBase {
  ext(v, rot, kind) { v = (v >>> rot) | (v << (32 - rot)); switch (kind) { case 0: return (v << 24) >> 24; case 1: return (v << 16) >> 16; case 2: return v & 0xFF; default: return v & 0xFFFF; } }
  arm(op) {
    const r = this.r;
    // SVC do 3DS: número no byte de baixo
    if ((op & 0x0F000000) === 0x0F000000) { this.swi(op & 0xFF); return; }
    // SXTB/SXTH/UXTB/UXTH (+ soma)
    if ((op & 0x0F8003F0) === 0x06800070) {
      const sub = (op >>> 20) & 7, kind = sub === 2 ? 0 : sub === 3 ? 1 : sub === 6 ? 2 : sub === 7 ? 3 : -1;
      if (kind >= 0) { const rn = (op >>> 16) & 15, v = this.ext(r[op & 15], ((op >>> 10) & 3) * 8, kind); r[(op >>> 12) & 15] = rn === 15 ? v : (r[rn] + v) | 0; return; }
    }
    if ((op & 0x0FFF0FF0) === 0x06BF0F30) { const v = r[op & 15]; r[(op >>> 12) & 15] = ((v & 0xFF) << 24) | ((v & 0xFF00) << 8) | ((v >>> 8) & 0xFF00) | (v >>> 24); return; } // REV
    if ((op & 0x0FFF0FF0) === 0x06BF0FB0) { const v = r[op & 15]; r[(op >>> 12) & 15] = ((v & 0x00FF00FF) << 8) | ((v >>> 8) & 0x00FF00FF); return; } // REV16
    if ((op & 0x0FFF0FF0) === 0x06FF0FB0) { const v = r[op & 15]; r[(op >>> 12) & 15] = (((v & 0xFF) << 8) | ((v >>> 8) & 0xFF)) << 16 >> 16; return; } // REVSH
    // LDREX/STREX (palavra, byte, meia, dupla) — um núcleo só, sempre dá certo
    if ((op & 0x0F900FFF) === 0x01900F9F) { const k = (op >>> 21) & 3, a = r[(op >>> 16) & 15], d = (op >>> 12) & 15;
      if (k === 0) r[d] = this.read32(a); else if (k === 1) { r[d] = this.read32(a); r[d + 1] = this.read32(a + 4); } else if (k === 2) r[d] = this.read8(a); else r[d] = this.read16(a); return; }
    if ((op & 0x0F900FF0) === 0x01800F90) { const k = (op >>> 21) & 3, a = r[(op >>> 16) & 15], t = op & 15;
      if (k === 0) this.write32(a, r[t]); else if (k === 1) { this.write32(a, r[t]); this.write32(a + 4, r[t + 1]); } else if (k === 2) this.write8(a, r[t]); else this.write16(a, r[t]);
      r[(op >>> 12) & 15] = 0; return; }
    if (op === 0xF57FF01F || (op & 0xFFFFFFF0) === 0xF57FF040 || (op & 0xFFFFFFF0) === 0xF57FF050 || (op & 0xFFFFFFF0) === 0xF57FF060) return; // CLREX/DSB/DMB/ISB
    if ((op & 0x0FFFFFFF) === 0x0320F000 || (op & 0x0FFFFFFF) === 0x0320F002 || (op & 0x0FFFFFFF) === 0x0320F003 || (op & 0x0FFFFFFF) === 0x0320F004) return; // NOP/WFE/WFI/SEV
    if ((op & 0xFFF10020) === 0xF1000000) return; // CPS
    if ((op & 0xFD70F000) === 0xF550F000) return; // PLD
    if ((op & 0x0F000F10) === 0x0E000F10) { if (op & 0x100000) { const id = (((op >>> 16) & 15) << 8) | ((op & 15) << 4) | ((op >>> 5) & 7); r[(op >>> 12) & 15] = this.bus.cp15r(id); } return; } // MRC/MCR p15
    if ((op & 0x0F000E10) === 0x0E000A00 || (op & 0x0E000E00) === 0x0C000A00 || (op & 0x0F000E10) === 0x0E000A10) { if (!this.unknown) { this.unknown = op; this.unknownPc = r[15] - 8; } return; } // VFP: próxima etapa
    super.arm(op);
  }
  thumb(op) {
    const r = this.r;
    if ((op & 0xFF00) === 0xB200) { const v = r[(op >> 3) & 7], k = (op >> 6) & 3; r[op & 7] = k === 0 ? (v << 16) >> 16 : k === 1 ? (v << 24) >> 24 : k === 2 ? v & 0xFFFF : v & 0xFF; return; }
    if ((op & 0xFFC0) === 0xBA00) { const v = r[(op >> 3) & 7]; r[op & 7] = ((v & 0xFF) << 24) | ((v & 0xFF00) << 8) | ((v >>> 8) & 0xFF00) | (v >>> 24); return; }
    if ((op & 0xFFC0) === 0xBA40) { const v = r[(op >> 3) & 7]; r[op & 7] = ((v & 0x00FF00FF) << 8) | ((v >>> 8) & 0x00FF00FF); return; }
    if ((op & 0xFFC0) === 0xBAC0) { const v = r[(op >> 3) & 7]; r[op & 7] = ((((v & 0xFF) << 8) | ((v >>> 8) & 0xFF)) << 16) >> 16; return; }
    if ((op & 0xFFE8) === 0xB660) return; // CPS
    super.thumb(op);
  }
}
if (typeof module !== 'undefined') module.exports = { N3DS, N3DSMem, Arm11 };
