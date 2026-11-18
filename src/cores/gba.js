// ===== Núcleo Game Boy Advance =====
const GBAPU = (typeof module !== 'undefined' && typeof require !== 'undefined') ? require('./gbcore.js').APU : APU;
const OBJ_W = [[8, 16, 32, 64], [16, 32, 32, 64], [8, 8, 16, 32], [8, 8, 8, 8]];
const OBJ_H = [[8, 16, 32, 64], [8, 8, 16, 32], [16, 32, 32, 64], [8, 8, 8, 8]];
const SND_MAP = (() => {
  const m = new Int32Array(0x40);
  const set = (a, g) => { m[a - 0x60] = g; };
  set(0x60, 0xFF10); set(0x62, 0xFF11); set(0x63, 0xFF12); set(0x64, 0xFF13); set(0x65, 0xFF14);
  set(0x68, 0xFF16); set(0x69, 0xFF17); set(0x6C, 0xFF18); set(0x6D, 0xFF19);
  set(0x70, 0xFF1A); set(0x72, 0xFF1B); set(0x73, 0xFF1C); set(0x74, 0xFF1D); set(0x75, 0xFF1E);
  set(0x78, 0xFF20); set(0x79, 0xFF21); set(0x7C, 0xFF22); set(0x7D, 0xFF23);
  set(0x80, 0xFF24); set(0x81, 0xFF25); set(0x84, 0xFF26);
  for (let i = 0; i < 16; i++) set(0x90 + i, 0xFF30 + i);
  return m;
})();
const SAVE_NONE = 0, SAVE_SRAM = 1, SAVE_FLASH = 2, SAVE_EEPROM = 3;
const KEY_MAP = [4, 5, 6, 7, 0, 1, 2, 3, 8, 9]; // direita, esquerda, cima, baixo, A, B, select, start, R, L

class GBA {
  constructor(rom, opts = {}) {
    let size = 4; while (size < rom.length) size <<= 1;
    const mk = (n) => { const b = new ArrayBuffer(n); return [new Uint8Array(b), new Uint16Array(b), new Uint32Array(b)]; };
    [this.rom, this.rom16, this.rom32] = mk(size); this.rom.set(rom); this.romMask = size - 1; this.romLen = rom.length;
    [this.ewram, this.ewram16, this.ewram32] = mk(0x40000);
    [this.iwram, this.iwram16, this.iwram32] = mk(0x8000);
    [this.pal, this.pal16, this.pal32] = mk(0x400);
    [this.vram, this.vram16, this.vram32] = mk(0x20000);
    [this.oam, this.oam16, this.oam32] = mk(0x400);
    [this.io, this.io16] = mk(0x400);
    [this.bios, , this.bios32] = mk(0x4000);
    this.bios32[0x18 >> 2] = 0xEA000042; // b 0x128
    this.bios32.set([0xE92D500F, 0xE3A00301, 0xE28FE000, 0xE510F004, 0xE8BD500F, 0xE25EF004], 0x128 >> 2);
    this.r = new Int32Array(16);
    this.bank13 = new Int32Array(6); this.bank14 = new Int32Array(6); this.spsr = new Int32Array(6);
    this.fiqHi = new Int32Array(5); this.usrHi = new Int32Array(5);
    this.affX = new Int32Array(2); this.affY = new Int32Array(2);
    this.bgLine = [0, 1, 2, 3].map(() => new Uint16Array(240));
    this.objLine = new Uint16Array(240); this.objPri = new Uint8Array(240); this.objSemi = new Uint8Array(240); this.objWin = new Uint8Array(240);
    this.winMask = new Uint8Array(240);
    this.fb = new Uint32Array(240 * 160); this.out = new Uint32Array(240 * 160);
    this.lut = new Uint32Array(0x8000);
    for (let c = 0; c < 0x8000; c++) {
      const r = c & 31, g = (c >> 5) & 31, b = (c >> 10) & 31;
      this.lut[c] = (0xFF000000 | (((b << 3) | (b >> 2)) << 16) | (((g << 3) | (g >> 2)) << 8) | ((r << 3) | (r >> 2))) >>> 0;
    }
    this.apu = new GBAPU(32768);
    this.audioBuf = new Float32Array(4096); this.audioLen = 0; this.audioRate = 32768;
    this.timers = [0, 1, 2, 3].map(() => ({ reload: 0, counter: 0, start: 0, ovf: Infinity, div: 1, on: false, cascade: false, irq: false }));
    this.dma = [0, 1, 2, 3].map(() => ({ ctrl: 0, src: 0, dst: 0 }));
    this.fifo = [0, 1].map(() => ({ buf: new Int8Array(32), rd: 0, wr: 0, n: 0, cur: 0, timer: 0, a: 0, b: 0, t0: 0, per: 1 }));
    let t = ''; for (let i = 0xA0; i < 0xAC; i++) { const c = rom[i]; if (!c || c > 0x7E) break; t += String.fromCharCode(c); }
    this.title = t.trim() || 'SEM TITULO';
    this.detectSave();
    this.reset();
  }
  get sys() { return 'gba'; }
  get width() { return 240; } get height() { return 160; }
  setAudioRate() {}
  get hasSave() { return true; }

  detectSave() {
    const rom = this.rom, n = this.romLen - 12; let type = SAVE_SRAM, size = 0x8000; this.saveKnown = false;
    const is = (i, s) => { for (let k = 0; k < s.length; k++) if (rom[i + k] !== s.charCodeAt(k)) return false; return true; };
    for (let i = 0; i < n; i += 4) {
      const c = rom[i];
      if (c === 0x45 && is(i, 'EEPROM_V')) { type = SAVE_EEPROM; size = 0x2000; this.saveKnown = true; break; }
      if (c === 0x53 && (is(i, 'SRAM_V') || is(i, 'SRAM_F_V'))) { type = SAVE_SRAM; size = 0x8000; this.saveKnown = true; break; }
      if (c === 0x46) {
        if (is(i, 'FLASH1M_V')) { type = SAVE_FLASH; size = 0x20000; this.saveKnown = true; break; }
        if (is(i, 'FLASH512_V') || is(i, 'FLASH_V')) { type = SAVE_FLASH; size = 0x10000; this.saveKnown = true; break; }
      }
    }
    this.saveType = type; this.saveData = new Uint8Array(size).fill(0xFF);
    this.saveDirty = false; this.saveUsed = false;
  }
  getSave() { return this.saveUsed ? this.saveData.slice() : null; }
  loadSave(d) { this.saveData.set(d.subarray(0, Math.min(d.length, this.saveData.length))); this.saveUsed = true; }

  reset() {
    this.ewram.fill(0); this.iwram.fill(0); this.pal.fill(0); this.vram.fill(0); this.oam.fill(0); this.io.fill(0);
    const r = this.r; r.fill(0);
    this.bank13.fill(0); this.bank14.fill(0); this.spsr.fill(0); this.fiqHi.fill(0); this.usrHi.fill(0);
    this.mode = 0x1F; this.cN = 0; this.cZ = 0; this.cC = 0; this.cV = 0; this.cI = 0; this.cF = 0; this.cT = 0; this.sc = 0;
    r[13] = 0x03007F00; this.bank13[2] = 0x03007FA0; this.bank13[3] = 0x03007FE0;
    r[15] = 0x08000004;
    this.cycles = 0; this.tgt = 0; this.lineEnd = 0; this.nextTimer = Infinity; this.audioT = 0;
    this.halted = false; this.intrWaiting = false;
    this.ie = 0; this.if_ = 0; this.ime = 0; this.irqLine = false;
    this.dispstat = 0; this.vcount = 0; this.keys = 0;
    this.affX.fill(0); this.affY.fill(0);
    const io16 = this.io16;
    io16[0x20 >> 1] = 0x100; io16[0x26 >> 1] = 0x100; io16[0x30 >> 1] = 0x100; io16[0x36 >> 1] = 0x100;
    io16[0x88 >> 1] = 0x200; this.io[0x300] = 1;
    for (const t of this.timers) { t.reload = 0; t.counter = 0; t.start = 0; t.ovf = Infinity; t.div = 1; t.on = false; t.cascade = false; t.irq = false; }
    for (const d of this.dma) { d.ctrl = 0; d.src = 0; d.dst = 0; }
    for (const f of this.fifo) { f.rd = 0; f.wr = 0; f.n = 0; f.cur = 0; f.timer = 0; f.a = 0; f.b = 0; f.t0 = 0; f.per = 1; }
    this.fl = { state: 0, id: false, erase: false, write: false, bankSel: false, bank: 0 };
    this.eeAddrBits = 0; this.eeReadAddr = 0; this.eeReadPos = -1;
    this.mlo = 0; this.mhi = 0;
    this.audioLen = 0; this.hpXl = this.hpXr = this.hpYl = this.hpYr = 0; this.lpL = this.lpR = 0;
  }

  // ================= Memória =================
  read8(a) {
    a >>>= 0;
    switch (a >>> 24) {
      case 0: return a < 0x4000 ? this.bios[a] : 0;
      case 2: return this.ewram[a & 0x3FFFF];
      case 3: return this.iwram[a & 0x7FFF];
      case 4: { const o = a & 0xFFFFFF; if (o >= 0x400) return 0; return (this.ioRead16(o & 0x3FE) >>> ((o & 1) << 3)) & 0xFF; }
      case 5: return this.pal[a & 0x3FF];
      case 6: a &= 0x1FFFF; if (a >= 0x18000) a -= 0x8000; return this.vram[a];
      case 7: return this.oam[a & 0x3FF];
      case 8: case 9: case 10: case 11: case 12: case 13: return this.rom[a & this.romMask];
      case 14: case 15: return this.saveRead(a);
    }
    return 0;
  }
  read16(a) {
    a = (a & ~1) >>> 0;
    switch (a >>> 24) {
      case 0: return a < 0x4000 ? this.bios[a] | (this.bios[a + 1] << 8) : 0;
      case 2: return this.ewram16[(a & 0x3FFFF) >> 1];
      case 3: return this.iwram16[(a & 0x7FFF) >> 1];
      case 4: { const o = a & 0xFFFFFF; if (o >= 0x400) return 0; return this.ioRead16(o); }
      case 5: return this.pal16[(a & 0x3FF) >> 1];
      case 6: a &= 0x1FFFF; if (a >= 0x18000) a -= 0x8000; return this.vram16[a >> 1];
      case 7: return this.oam16[(a & 0x3FF) >> 1];
      case 13: if (this.saveType === SAVE_EEPROM) return this.eepromRead();
      // falls through
      case 8: case 9: case 10: case 11: case 12: return this.rom16[(a & this.romMask) >> 1];
      case 14: case 15: return this.saveRead(a) * 0x101;
    }
    return 0;
  }
  read32(a) {
    a = (a & ~3) >>> 0;
    switch (a >>> 24) {
      case 0: return a < 0x4000 ? this.bios32[a >> 2] | 0 : 0;
      case 2: return this.ewram32[(a & 0x3FFFF) >> 2] | 0;
      case 3: return this.iwram32[(a & 0x7FFF) >> 2] | 0;
      case 4: { const o = a & 0xFFFFFF; if (o >= 0x400) return 0; return this.ioRead16(o) | (this.ioRead16(o + 2) << 16); }
      case 5: return this.pal32[(a & 0x3FF) >> 2] | 0;
      case 6: a &= 0x1FFFF; if (a >= 0x18000) a -= 0x8000; return this.vram32[a >> 2] | 0;
      case 7: return this.oam32[(a & 0x3FF) >> 2] | 0;
      case 8: case 9: case 10: case 11: case 12: case 13: return this.rom32[(a & this.romMask) >> 2] | 0;
      case 14: case 15: return (this.saveRead(a) * 0x01010101) | 0;
    }
    return 0;
  }
  write8(a, v) {
    a >>>= 0;
    switch (a >>> 24) {
      case 2: this.ewram[a & 0x3FFFF] = v; return;
      case 3: this.iwram[a & 0x7FFF] = v; return;
      case 4: { const o = a & 0xFFFFFF; if (o < 0x400) this.ioWrite8(o, v & 0xFF); return; }
      case 5: this.pal16[(a & 0x3FF) >> 1] = (v & 0xFF) * 0x101; return;
      case 6: a &= 0x1FFFF; if (a >= 0x18000) a -= 0x8000; this.vram16[a >> 1] = (v & 0xFF) * 0x101; return;
      case 14: case 15: this.saveWrite(a, v & 0xFF); return;
    }
  }
  write16(a, v) {
    a = (a & ~1) >>> 0;
    switch (a >>> 24) {
      case 2: this.ewram16[(a & 0x3FFFF) >> 1] = v; return;
      case 3: this.iwram16[(a & 0x7FFF) >> 1] = v; return;
      case 4: { const o = a & 0xFFFFFF; if (o < 0x400) this.ioWrite16(o, v & 0xFFFF); return; }
      case 5: this.pal16[(a & 0x3FF) >> 1] = v; return;
      case 6: a &= 0x1FFFF; if (a >= 0x18000) a -= 0x8000; this.vram16[a >> 1] = v; return;
      case 7: this.oam16[(a & 0x3FF) >> 1] = v; return;
      case 14: case 15: this.saveWrite(a, v & 0xFF); return;
    }
  }
  write32(a, v) {
    a = (a & ~3) >>> 0;
    switch (a >>> 24) {
      case 2: this.ewram32[(a & 0x3FFFF) >> 2] = v; return;
      case 3: this.iwram32[(a & 0x7FFF) >> 2] = v; return;
      case 4: { const o = a & 0xFFFFFF; if (o < 0x400) { this.ioWrite16(o, v & 0xFFFF); this.ioWrite16(o + 2, (v >>> 16) & 0xFFFF); } return; }
      case 5: this.pal32[(a & 0x3FF) >> 2] = v; return;
      case 6: a &= 0x1FFFF; if (a >= 0x18000) a -= 0x8000; this.vram32[a >> 2] = v; return;
      case 7: this.oam32[(a & 0x3FF) >> 2] = v; return;
      case 14: case 15: this.saveWrite(a, v & 0xFF); return;
    }
  }

  // ----- Save (SRAM / Flash / EEPROM) -----
  saveRead(a) {
    if (this.saveType === SAVE_FLASH) {
      a &= 0xFFFF; const f = this.fl;
      if (f.id && a < 2) return this.saveData.length > 0x10000 ? (a ? 0x13 : 0x62) : (a ? 0x1B : 0x32);
      return this.saveData[(f.bank << 16) | a];
    }
    if (this.saveType === SAVE_SRAM) return this.saveData[a & 0x7FFF];
    return 0xFF;
  }
  saveWrite(a, v) {
    if (this.saveType === SAVE_SRAM) { this.saveData[a & 0x7FFF] = v; this.saveDirty = true; this.saveUsed = true; return; }
    if (this.saveType !== SAVE_FLASH) return;
    a &= 0xFFFF; const f = this.fl, d = this.saveData;
    if (f.write) { d[(f.bank << 16) | a] = v; f.write = false; this.saveDirty = true; this.saveUsed = true; return; }
    if (f.bankSel && a === 0) { f.bank = d.length > 0x10000 ? v & 1 : 0; f.bankSel = false; return; }
    if (f.state === 0 && a === 0x5555 && v === 0xAA) f.state = 1;
    else if (f.state === 1 && a === 0x2AAA && v === 0x55) f.state = 2;
    else if (f.state === 2) {
      f.state = 0;
      if (a === 0x5555) {
        switch (v) {
          case 0x90: f.id = true; break;
          case 0xF0: f.id = false; break;
          case 0x80: f.erase = true; break;
          case 0x10: if (f.erase) { d.fill(0xFF); f.erase = false; this.saveDirty = true; this.saveUsed = true; } break;
          case 0xA0: f.write = true; break;
          case 0xB0: f.bankSel = true; break;
        }
      } else if (v === 0x30 && f.erase) {
        const b = (f.bank << 16) | (a & 0xF000); d.fill(0xFF, b, b + 0x1000); f.erase = false; this.saveDirty = true; this.saveUsed = true;
      }
    } else if (v === 0xF0) { f.state = 0; f.id = false; }
  }
  eepromRead() {
    if (this.eeReadPos < 0) return 1;
    const pos = this.eeReadPos++;
    if (pos < 4) return 0;
    const bi = pos - 4;
    if (bi >= 63) this.eeReadPos = -1;
    if (bi > 63) return 1;
    return (this.saveData[(this.eeReadAddr + (bi >> 3)) & 0x1FFF] >> (7 - (bi & 7))) & 1;
  }
  eepromDma(src, count) {
    if (count === 9 || count === 73) this.eeAddrBits = 6; else if (count === 17 || count === 81) this.eeAddrBits = 14;
    const ab = this.eeAddrBits || 14;
    const bit = (k) => this.read16(src + k * 2) & 1;
    const cmd = (bit(0) << 1) | bit(1);
    let addr = 0; for (let k = 0; k < ab; k++) addr = (addr << 1) | bit(2 + k);
    addr &= 0x3FF;
    if (cmd === 3) { this.eeReadAddr = addr * 8; this.eeReadPos = 0; }
    else if (cmd === 2 && count >= ab + 66) {
      for (let b = 0; b < 8; b++) { let v = 0; for (let k = 0; k < 8; k++) v = (v << 1) | bit(2 + ab + b * 8 + k); this.saveData[addr * 8 + b] = v; }
      this.saveDirty = true; this.saveUsed = true; this.eeReadPos = -1;
    }
  }

  // ================= E/S =================
  ioRead16(a) {
    switch (a) {
      case 0x004: return this.dispstat;
      case 0x006: return this.vcount;
      case 0x084: { const p = this.apu; return (this.io[0x84] & 0x80) | p.on[0] | (p.on[1] << 1) | (p.on[2] << 2) | (p.on[3] << 3); }
      case 0x100: case 0x104: case 0x108: case 0x10C: return this.timerRead((a - 0x100) >> 2);
      case 0x130: return (~this.keys) & 0x3FF;
      case 0x200: return this.ie;
      case 0x202: return this.if_;
      case 0x208: return this.ime;
    }
    return this.io16[a >> 1];
  }
  sndWrite8(a, v) {
    this.io[a] = v;
    const g = SND_MAP[a - 0x60];
    if (g) { this.audioCatchUp(this.cycles); this.apu.write(g, v); }
  }
  ioWrite8(a, v) {
    if (a >= 0x60 && a < 0xA0 && (a & 0xFE) !== 0x82 && (a < 0x88 || a > 0x8B)) { this.sndWrite8(a, v); return; }
    if (a === 0x202 || a === 0x203) { this.if_ &= ~(a & 1 ? v << 8 : v); this.updateIrq(); return; }
    if (a === 0x301) { if (!this.irqLine) { this.halted = true; this.tgt = 0; } return; }
    if (a === 0x300) { this.io[0x300] = v; return; }
    if (a >= 0xA0 && a < 0xA8) { this.fifoPush((a >> 2) & 1, v); return; }
    const cur = this.io16[a >> 1];
    this.ioWrite16(a & ~1, a & 1 ? (cur & 0xFF) | (v << 8) : (cur & 0xFF00) | v);
  }
  ioWrite16(a, v) {
    const io16 = this.io16;
    if (a >= 0x60 && a < 0xA0) {
      if (a === 0x82) {
        io16[0x82 >> 1] = v & 0x770F;
        this.audioCatchUp(this.cycles);
        if (v & 0x0800) { const f = this.fifo[0]; f.rd = f.wr = f.n = 0; }
        if (v & 0x8000) { const f = this.fifo[1]; f.rd = f.wr = f.n = 0; }
        this.fifo[0].timer = (v >> 10) & 1; this.fifo[1].timer = (v >> 14) & 1;
        return;
      }
      if (a >= 0x88 && a < 0x8C) { io16[a >> 1] = v; return; }
      this.sndWrite8(a, v & 0xFF); this.sndWrite8(a + 1, v >>> 8);
      return;
    }
    io16[a >> 1] = v;
    switch (a) {
      case 0x004: this.dispstat = (this.dispstat & 7) | (v & 0xFFB8); return;
      case 0x028: case 0x02A: this.affX[0] = (((io16[0x2A >> 1] << 16) | io16[0x28 >> 1]) << 4) >> 4; return;
      case 0x02C: case 0x02E: this.affY[0] = (((io16[0x2E >> 1] << 16) | io16[0x2C >> 1]) << 4) >> 4; return;
      case 0x038: case 0x03A: this.affX[1] = (((io16[0x3A >> 1] << 16) | io16[0x38 >> 1]) << 4) >> 4; return;
      case 0x03C: case 0x03E: this.affY[1] = (((io16[0x3E >> 1] << 16) | io16[0x3C >> 1]) << 4) >> 4; return;
      case 0x0A0: case 0x0A2: this.fifoPush(0, v & 0xFF); this.fifoPush(0, v >>> 8); return;
      case 0x0A4: case 0x0A6: this.fifoPush(1, v & 0xFF); this.fifoPush(1, v >>> 8); return;
      case 0x0BA: case 0x0C6: case 0x0D2: case 0x0DE: this.dmaCtrl(((a - 0xBA) / 12) | 0, v); return;
      case 0x100: case 0x104: case 0x108: case 0x10C: this.timers[(a - 0x100) >> 2].reload = v; return;
      case 0x102: case 0x106: case 0x10A: case 0x10E: this.timerCtrl((a - 0x102) >> 2, v); return;
      case 0x200: this.ie = v & 0x3FFF; this.updateIrq(); return;
      case 0x202: this.if_ &= ~v; this.updateIrq(); return;
      case 0x208: this.ime = v & 1; return;
      case 0x300: if (!this.irqLine) { this.halted = true; this.tgt = 0; } return;
    }
  }
  raise(bits) { this.if_ |= bits; this.updateIrq(); }
  updateIrq() { this.irqLine = (this.ie & this.if_) !== 0; if (this.irqLine) this.halted = false; }
  press(k, down) { const b = 1 << KEY_MAP[k]; if (down) this.keys |= b; else this.keys &= ~b; }

  // ----- Timers -----
  timerRead(i) {
    const t = this.timers[i];
    if (!t.on || t.cascade) return t.counter & 0xFFFF;
    return (t.counter + Math.floor((this.cycles - t.start) / t.div)) & 0xFFFF;
  }
  timerCtrl(i, v) {
    const t = this.timers[i], was = t.on;
    if (was && !t.cascade) t.counter = this.timerRead(i);
    t.div = [1, 64, 256, 1024][v & 3]; t.cascade = i > 0 && (v & 4) !== 0; t.irq = (v & 0x40) !== 0; t.on = (v & 0x80) !== 0;
    if (t.on && !was) t.counter = t.reload;
    t.start = this.cycles;
    t.ovf = (t.on && !t.cascade) ? t.start + (0x10000 - t.counter) * t.div : Infinity;
    this.updNextTimer();
    if (this.nextTimer < this.tgt) this.tgt = this.nextTimer;
  }
  updNextTimer() { const t = this.timers; this.nextTimer = Math.min(t[0].ovf, t[1].ovf, t[2].ovf, t[3].ovf); }
  timerEvents() {
    for (let i = 0; i < 4; i++) {
      const t = this.timers[i];
      while (t.ovf <= this.cycles) {
        const when = t.ovf;
        t.counter = t.reload; t.start = when; t.ovf = when + (0x10000 - t.reload) * t.div;
        this.timerOverflow(i, when);
      }
    }
    this.updNextTimer();
  }
  timerOverflow(i, when) {
    const t = this.timers[i];
    if (t.irq) this.raise(8 << i);
    if (i < 2) {
      for (let k = 0; k < 2; k++) {
        const f = this.fifo[k];
        if (f.timer !== i) continue;
        this.audioCatchUp(when);
        if (f.n > 0) { f.cur = f.buf[f.rd]; f.rd = (f.rd + 1) & 31; f.n--; }
        f.a = f.b; f.b = f.cur; f.t0 = when; f.per = Math.max(1, (0x10000 - t.reload) * t.div);
        if (f.n <= 16) {
          const dst = 0x040000A0 + k * 4;
          for (let j = 1; j <= 2; j++) { const d = this.dma[j]; if ((d.ctrl & 0xB000) === 0xB000 && d.dst === dst) this.runDma(j); }
        }
      }
    }
    if (i < 3) {
      const n = this.timers[i + 1];
      if (n.on && n.cascade) { n.counter++; if (n.counter > 0xFFFF) { n.counter = n.reload; this.timerOverflow(i + 1, when); } }
    }
  }

  // ----- Som -----
  fifoPush(k, v) { const f = this.fifo[k]; if (f.n < 32) { f.buf[f.wr] = v; f.wr = (f.wr + 1) & 31; f.n++; } }
  audioCatchUp(now) {
    if (this.audioT + 512 > now) return;
    const apu = this.apu, buf = this.audioBuf, cnt = this.io16[0x82 >> 1], on = this.io[0x84] & 0x80;
    const psgVol = [0.25, 0.5, 1, 0][cnt & 3] * 0.9, fa = this.fifo[0], fbb = this.fifo[1];
    const ga = (cnt & 4) ? 1 : 0.5, gbv = (cnt & 8) ? 1 : 0.5;
    while (this.audioT + 512 <= now) {
      this.audioT += 512;
      let l = 0, r = 0;
      if (on) {
        // PSG: média de 8 pontos dentro da amostra (onda quadrada sem serrilhado)
        let pl = 0, pr = 0;
        for (let k = 0; k < 8; k++) { apu.advance(16); apu.mix(); pl += apu.mL; pr += apu.mR; }
        pl *= 0.125; pr *= 0.125;
        // som direto: interpola entre a amostra anterior e a atual, conforme o tempo do timer
        const T = this.audioT;
        let fr = (T - fa.t0) / fa.per; fr = fr < 0 ? 0 : fr > 1 ? 1 : fr;
        const a = (fa.a + (fa.b - fa.a) * fr) / 128 * ga;
        fr = (T - fbb.t0) / fbb.per; fr = fr < 0 ? 0 : fr > 1 ? 1 : fr;
        const b = (fbb.a + (fbb.b - fbb.a) * fr) / 128 * gbv;
        const dl = ((cnt & 0x0200) ? a : 0) + ((cnt & 0x2000) ? b : 0), dr = ((cnt & 0x0100) ? a : 0) + ((cnt & 0x1000) ? b : 0);
        l = (pl * psgVol + dl) * 0.42; r = (pr * psgVol + dr) * 0.42;
      }
      // passa-baixa suave (como o alto-falante do GBA) e passa-alta (tira nível contínuo)
      this.lpL += (l - this.lpL) * 0.8; this.lpR += (r - this.lpR) * 0.8; l = this.lpL; r = this.lpR;
      const yl = l - this.hpXl + 0.9985 * this.hpYl, yr = r - this.hpXr + 0.9985 * this.hpYr;
      this.hpXl = l; this.hpXr = r; this.hpYl = yl; this.hpYr = yr;
      l = yl > 0.98 ? 0.98 : yl < -0.98 ? -0.98 : yl; r = yr > 0.98 ? 0.98 : yr < -0.98 ? -0.98 : yr;
      if (this.audioLen < buf.length - 1) { buf[this.audioLen++] = l; buf[this.audioLen++] = r; }
    }
  }

  // ----- DMA -----
  dmaCtrl(i, v) {
    const d = this.dma[i], was = d.ctrl & 0x8000, io16 = this.io16;
    d.ctrl = v;
    if ((v & 0x8000) && !was) {
      const base = (0xB0 + i * 12) >> 1;
      d.src = (io16[base] | (io16[base + 1] << 16)) & (i === 0 ? 0x07FFFFFF : 0x0FFFFFFF);
      d.dst = (io16[base + 2] | (io16[base + 3] << 16)) & (i === 3 ? 0x0FFFFFFF : 0x07FFFFFF);
      if (((v >> 12) & 3) === 0) this.runDma(i);
    }
  }
  dmaTrigger(timing) {
    for (let i = 0; i < 4; i++) { const c = this.dma[i].ctrl; if ((c & 0x8000) && ((c >> 12) & 3) === timing) this.runDma(i); }
  }
  runDma(i) {
    const d = this.dma[i], base = (0xB0 + i * 12) >> 1, ctrl = d.ctrl, timing = (ctrl >> 12) & 3, io16 = this.io16;
    let count = io16[base + 4]; if (i < 3) count &= 0x3FFF; if (count === 0) count = i === 3 ? 0x10000 : 0x4000;
    let word = ctrl & 0x0400, ds = [1, -1, 0, 1][(ctrl >> 5) & 3], ss = [1, -1, 0, 1][(ctrl >> 7) & 3];
    if (timing === 3) { if (i === 1 || i === 2) { count = 4; word = 1; ds = 0; } else return; }
    let src = d.src, dst = d.dst;
    if (i === 3 && this.saveType === SAVE_EEPROM && (dst >>> 24) === 0x0D) { this.eepromDma(src, count); src += count * 2; }
    else if (word) { ss *= 4; ds *= 4; for (let k = 0; k < count; k++) { this.write32(dst, this.read32(src)); src += ss; dst += ds; } }
    else { ss *= 2; ds *= 2; for (let k = 0; k < count; k++) { this.write16(dst, this.read16(src)); src += ss; dst += ds; } }
    d.src = src >>> 0;
    d.dst = ((ctrl >> 5) & 3) === 3 ? ((io16[base + 2] | (io16[base + 3] << 16)) & (i === 3 ? 0x0FFFFFFF : 0x07FFFFFF)) : dst >>> 0;
    this.cycles += count * 2 + 4;
    if (ctrl & 0x4000) this.raise(0x100 << i);
    if (!(ctrl & 0x0200) || timing === 0) { d.ctrl &= 0x7FFF; io16[base + 5] &= 0x7FFF; }
  }

  // ================= Quadro =================
  runFrame() {
    for (let line = 0; line < 228; line++) {
      this.startLine(line);
      const t0 = this.lineEnd;
      this.runUntil(t0 + 960);
      this.dispstat |= 2;
      if (line < 160) { this.renderLine(line); this.dmaTrigger(2); }
      if (this.dispstat & 0x10) this.raise(2);
      this.runUntil(t0 + 1232);
      this.dispstat &= ~2;
      this.lineEnd = t0 + 1232;
    }
    this.audioCatchUp(this.cycles);
  }
  startLine(line) {
    this.vcount = line;
    if (line === (this.dispstat >>> 8)) { this.dispstat |= 4; if (this.dispstat & 0x20) this.raise(4); } else this.dispstat &= ~4;
    if (line === 160) {
      this.dispstat |= 1; if (this.dispstat & 8) this.raise(1);
      this.dmaTrigger(1);
      const t = this.out; this.out = this.fb; this.fb = t;
    } else if (line === 227) this.dispstat &= ~1;
    else if (line === 0) {
      const io16 = this.io16;
      this.affX[0] = (((io16[0x2A >> 1] << 16) | io16[0x28 >> 1]) << 4) >> 4; this.affY[0] = (((io16[0x2E >> 1] << 16) | io16[0x2C >> 1]) << 4) >> 4;
      this.affX[1] = (((io16[0x3A >> 1] << 16) | io16[0x38 >> 1]) << 4) >> 4; this.affY[1] = (((io16[0x3E >> 1] << 16) | io16[0x3C >> 1]) << 4) >> 4;
    }
  }
  runUntil(t) {
    while (this.cycles < t) {
      this.tgt = t < this.nextTimer ? t : this.nextTimer;
      this.run();
      if (this.cycles >= this.nextTimer) this.timerEvents();
    }
  }

  // ================= Vídeo =================
  renderLine(y) {
    const io = this.io16, dispcnt = io[0], out = this.fb, base = y * 240, lut = this.lut;
    if (dispcnt & 0x80) { out.fill(0xFFFFFFFF, base, base + 240); this.affStep(); return; }
    const mode = dispcnt & 7; let en = (dispcnt >>> 8) & 0xF;
    if (mode === 0) { for (let b = 0; b < 4; b++) if (en & (1 << b)) this.renderText(b, y); }
    else if (mode === 1) { en &= 7; if (en & 1) this.renderText(0, y); if (en & 2) this.renderText(1, y); if (en & 4) this.renderAffine(2, y); }
    else if (mode === 2) { en &= 0xC; if (en & 4) this.renderAffine(2, y); if (en & 8) this.renderAffine(3, y); }
    else if (mode <= 5) { en &= 4; if (en) this.renderBitmap(mode, dispcnt); }
    else en = 0;
    this.affStep();
    const objOn = (dispcnt & 0x1000) !== 0;
    if (objOn) this.renderObj(y, dispcnt, mode);
    // janelas
    const winOn = (dispcnt & 0xE000) !== 0, mask = this.winMask;
    if (winOn) {
      mask.fill(io[0x4A >> 1] & 0x3F);
      if ((dispcnt & 0x8000) && objOn) { const m = (io[0x4A >> 1] >> 8) & 0x3F, ow = this.objWin; for (let x = 0; x < 240; x++) if (ow[x]) mask[x] = m; }
      for (let w = 1; w >= 0; w--) {
        if (!(dispcnt & (0x2000 << w))) continue;
        const v = io[(0x44 >> 1) + w], y1 = v >> 8, y2 = v & 0xFF;
        if (!(y1 <= y2 ? (y >= y1 && y < y2) : (y >= y1 || y < y2))) continue;
        const h = io[(0x40 >> 1) + w]; let x1 = h >> 8, x2 = h & 0xFF; if (x2 > 240) x2 = 240;
        const m = (w ? io[0x48 >> 1] >> 8 : io[0x48 >> 1]) & 0x3F;
        if (x1 <= x2) mask.fill(m, x1, x2); else { mask.fill(m, 0, x2); if (x1 < 240) mask.fill(m, x1, 240); }
      }
    }
    // ordem das camadas
    const order = this.order || (this.order = [0, 0, 0, 0]); const bgPrio = this.bgPrio || (this.bgPrio = [0, 0, 0, 0]);
    let n = 0;
    for (let p = 0; p < 4; p++) for (let b = 0; b < 4; b++) if ((en & (1 << b)) && (io[4 + b] & 3) === p) { order[n++] = b; bgPrio[b] = p; }
    const bld = io[0x50 >> 1], bldMode = (bld >> 6) & 3, t1 = bld & 0x3F, t2 = (bld >> 8) & 0x3F;
    const alpha = io[0x52 >> 1]; let eva = alpha & 0x1F, evb = (alpha >> 8) & 0x1F, evy = io[0x54 >> 1] & 0x1F;
    if (eva > 16) eva = 16; if (evb > 16) evb = 16; if (evy > 16) evy = 16;
    const backdrop = this.pal16[0] & 0x7FFF;
    const objLine = this.objLine, objPri = this.objPri, objSemi = this.objSemi, bgLine = this.bgLine;
    const needSecond = bldMode === 1 || (objOn && this.anySemi);
    for (let x = 0; x < 240; x++) {
      const m = winOn ? mask[x] : 0x3F;
      let l1 = 5, c1 = backdrop, l2 = 5, c2 = backdrop, found = 0;
      const op = (objOn && (m & 0x10)) ? objPri[x] : 4;
      let objPending = op < 4;
      for (let k = 0; k < n; k++) {
        const b = order[k];
        if (objPending && op <= bgPrio[b]) {
          objPending = false;
          if (found === 0) { l1 = 4; c1 = objLine[x]; found = 1; if (!needSecond) break; } else { l2 = 4; c2 = objLine[x]; found = 2; break; }
        }
        if (m & (1 << b)) {
          const c = bgLine[b][x];
          if (!(c & 0x8000)) { if (found === 0) { l1 = b; c1 = c; found = 1; if (!needSecond) break; } else { l2 = b; c2 = c; found = 2; break; } }
        }
      }
      if (objPending && found < 2) { if (found === 0) { l1 = 4; c1 = objLine[x]; } else { l2 = 4; c2 = objLine[x]; } }
      if (l1 === 4 && objSemi[x] && (m & 0x20) && (t2 & (1 << l2))) c1 = this.blend(c1, c2, eva, evb);
      else if (bldMode && (m & 0x20) && (t1 & (1 << l1))) {
        if (bldMode === 1) { if (t2 & (1 << l2)) c1 = this.blend(c1, c2, eva, evb); }
        else {
          let r = c1 & 31, g = (c1 >> 5) & 31, b = (c1 >> 10) & 31;
          if (bldMode === 2) { r += ((31 - r) * evy) >> 4; g += ((31 - g) * evy) >> 4; b += ((31 - b) * evy) >> 4; }
          else { r -= (r * evy) >> 4; g -= (g * evy) >> 4; b -= (b * evy) >> 4; }
          c1 = r | (g << 5) | (b << 10);
        }
      }
      out[base + x] = lut[c1];
    }
  }
  blend(c1, c2, eva, evb) {
    let r = ((c1 & 31) * eva + (c2 & 31) * evb) >> 4, g = (((c1 >> 5) & 31) * eva + ((c2 >> 5) & 31) * evb) >> 4, b = (((c1 >> 10) & 31) * eva + ((c2 >> 10) & 31) * evb) >> 4;
    if (r > 31) r = 31; if (g > 31) g = 31; if (b > 31) b = 31;
    return r | (g << 5) | (b << 10);
  }
  affStep() {
    const io = this.io16;
    this.affX[0] += (io[0x22 >> 1] << 16) >> 16; this.affY[0] += (io[0x26 >> 1] << 16) >> 16;
    this.affX[1] += (io[0x32 >> 1] << 16) >> 16; this.affY[1] += (io[0x36 >> 1] << 16) >> 16;
  }
  renderText(b, y) {
    const io = this.io16, cnt = io[4 + b], vram = this.vram, vram16 = this.vram16, pal = this.pal16, out = this.bgLine[b];
    const charBase = ((cnt >> 2) & 3) << 14, screenBase = ((cnt >> 8) & 0x1F) << 11, is8 = cnt & 0x80, size = cnt >> 14;
    const hofs = io[8 + b * 2] & 0x1FF, vofs = io[9 + b * 2] & 0x1FF;
    const yy = (y + vofs) & ((size & 2) ? 511 : 255), wMask = (size & 1) ? 511 : 255;
    const rowBase = screenBase + ((yy & 256) ? (size === 3 ? 0x1000 : 0x800) : 0) + (((yy >> 3) & 31) << 6);
    const fy = yy & 7;
    let addr = 0, hflip = 0, palBank = 0, valid = false;
    for (let x = 0; x < 240; x++) {
      const px = (x + hofs) & wMask;
      if (x === 0 || (px & 7) === 0) {
        const e = vram16[(rowBase + ((px & 256) ? 0x800 : 0) + (((px >> 3) & 31) << 1)) >> 1];
        hflip = e & 0x400; palBank = (e >> 12) << 4;
        const row = (e & 0x800) ? 7 - fy : fy;
        addr = is8 ? charBase + ((e & 0x3FF) << 6) + (row << 3) : charBase + ((e & 0x3FF) << 5) + (row << 2);
        valid = addr < 0x10000;
      }
      let c = 0x8000;
      if (valid) {
        const col = hflip ? 7 - (px & 7) : px & 7;
        if (is8) { const ci = vram[addr + col]; if (ci) c = pal[ci] & 0x7FFF; }
        else { const v = vram[addr + (col >> 1)]; const ci = (col & 1) ? v >> 4 : v & 15; if (ci) c = pal[palBank + ci] & 0x7FFF; }
      }
      out[x] = c;
    }
  }
  renderAffine(b, y) {
    const io = this.io16, cnt = io[4 + b], vram = this.vram, pal = this.pal16, out = this.bgLine[b], k = b - 2;
    const charBase = ((cnt >> 2) & 3) << 14, screenBase = ((cnt >> 8) & 0x1F) << 11, wrap = cnt & 0x2000;
    const sh = 4 + (cnt >> 14), size = 128 << (cnt >> 14);
    let fx = this.affX[k], fy = this.affY[k];
    const pa = (io[(0x20 + k * 0x10) >> 1] << 16) >> 16, pc = (io[(0x24 + k * 0x10) >> 1] << 16) >> 16;
    for (let x = 0; x < 240; x++) {
      let px = fx >> 8, py = fy >> 8; fx += pa; fy += pc;
      if (wrap) { px &= size - 1; py &= size - 1; }
      else if (px < 0 || py < 0 || px >= size || py >= size) { out[x] = 0x8000; continue; }
      const tile = vram[screenBase + ((py >> 3) << sh) + (px >> 3)];
      const ci = vram[charBase + (tile << 6) + ((py & 7) << 3) + (px & 7)];
      out[x] = ci ? pal[ci] & 0x7FFF : 0x8000;
    }
  }
  renderBitmap(mode, dispcnt) {
    const io = this.io16, vram = this.vram, vram16 = this.vram16, pal = this.pal16, out = this.bgLine[2];
    let fx = this.affX[0], fy = this.affY[0];
    const pa = (io[0x20 >> 1] << 16) >> 16, pc = (io[0x24 >> 1] << 16) >> 16;
    const page = (dispcnt & 0x10) ? 0xA000 : 0, w = mode === 5 ? 160 : 240, h = mode === 5 ? 128 : 160;
    for (let x = 0; x < 240; x++) {
      const px = fx >> 8, py = fy >> 8; fx += pa; fy += pc;
      if (px < 0 || py < 0 || px >= w || py >= h) { out[x] = 0x8000; continue; }
      if (mode === 3) out[x] = vram16[py * 240 + px] & 0x7FFF;
      else if (mode === 4) { const ci = vram[page + py * 240 + px]; out[x] = ci ? pal[ci] & 0x7FFF : 0x8000; }
      else out[x] = vram16[(page >> 1) + py * 160 + px] & 0x7FFF;
    }
  }
  renderObj(y, dispcnt, mode) {
    const oam = this.oam16, vram = this.vram, pal = this.pal16;
    const objLine = this.objLine, objPri = this.objPri, objSemi = this.objSemi, objWin = this.objWin;
    objPri.fill(4); objSemi.fill(0); objWin.fill(0);
    const map1D = dispcnt & 0x40, bitmap = mode >= 3; let anySemi = false;
    for (let i = 0; i < 128; i++) {
      const a0 = oam[i * 4], aff = a0 & 0x100;
      if (!aff && (a0 & 0x200)) continue;
      const gfx = (a0 >> 10) & 3; if (gfx === 3) continue;
      const a1 = oam[i * 4 + 1], a2 = oam[i * 4 + 2];
      const w = OBJ_W[a0 >> 14][a1 >> 14], h = OBJ_H[a0 >> 14][a1 >> 14];
      const dbl = aff && (a0 & 0x200), bw = dbl ? w * 2 : w, bh = dbl ? h * 2 : h;
      let sy = a0 & 0xFF; if (sy + bh > 256) sy -= 256;
      if (y < sy || y >= sy + bh) continue;
      let sx = a1 & 0x1FF; if (sx >= 240) sx -= 512;
      if (sx + bw <= 0) continue;
      const tileBase = a2 & 0x3FF; if (bitmap && tileBase < 512) continue;
      const prio = (a2 >> 10) & 3, is8 = a0 & 0x2000, palBase = 256 + (is8 ? 0 : (a2 >> 12) << 4);
      const line = y - sy, rowStride = map1D ? (is8 ? w >> 2 : w >> 3) : 32;
      let pa = 0x100, pb = 0, pc = 0, pd = 0x100, hflip = 0, vflip = 0;
      if (aff) { const p = ((a1 >> 9) & 0x1F) * 16; pa = (oam[p + 3] << 16) >> 16; pb = (oam[p + 7] << 16) >> 16; pc = (oam[p + 11] << 16) >> 16; pd = (oam[p + 15] << 16) >> 16; }
      else { hflip = a1 & 0x1000; vflip = a1 & 0x2000; }
      const hw = bw >> 1, iy = line - (bh >> 1);
      for (let k = 0; k < bw; k++) {
        const x = sx + k; if (x < 0 || x >= 240) continue;
        let tx, ty;
        if (aff) { const ix = k - hw; tx = ((pa * ix + pb * iy) >> 8) + (w >> 1); ty = ((pc * ix + pd * iy) >> 8) + (h >> 1); if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue; }
        else { tx = hflip ? w - 1 - k : k; ty = vflip ? h - 1 - line : line; }
        let ci;
        if (is8) { const tile = (tileBase + (ty >> 3) * rowStride + ((tx >> 3) << 1)) & 0x3FF; ci = vram[0x10000 + (tile << 5) + ((ty & 7) << 3) + (tx & 7)]; }
        else { const tile = (tileBase + (ty >> 3) * rowStride + (tx >> 3)) & 0x3FF; const v = vram[0x10000 + (tile << 5) + ((ty & 7) << 2) + ((tx & 7) >> 1)]; ci = (tx & 1) ? v >> 4 : v & 15; }
        if (!ci) continue;
        if (gfx === 2) { objWin[x] = 1; continue; }
        if (prio < objPri[x]) { objLine[x] = pal[palBase + ci] & 0x7FFF; objPri[x] = prio; objSemi[x] = gfx === 1 ? 1 : 0; if (gfx === 1) anySemi = true; }
      }
    }
    this.anySemi = anySemi;
  }

  // ================= CPU ARM7TDMI =================
  bankOf(m) { switch (m) { case 0x11: return 1; case 0x12: return 2; case 0x13: return 3; case 0x17: return 4; case 0x1B: return 5; default: return 0; } }
  switchMode(m) {
    if (m === this.mode) return;
    const ob = this.bankOf(this.mode), nb = this.bankOf(m), r = this.r;
    if (ob !== nb) {
      this.bank13[ob] = r[13]; this.bank14[ob] = r[14]; r[13] = this.bank13[nb]; r[14] = this.bank14[nb];
      if (ob === 1) { for (let i = 0; i < 5; i++) { this.fiqHi[i] = r[8 + i]; r[8 + i] = this.usrHi[i]; } }
      else if (nb === 1) { for (let i = 0; i < 5; i++) { this.usrHi[i] = r[8 + i]; r[8 + i] = this.fiqHi[i]; } }
    }
    this.mode = m;
  }
  getCpsr() { return (this.cN << 31) | (this.cZ << 30) | (this.cC << 29) | (this.cV << 28) | (this.cI << 7) | (this.cF << 6) | (this.cT << 5) | this.mode; }
  setCpsr(v) {
    this.switchMode((v & 0x1F) | 0x10);
    this.cN = v >>> 31; this.cZ = (v >>> 30) & 1; this.cC = (v >>> 29) & 1; this.cV = (v >>> 28) & 1;
    this.cI = (v >>> 7) & 1; this.cF = (v >>> 6) & 1; this.cT = (v >>> 5) & 1;
  }
  restoreCpsr() { const b = this.bankOf(this.mode); if (b) this.setCpsr(this.spsr[b]); }
  flush() { const r = this.r; if (this.cT) r[15] = (r[15] & ~1) + 2; else r[15] = (r[15] & ~3) + 4; this.cycles += 2; }
  enterIrq() {
    const r = this.r, next = this.cT ? r[15] - 2 : r[15] - 4, cpsr = this.getCpsr();
    this.switchMode(0x12); this.spsr[2] = cpsr;
    r[14] = next + 4; this.cT = 0; this.cI = 1; r[15] = 0x1C;
    this.halted = false; this.cycles += 3;
  }
  testCond(c) {
    switch (c) {
      case 0: return this.cZ === 1; case 1: return this.cZ === 0;
      case 2: return this.cC === 1; case 3: return this.cC === 0;
      case 4: return this.cN === 1; case 5: return this.cN === 0;
      case 6: return this.cV === 1; case 7: return this.cV === 0;
      case 8: return this.cC === 1 && this.cZ === 0; case 9: return this.cC === 0 || this.cZ === 1;
      case 10: return this.cN === this.cV; case 11: return this.cN !== this.cV;
      case 12: return this.cZ === 0 && this.cN === this.cV; case 13: return this.cZ === 1 || this.cN !== this.cV;
      case 14: return true;
    }
    return false;
  }
  run() {
    const r = this.r, rom32 = this.rom32, rom16 = this.rom16, romMask = this.romMask, iw32 = this.iwram32, iw16 = this.iwram16;
    while (this.cycles < this.tgt) {
      if (this.irqLine && this.ime && this.cI === 0) this.enterIrq();
      if (this.halted) { this.cycles = this.tgt; return; }
      const pc = r[15];
      if (this.cT) {
        const a = (pc - 2) >>> 0, reg = a >>> 24; let op;
        if (reg >= 8 && reg < 14) { op = rom16[(a & romMask) >> 1]; this.cycles += 2; }
        else if (reg === 3) { op = iw16[(a & 0x7FFE) >> 1]; this.cycles += 1; }
        else { op = this.read16(a); this.cycles += reg === 2 ? 3 : 1; }
        r[15] = pc + 2;
        this.thumb(op);
      } else {
        const a = (pc - 4) >>> 0, reg = a >>> 24; let op;
        if (reg >= 8 && reg < 14) { op = rom32[(a & romMask) >> 2]; this.cycles += 3; }
        else if (reg === 3) { op = iw32[(a & 0x7FFC) >> 2]; this.cycles += 1; }
        else { op = this.read32(a); this.cycles += reg === 2 ? 5 : 1; }
        r[15] = pc + 4;
        const cond = op >>> 28;
        if (cond === 14 || this.testCond(cond)) this.arm(op);
      }
    }
  }
  shiftImm(op) {
    const rm = this.r[op & 15], amt = (op >>> 7) & 31;
    switch ((op >>> 5) & 3) {
      case 0: if (amt === 0) { this.sc = this.cC; return rm; } this.sc = (rm >>> (32 - amt)) & 1; return rm << amt;
      case 1: if (amt === 0) { this.sc = rm >>> 31; return 0; } this.sc = (rm >>> (amt - 1)) & 1; return rm >>> amt;
      case 2: if (amt === 0) { this.sc = rm >>> 31; return rm >> 31; } this.sc = (rm >>> (amt - 1)) & 1; return rm >> amt;
      default: if (amt === 0) { this.sc = rm & 1; return (this.cC << 31) | (rm >>> 1); } { const v = (rm >>> amt) | (rm << (32 - amt)); this.sc = v >>> 31; return v; }
    }
  }
  shiftReg(op) {
    const r = this.r; let rm = r[op & 15]; if ((op & 15) === 15) rm += 4;
    const amt = r[(op >>> 8) & 15] & 0xFF;
    if (amt === 0) { this.sc = this.cC; return rm; }
    switch ((op >>> 5) & 3) {
      case 0: if (amt < 32) { this.sc = (rm >>> (32 - amt)) & 1; return rm << amt; } this.sc = amt === 32 ? rm & 1 : 0; return 0;
      case 1: if (amt < 32) { this.sc = (rm >>> (amt - 1)) & 1; return rm >>> amt; } this.sc = amt === 32 ? rm >>> 31 : 0; return 0;
      case 2: if (amt < 32) { this.sc = (rm >>> (amt - 1)) & 1; return rm >> amt; } this.sc = rm >>> 31; return rm >> 31;
      default: { const k = amt & 31; if (k === 0) { this.sc = rm >>> 31; return rm; } const v = (rm >>> k) | (rm << (32 - k)); this.sc = v >>> 31; return v; }
    }
  }
  dataProc(op, a, b) {
    const r = this.r, S = op & 0x100000, rd = (op >>> 12) & 15, opc = (op >>> 21) & 15;
    b |= 0; let res;
    switch (opc) {
      case 0: case 8: res = a & b; if (S) this.cC = this.sc; break;
      case 1: case 9: res = a ^ b; if (S) this.cC = this.sc; break;
      case 2: case 10: res = (a - b) | 0; if (S) { this.cC = (a >>> 0) >= (b >>> 0) ? 1 : 0; this.cV = ((a ^ b) & (a ^ res)) >>> 31; } break;
      case 3: res = (b - a) | 0; if (S) { this.cC = (b >>> 0) >= (a >>> 0) ? 1 : 0; this.cV = ((b ^ a) & (b ^ res)) >>> 31; } break;
      case 4: case 11: res = (a + b) | 0; if (S) { this.cC = (res >>> 0) < (a >>> 0) ? 1 : 0; this.cV = (~(a ^ b) & (a ^ res)) >>> 31; } break;
      case 5: { const f = (a >>> 0) + (b >>> 0) + this.cC; res = f | 0; if (S) { this.cC = f > 0xFFFFFFFF ? 1 : 0; this.cV = (~(a ^ b) & (a ^ res)) >>> 31; } break; }
      case 6: { const c = this.cC; res = (a - b - 1 + c) | 0; if (S) { this.cC = (a >>> 0) >= (b >>> 0) + 1 - c ? 1 : 0; this.cV = ((a ^ b) & (a ^ res)) >>> 31; } break; }
      case 7: { const c = this.cC; res = (b - a - 1 + c) | 0; if (S) { this.cC = (b >>> 0) >= (a >>> 0) + 1 - c ? 1 : 0; this.cV = ((b ^ a) & (b ^ res)) >>> 31; } break; }
      case 12: res = a | b; if (S) this.cC = this.sc; break;
      case 13: res = b; if (S) this.cC = this.sc; break;
      case 14: res = a & ~b; if (S) this.cC = this.sc; break;
      default: res = ~b; if (S) this.cC = this.sc; break;
    }
    if (S) { this.cN = res >>> 31; this.cZ = res === 0 ? 1 : 0; }
    if (opc < 8 || opc >= 12) {
      if (rd === 15) { if (S) this.restoreCpsr(); r[15] = res; this.flush(); }
      else r[rd] = res;
    } else if (rd === 15 && S) this.restoreCpsr();
  }
  mull(a, b, signed) {
    const au = a >>> 0, bu = b >>> 0, al = au & 0xFFFF, ah = au >>> 16, bl = bu & 0xFFFF, bh = bu >>> 16;
    const t0 = al * bl, t1 = ah * bl + Math.floor(t0 / 65536), t2 = al * bh + (t1 % 65536);
    let hi = ah * bh + Math.floor(t1 / 65536) + Math.floor(t2 / 65536);
    if (signed) { if (a < 0) hi -= bu; if (b < 0) hi -= au; }
    this.mlo = Math.imul(a, b); this.mhi = hi | 0;
  }
  msr(op, val) {
    let mask = 0; if (op & 0x80000) mask |= 0xFF000000; if (op & 0x10000) mask |= 0xFF;
    if (op & 0x00400000) { const b = this.bankOf(this.mode); if (b) this.spsr[b] = (this.spsr[b] & ~mask) | (val & mask); }
    else { if (this.mode === 0x10) mask &= 0xFF000000; const t = this.cT; this.setCpsr((this.getCpsr() & ~mask) | (val & mask)); this.cT = t; }
  }
  arm(op) {
    const r = this.r;
    switch ((op >>> 25) & 7) {
      case 0: {
        if ((op & 0x0FFFFFF0) === 0x012FFF10) { // BX
          const t = r[op & 15];
          if (t & 1) { this.cT = 1; r[15] = (t & ~1) + 2; } else r[15] = (t & ~3) + 4;
          this.cycles += 2; return;
        }
        if ((op & 0x90) === 0x90) {
          if ((op & 0x60) === 0) {
            if (op & 0x01000000) { // SWP
              const addr = r[(op >>> 16) & 15], rd = (op >>> 12) & 15, src = r[op & 15];
              if (op & 0x00400000) { const v = this.read8(addr); this.write8(addr, src & 0xFF); r[rd] = v; }
              else { let v = this.read32(addr); const rot = (addr & 3) << 3; if (rot) v = (v >>> rot) | (v << (32 - rot)); this.write32(addr, src); r[rd] = v; }
              this.cycles += 3; return;
            }
            const rs = r[(op >>> 8) & 15], rm = r[op & 15], S = op & 0x100000;
            if (op & 0x00800000) { // multiplicação longa
              const hiR = (op >>> 16) & 15, loR = (op >>> 12) & 15;
              this.mull(rm, rs, (op & 0x00400000) !== 0);
              if (op & 0x00200000) { const lo2 = (this.mlo >>> 0) + (r[loR] >>> 0); this.mhi = (this.mhi + r[hiR] + (lo2 > 0xFFFFFFFF ? 1 : 0)) | 0; this.mlo = lo2 | 0; }
              r[loR] = this.mlo; r[hiR] = this.mhi;
              if (S) { this.cN = this.mhi >>> 31; this.cZ = (this.mlo | this.mhi) === 0 ? 1 : 0; }
              this.cycles += 3; return;
            }
            let res = Math.imul(rm, rs); if (op & 0x00200000) res = (res + r[(op >>> 12) & 15]) | 0;
            r[(op >>> 16) & 15] = res;
            if (S) { this.cN = res >>> 31; this.cZ = res === 0 ? 1 : 0; }
            this.cycles += 2; return;
          }
          // LDRH / STRH / LDRSB / LDRSH
          const rn = (op >>> 16) & 15, rd = (op >>> 12) & 15, P = op & 0x01000000, sh = (op >>> 5) & 3;
          let off = (op & 0x00400000) ? ((op >>> 4) & 0xF0) | (op & 0xF) : r[op & 15];
          if (!(op & 0x00800000)) off = -off;
          let addr = r[rn]; if (P) addr = (addr + off) | 0;
          if (op & 0x100000) {
            let v; if (sh === 1) v = this.read16(addr); else if (sh === 2) v = (this.read8(addr) << 24) >> 24; else v = (this.read16(addr) << 16) >> 16;
            if (!P) r[rn] = addr + off; else if (op & 0x00200000) r[rn] = addr;
            r[rd] = v; if (rd === 15) this.flush();
            this.cycles += 2;
          } else {
            if (sh === 1) this.write16(addr, (rd === 15 ? r[15] + 4 : r[rd]) & 0xFFFF);
            if (!P) r[rn] = addr + off; else if (op & 0x00200000) r[rn] = addr;
            this.cycles += 1;
          }
          return;
        }
        if ((op & 0x01900000) === 0x01000000) { // MRS / MSR
          if (op & 0x00200000) this.msr(op, r[op & 15]);
          else { const b = this.bankOf(this.mode); r[(op >>> 12) & 15] = (op & 0x00400000) ? (b ? this.spsr[b] : this.getCpsr()) : this.getCpsr(); }
          return;
        }
        const rn = (op >>> 16) & 15;
        if (op & 0x10) { const b = this.shiftReg(op); this.cycles += 1; this.dataProc(op, rn === 15 ? r[15] + 4 : r[rn], b); }
        else this.dataProc(op, r[rn], this.shiftImm(op));
        return;
      }
      case 1: {
        const imm = op & 0xFF, rot = (op >>> 7) & 0x1E;
        let b = imm; if (rot) { b = (imm >>> rot) | (imm << (32 - rot)); this.sc = b >>> 31; } else this.sc = this.cC;
        if ((op & 0x01900000) === 0x01000000) { if (op & 0x00200000) this.msr(op, b); return; }
        this.dataProc(op, r[(op >>> 16) & 15], b);
        return;
      }
      case 2: case 3: {
        const rn = (op >>> 16) & 15, rd = (op >>> 12) & 15, P = op & 0x01000000;
        let off;
        if (op & 0x02000000) { if (op & 0x10) return; off = this.shiftImm(op) | 0; } else off = op & 0xFFF;
        if (!(op & 0x00800000)) off = -off;
        let addr = r[rn]; if (P) addr = (addr + off) | 0;
        if (op & 0x100000) {
          let v;
          if (op & 0x00400000) v = this.read8(addr);
          else { v = this.read32(addr); const rot = (addr & 3) << 3; if (rot) v = (v >>> rot) | (v << (32 - rot)); }
          if (!P) r[rn] = addr + off; else if (op & 0x00200000) r[rn] = addr;
          r[rd] = v; if (rd === 15) this.flush();
          this.cycles += 2;
        } else {
          const v = rd === 15 ? r[15] + 4 : r[rd];
          if (op & 0x00400000) this.write8(addr, v & 0xFF); else this.write32(addr, v);
          if (!P) r[rn] = addr + off; else if (op & 0x00200000) r[rn] = addr;
          this.cycles += 1;
        }
        return;
      }
      case 4: { // LDM / STM
        const rn = (op >>> 16) & 15, U = op & 0x00800000, S = op & 0x00400000, W = op & 0x00200000, L = op & 0x100000;
        let list = op & 0xFFFF, n = 0;
        for (let i = 0; i < 16; i++) if (list & (1 << i)) n++;
        if (list === 0) { list = 0x8000; n = 16; }
        const base = r[rn], pre = U ? (op & 0x01000000) !== 0 : (op & 0x01000000) === 0;
        let addr = U ? base : (base - n * 4) | 0;
        const newBase = U ? (base + n * 4) | 0 : (base - n * 4) | 0;
        let oldMode = -1;
        if (S && !(L && (list & 0x8000)) && this.bankOf(this.mode) !== 0) { oldMode = this.mode; this.switchMode(0x1F); }
        if (L) {
          if (W) r[rn] = newBase;
          for (let i = 0; i < 16; i++) if (list & (1 << i)) { if (pre) addr += 4; r[i] = this.read32(addr); if (!pre) addr += 4; }
          if (oldMode >= 0) this.switchMode(oldMode);
          if (list & 0x8000) { if (S) this.restoreCpsr(); this.flush(); }
        } else {
          let first = true;
          for (let i = 0; i < 16; i++) if (list & (1 << i)) {
            if (pre) addr += 4;
            let v = r[i]; if (i === 15) v += 4; else if (i === rn && !first && W) v = newBase;
            this.write32(addr, v); if (!pre) addr += 4; first = false;
          }
          if (oldMode >= 0) this.switchMode(oldMode);
          if (W) r[rn] = newBase;
        }
        this.cycles += n + 1;
        return;
      }
      case 5: { // B / BL
        if (op & 0x01000000) r[14] = r[15] - 4;
        r[15] = (r[15] + ((op << 8) >> 6) + 4) | 0;
        this.cycles += 2; return;
      }
      case 7: if (op & 0x01000000) this.swi((op >>> 16) & 0xFF); return;
    }
  }
  thumb(op) {
    const r = this.r;
    switch (op >>> 12) {
      case 0: case 1: {
        const rd = op & 7, v = r[(op >>> 3) & 7], kind = (op >>> 11) & 3; let res;
        if (kind === 3) {
          const b = (op & 0x400) ? (op >>> 6) & 7 : r[(op >>> 6) & 7];
          if (op & 0x200) { res = (v - b) | 0; this.cC = (v >>> 0) >= (b >>> 0) ? 1 : 0; this.cV = ((v ^ b) & (v ^ res)) >>> 31; }
          else { res = (v + b) | 0; this.cC = (res >>> 0) < (v >>> 0) ? 1 : 0; this.cV = (~(v ^ b) & (v ^ res)) >>> 31; }
        } else {
          const amt = (op >>> 6) & 31;
          if (kind === 0) { if (amt === 0) res = v; else { this.cC = (v >>> (32 - amt)) & 1; res = v << amt; } }
          else if (kind === 1) { if (amt === 0) { this.cC = v >>> 31; res = 0; } else { this.cC = (v >>> (amt - 1)) & 1; res = v >>> amt; } }
          else { if (amt === 0) { this.cC = v >>> 31; res = v >> 31; } else { this.cC = (v >>> (amt - 1)) & 1; res = v >> amt; } }
          res |= 0;
        }
        r[rd] = res; this.cN = res >>> 31; this.cZ = res === 0 ? 1 : 0;
        return;
      }
      case 2: case 3: {
        const rd = (op >>> 8) & 7, b = op & 0xFF, a = r[rd]; let res;
        switch ((op >>> 11) & 3) {
          case 0: res = b; r[rd] = res; break;
          case 1: res = (a - b) | 0; this.cC = (a >>> 0) >= b ? 1 : 0; this.cV = ((a ^ b) & (a ^ res)) >>> 31; break;
          case 2: res = (a + b) | 0; this.cC = (res >>> 0) < (a >>> 0) ? 1 : 0; this.cV = (~(a ^ b) & (a ^ res)) >>> 31; r[rd] = res; break;
          default: res = (a - b) | 0; this.cC = (a >>> 0) >= b ? 1 : 0; this.cV = ((a ^ b) & (a ^ res)) >>> 31; r[rd] = res; break;
        }
        this.cN = res >>> 31; this.cZ = res === 0 ? 1 : 0;
        return;
      }
      case 4: {
        if (op & 0x800) { r[(op >>> 8) & 7] = this.read32((r[15] & ~2) + ((op & 0xFF) << 2)); this.cycles += 2; return; }
        if (op & 0x400) {
          const rd = (op & 7) | ((op >>> 4) & 8), rs = (op >>> 3) & 15;
          switch ((op >>> 8) & 3) {
            case 0: r[rd] = (r[rd] + r[rs]) | 0; if (rd === 15) this.flush(); return;
            case 1: { const a = r[rd], b = r[rs], res = (a - b) | 0; this.cC = (a >>> 0) >= (b >>> 0) ? 1 : 0; this.cV = ((a ^ b) & (a ^ res)) >>> 31; this.cN = res >>> 31; this.cZ = res === 0 ? 1 : 0; return; }
            case 2: r[rd] = r[rs]; if (rd === 15) this.flush(); return;
            default: { const t = r[rs]; if (t & 1) r[15] = (t & ~1) + 2; else { this.cT = 0; r[15] = (t & ~3) + 4; } this.cycles += 2; return; }
          }
        }
        const rd = op & 7, a = r[rd], b = r[(op >>> 3) & 7]; let res;
        switch ((op >>> 6) & 15) {
          case 0: res = a & b; break;
          case 1: res = a ^ b; break;
          case 2: { const s = b & 0xFF; if (s === 0) res = a; else if (s < 32) { this.cC = (a >>> (32 - s)) & 1; res = a << s; } else { this.cC = s === 32 ? a & 1 : 0; res = 0; } break; }
          case 3: { const s = b & 0xFF; if (s === 0) res = a; else if (s < 32) { this.cC = (a >>> (s - 1)) & 1; res = a >>> s; } else { this.cC = s === 32 ? a >>> 31 : 0; res = 0; } break; }
          case 4: { const s = b & 0xFF; if (s === 0) res = a; else if (s < 32) { this.cC = (a >>> (s - 1)) & 1; res = a >> s; } else { this.cC = a >>> 31; res = a >> 31; } break; }
          case 5: { const f = (a >>> 0) + (b >>> 0) + this.cC; res = f | 0; this.cC = f > 0xFFFFFFFF ? 1 : 0; this.cV = (~(a ^ b) & (a ^ res)) >>> 31; break; }
          case 6: { const c = this.cC; res = (a - b - 1 + c) | 0; this.cC = (a >>> 0) >= (b >>> 0) + 1 - c ? 1 : 0; this.cV = ((a ^ b) & (a ^ res)) >>> 31; break; }
          case 7: { const s = b & 0xFF; if (s === 0) res = a; else { const k = s & 31; if (k === 0) { this.cC = a >>> 31; res = a; } else { res = (a >>> k) | (a << (32 - k)); this.cC = res >>> 31; } } break; }
          case 8: res = a & b; this.cN = res >>> 31; this.cZ = res === 0 ? 1 : 0; return;
          case 9: res = (0 - b) | 0; this.cC = b === 0 ? 1 : 0; this.cV = (b & res) >>> 31; break;
          case 10: res = (a - b) | 0; this.cC = (a >>> 0) >= (b >>> 0) ? 1 : 0; this.cV = ((a ^ b) & (a ^ res)) >>> 31; this.cN = res >>> 31; this.cZ = res === 0 ? 1 : 0; return;
          case 11: res = (a + b) | 0; this.cC = (res >>> 0) < (a >>> 0) ? 1 : 0; this.cV = (~(a ^ b) & (a ^ res)) >>> 31; this.cN = res >>> 31; this.cZ = res === 0 ? 1 : 0; return;
          case 12: res = a | b; break;
          case 13: res = Math.imul(a, b); this.cycles += 2; break;
          case 14: res = a & ~b; break;
          default: res = ~b; break;
        }
        res |= 0; r[rd] = res; this.cN = res >>> 31; this.cZ = res === 0 ? 1 : 0;
        return;
      }
      case 5: {
        const addr = (r[(op >>> 3) & 7] + r[(op >>> 6) & 7]) | 0, rd = op & 7;
        switch ((op >>> 9) & 7) {
          case 0: this.write32(addr, r[rd]); this.cycles += 1; return;
          case 1: this.write16(addr, r[rd] & 0xFFFF); this.cycles += 1; return;
          case 2: this.write8(addr, r[rd] & 0xFF); this.cycles += 1; return;
          case 3: r[rd] = (this.read8(addr) << 24) >> 24; break;
          case 4: { let v = this.read32(addr); const rot = (addr & 3) << 3; if (rot) v = (v >>> rot) | (v << (32 - rot)); r[rd] = v; break; }
          case 5: r[rd] = this.read16(addr); break;
          case 6: r[rd] = this.read8(addr); break;
          default: r[rd] = (this.read16(addr) << 16) >> 16; break;
        }
        this.cycles += 2; return;
      }
      case 6: {
        const addr = (r[(op >>> 3) & 7] + (((op >>> 6) & 31) << 2)) | 0, rd = op & 7;
        if (op & 0x800) { let v = this.read32(addr); const rot = (addr & 3) << 3; if (rot) v = (v >>> rot) | (v << (32 - rot)); r[rd] = v; this.cycles += 2; }
        else { this.write32(addr, r[rd]); this.cycles += 1; }
        return;
      }
      case 7: {
        const addr = (r[(op >>> 3) & 7] + ((op >>> 6) & 31)) | 0, rd = op & 7;
        if (op & 0x800) { r[rd] = this.read8(addr); this.cycles += 2; } else { this.write8(addr, r[rd] & 0xFF); this.cycles += 1; }
        return;
      }
      case 8: {
        const addr = (r[(op >>> 3) & 7] + (((op >>> 6) & 31) << 1)) | 0, rd = op & 7;
        if (op & 0x800) { r[rd] = this.read16(addr); this.cycles += 2; } else { this.write16(addr, r[rd] & 0xFFFF); this.cycles += 1; }
        return;
      }
      case 9: {
        const addr = (r[13] + ((op & 0xFF) << 2)) | 0, rd = (op >>> 8) & 7;
        if (op & 0x800) { let v = this.read32(addr); const rot = (addr & 3) << 3; if (rot) v = (v >>> rot) | (v << (32 - rot)); r[rd] = v; this.cycles += 2; }
        else { this.write32(addr, r[rd]); this.cycles += 1; }
        return;
      }
      case 10: r[(op >>> 8) & 7] = (((op & 0x800) ? r[13] : (r[15] & ~2)) + ((op & 0xFF) << 2)) | 0; return;
      case 11: {
        if ((op & 0x0F00) === 0) { const off = (op & 0x7F) << 2; r[13] += (op & 0x80) ? -off : off; return; }
        if ((op & 0x0600) !== 0x0400) return;
        const list = op & 0xFF; let n = (op & 0x100) ? 1 : 0;
        for (let i = 0; i < 8; i++) if (list & (1 << i)) n++;
        if (op & 0x800) { // POP
          let addr = r[13];
          for (let i = 0; i < 8; i++) if (list & (1 << i)) { r[i] = this.read32(addr); addr += 4; }
          if (op & 0x100) { r[15] = (this.read32(addr) & ~1) + 2; addr += 4; this.cycles += 2; }
          r[13] = addr;
        } else { // PUSH
          let addr = (r[13] - n * 4) | 0; r[13] = addr;
          for (let i = 0; i < 8; i++) if (list & (1 << i)) { this.write32(addr, r[i]); addr += 4; }
          if (op & 0x100) this.write32(addr, r[14]);
        }
        this.cycles += n + 1;
        return;
      }
      case 12: {
        const rb = (op >>> 8) & 7, list = op & 0xFF; let addr = r[rb], n = 0;
        if (op & 0x800) {
          for (let i = 0; i < 8; i++) if (list & (1 << i)) { r[i] = this.read32(addr); addr += 4; n++; }
          if (!(list & (1 << rb))) r[rb] = addr;
        } else {
          for (let i = 0; i < 8; i++) if (list & (1 << i)) { this.write32(addr, r[i]); addr += 4; n++; }
          r[rb] = addr;
        }
        this.cycles += n + 1;
        return;
      }
      case 13: {
        const cond = (op >>> 8) & 15;
        if (cond === 15) { this.swi(op & 0xFF); return; }
        if (cond !== 14 && this.testCond(cond)) { r[15] = (r[15] + (((op & 0xFF) << 24) >> 23) + 2) | 0; this.cycles += 2; }
        return;
      }
      case 14: r[15] = (r[15] + (((op & 0x7FF) << 21) >> 20) + 2) | 0; this.cycles += 2; return;
      default: {
        if (!(op & 0x800)) r[14] = (r[15] + (((op & 0x7FF) << 21) >> 9)) | 0;
        else { const next = r[15] - 2, t = (r[14] + ((op & 0x7FF) << 1)) | 0; r[14] = next | 1; r[15] = (t & ~1) + 2; this.cycles += 2; }
      }
    }
  }

  // ================= BIOS (emulação de alto nível) =================
  swi(n) {
    const r = this.r;
    this.cycles += 20;
    switch (n) {
      case 0x00: { // SoftReset
        const flag = this.read8(0x03007FFA);
        this.iwram.fill(0, 0x7E00, 0x8000);
        this.switchMode(0x1F); this.cI = 0; this.cT = 0;
        r[13] = 0x03007F00; this.bank13[2] = 0x03007FA0; this.bank13[3] = 0x03007FE0; r[14] = 0;
        r[15] = (flag ? 0x02000000 : 0x08000000) + 4;
        return;
      }
      case 0x01: { // RegisterRamReset
        const f = r[0];
        if (f & 1) this.ewram.fill(0);
        if (f & 2) this.iwram.fill(0, 0, 0x7E00);
        if (f & 4) this.pal.fill(0);
        if (f & 8) this.vram.fill(0);
        if (f & 16) this.oam.fill(0);
        return;
      }
      case 0x02: case 0x03: if (!this.irqLine) { this.halted = true; this.tgt = 0; } return;
      case 0x05: r[0] = 1; r[1] = 1; // VBlankIntrWait
      // falls through
      case 0x04: { // IntrWait
        const flags = r[1] & 0x3FFF, cur = this.read16(0x03007FF8);
        if (!this.intrWaiting) {
          this.intrWaiting = true; this.ime = 1;
          if (r[0] & 1) { this.write16(0x03007FF8, cur & ~flags); this.waitAgain(); return; }
        }
        if (cur & flags) { this.write16(0x03007FF8, cur & ~flags); this.intrWaiting = false; return; }
        this.waitAgain();
        return;
      }
      case 0x06: case 0x07: { // Div / DivArm
        let num = r[0], den = r[1]; if (n === 7) { num = r[1]; den = r[0]; }
        if (den === 0) { r[0] = num < 0 ? -1 : 1; r[1] = num; r[3] = 1; return; }
        const q = (num / den) | 0; r[0] = q; r[1] = (num - Math.imul(q, den)) | 0; r[3] = q < 0 ? -q : q;
        return;
      }
      case 0x08: r[0] = Math.floor(Math.sqrt(r[0] >>> 0)); return;
      case 0x09: { // ArcTan
        const i = (r[0] << 16) >> 16, a = -((i * i) >> 14);
        let b = ((0xA9 * a) >> 14) + 0x390;
        b = ((b * a) >> 14) + 0x91C; b = ((b * a) >> 14) + 0xFB6; b = ((b * a) >> 14) + 0x16AA;
        b = ((b * a) >> 14) + 0x2081; b = ((b * a) >> 14) + 0x3651; b = ((b * a) >> 14) + 0xA2F9;
        r[0] = (i * b) >> 16; return;
      }
      case 0x0A: { // ArcTan2
        const x = (r[0] << 16) >> 16, y = (r[1] << 16) >> 16;
        r[0] = Math.round(Math.atan2(y, x) / (2 * Math.PI) * 65536) & 0xFFFF; return;
      }
      case 0x0B: { // CpuSet
        let src = r[0], dst = r[1]; const cnt = r[2] & 0x1FFFFF, fill = r[2] & 0x01000000;
        if (r[2] & 0x04000000) { src &= ~3; dst &= ~3; if (fill) { const v = this.read32(src); for (let i = 0; i < cnt; i++) this.write32(dst + i * 4, v); } else for (let i = 0; i < cnt; i++) this.write32(dst + i * 4, this.read32(src + i * 4)); }
        else { src &= ~1; dst &= ~1; if (fill) { const v = this.read16(src); for (let i = 0; i < cnt; i++) this.write16(dst + i * 2, v); } else for (let i = 0; i < cnt; i++) this.write16(dst + i * 2, this.read16(src + i * 2)); }
        this.cycles += cnt * 4; return;
      }
      case 0x0C: { // CpuFastSet
        const src = r[0] & ~3, dst = r[1] & ~3, cnt = ((r[2] & 0x1FFFFF) + 7) & ~7;
        if (r[2] & 0x01000000) { const v = this.read32(src); for (let i = 0; i < cnt; i++) this.write32(dst + i * 4, v); }
        else for (let i = 0; i < cnt; i++) this.write32(dst + i * 4, this.read32(src + i * 4));
        this.cycles += cnt * 2; return;
      }
      case 0x0D: r[0] = 0xBAAE187F | 0; return;
      case 0x0E: { // BgAffineSet
        let src = r[0], dst = r[1];
        for (let i = r[2]; i > 0; i--) {
          const ox = this.read32(src) / 256, oy = this.read32(src + 4) / 256;
          const cx = (this.read16(src + 8) << 16) >> 16, cy = (this.read16(src + 10) << 16) >> 16;
          const sx = ((this.read16(src + 12) << 16) >> 16) / 256, sy = ((this.read16(src + 14) << 16) >> 16) / 256;
          const th = (this.read16(src + 16) >> 8) / 128 * Math.PI;
          const a = Math.cos(th) * sx, b = -Math.sin(th) * sx, c = Math.sin(th) * sy, d = Math.cos(th) * sy;
          this.write16(dst, (a * 256) & 0xFFFF); this.write16(dst + 2, (b * 256) & 0xFFFF); this.write16(dst + 4, (c * 256) & 0xFFFF); this.write16(dst + 6, (d * 256) & 0xFFFF);
          this.write32(dst + 8, ((ox - (a * cx + b * cy)) * 256) | 0); this.write32(dst + 12, ((oy - (c * cx + d * cy)) * 256) | 0);
          src += 20; dst += 16;
        }
        return;
      }
      case 0x0F: { // ObjAffineSet
        let src = r[0], dst = r[1]; const step = r[3];
        for (let i = r[2]; i > 0; i--) {
          const sx = ((this.read16(src) << 16) >> 16) / 256, sy = ((this.read16(src + 2) << 16) >> 16) / 256;
          const th = (this.read16(src + 4) >> 8) / 128 * Math.PI;
          const a = Math.cos(th) * sx, b = -Math.sin(th) * sx, c = Math.sin(th) * sy, d = Math.cos(th) * sy;
          this.write16(dst, (a * 256) & 0xFFFF); this.write16(dst + step, (b * 256) & 0xFFFF); this.write16(dst + step * 2, (c * 256) & 0xFFFF); this.write16(dst + step * 3, (d * 256) & 0xFFFF);
          src += 8; dst += step * 4;
        }
        return;
      }
      case 0x10: { // BitUnPack
        let src = r[0], dst = r[1]; const info = r[2];
        const len = this.read16(info), sw = this.read8(info + 2), dw = this.read8(info + 3), ofsRaw = this.read32(info + 4);
        const ofs = ofsRaw & 0x7FFFFFFF, zero = ofsRaw < 0;
        let outv = 0, outBits = 0;
        for (let i = 0; i < len; i++) {
          const byte = this.read8(src++);
          for (let k = 0; k < 8; k += sw) {
            let v = (byte >> k) & ((1 << sw) - 1);
            if (v || zero) v += ofs;
            outv |= v << outBits; outBits += dw;
            if (outBits >= 32) { this.write32(dst, outv); dst += 4; outv = 0; outBits = 0; }
          }
        }
        return;
      }
      case 0x11: case 0x12: { // LZ77
        let src = r[0]; const hdr = this.read32(src); src += 4;
        const total = hdr >>> 8, o = new Uint8Array(total); let p = 0;
        while (p < total) {
          let flags = this.read8(src++);
          for (let i = 0; i < 8 && p < total; i++, flags <<= 1) {
            if (flags & 0x80) {
              const b1 = this.read8(src++), b2 = this.read8(src++);
              let len = (b1 >> 4) + 3; const disp = (((b1 & 0xF) << 8) | b2) + 1;
              while (len-- > 0 && p < total) { o[p] = p >= disp ? o[p - disp] : 0; p++; }
            } else o[p++] = this.read8(src++);
          }
        }
        this.biosOut(r[1], o, n === 0x12); return;
      }
      case 0x13: { // Huffman
        let src = r[0]; const hdr = this.read32(src); let remaining = hdr >>> 8; const bits = (hdr & 0xF) || 8;
        const o = new Uint8Array((remaining + 3) & ~3); let p = 0;
        const treeBase = src + 5; src += 5 + ((this.read8(src + 4) << 1) + 1);
        let np = treeBase, node = this.read8(np), block = 0, seen = 0;
        while (remaining > 0) {
          let stream = this.read32(src); src += 4;
          for (let k = 32; k > 0 && remaining > 0; k--, stream <<= 1) {
            const next = (np & ~1) + ((node & 0x3F) << 1) + 2; let leaf;
            if (stream < 0) { if (node & 0x40) leaf = this.read8(next + 1); else { np = next + 1; node = this.read8(np); continue; } }
            else { if (node & 0x80) leaf = this.read8(next); else { np = next; node = this.read8(np); continue; } }
            block |= (leaf & ((1 << bits) - 1)) << seen; seen += bits; np = treeBase; node = this.read8(np);
            if (seen === 32) { o[p++] = block & 0xFF; o[p++] = (block >>> 8) & 0xFF; o[p++] = (block >>> 16) & 0xFF; o[p++] = block >>> 24; seen = 0; block = 0; remaining -= 4; }
          }
        }
        this.biosOut(r[1], o, true); return;
      }
      case 0x14: case 0x15: { // RLE
        let src = r[0]; const hdr = this.read32(src); src += 4;
        const total = hdr >>> 8, o = new Uint8Array(total); let p = 0;
        while (p < total) {
          const f = this.read8(src++);
          if (f & 0x80) { let len = (f & 0x7F) + 3; const b = this.read8(src++); while (len-- > 0 && p < total) o[p++] = b; }
          else { let len = (f & 0x7F) + 1; while (len-- > 0 && p < total) o[p++] = this.read8(src++); }
        }
        this.biosOut(r[1], o, n === 0x15); return;
      }
      case 0x16: case 0x17: case 0x18: { // filtros Diff
        let src = r[0]; const hdr = this.read32(src); src += 4;
        const total = hdr >>> 8, o = new Uint8Array(total);
        if (n === 0x18) { let acc = 0; for (let p = 0; p + 1 < total; p += 2) { acc = (acc + this.read16(src + p)) & 0xFFFF; o[p] = acc & 0xFF; o[p + 1] = acc >> 8; } }
        else { let acc = 0; for (let p = 0; p < total; p++) { acc = (acc + this.read8(src + p)) & 0xFF; o[p] = acc; } }
        this.biosOut(r[1], o, n !== 0x16); return;
      }
      case 0x1F: { // MidiKey2Freq
        const freq = this.read32(r[0] + 4) >>> 0;
        r[0] = (freq / Math.pow(2, (180 - r[1] - (r[2] >>> 0) / 256) / 12)) >>> 0; return;
      }
      case 0x25: r[0] = 1; return;
    }
  }
  waitAgain() {
    const r = this.r;
    r[15] -= this.cT ? 2 : 4; // executa o SWI de novo depois da interrupção
    if (!this.irqLine) { this.halted = true; this.tgt = 0; }
  }
  biosOut(dst, o, wide) {
    if (wide) { dst &= ~1; for (let p = 0; p + 1 < o.length; p += 2) this.write16(dst + p, o[p] | (o[p + 1] << 8)); if (o.length & 1) this.write16(dst + o.length - 1, o[o.length - 1]); }
    else for (let p = 0; p < o.length; p++) this.write8(dst + p, o[p]);
    this.cycles += o.length * 4;
  }

  // ================= Save state =================
  static SCALARS = ['mode', 'cN', 'cZ', 'cC', 'cV', 'cI', 'cF', 'cT', 'cycles', 'lineEnd', 'audioT', 'halted', 'intrWaiting', 'ie', 'if_', 'ime',
    'dispstat', 'vcount', 'eeAddrBits', 'eeReadAddr', 'eeReadPos', 'saveUsed'];
  static ARRAYS = ['ewram', 'iwram', 'pal', 'vram', 'oam', 'io', 'r', 'bank13', 'bank14', 'spsr', 'fiqHi', 'usrHi', 'affX', 'affY', 'saveData'];
  saveState() {
    const s = { v: 1, sys: 'gba', title: this.title, sc: {}, ar: {} };
    for (const k of GBA.SCALARS) s.sc[k] = this[k];
    for (const k of GBA.ARRAYS) s.ar[k] = this[k].slice();
    s.timers = this.timers.map(t => ({ ...t, ovf: t.ovf === Infinity ? -1 : t.ovf }));
    s.dma = this.dma.map(d => ({ ...d }));
    s.fifo = this.fifo.map(f => ({ buf: f.buf.slice(), rd: f.rd, wr: f.wr, n: f.n, cur: f.cur, timer: f.timer }));
    s.fl = { ...this.fl }; s.apu = this.apu.getState();
    return s;
  }
  loadState(s) {
    if (s.sys !== 'gba') throw new Error('estado de outro console');
    for (const k of GBA.SCALARS) if (k in s.sc) this[k] = s.sc[k];
    for (const k of GBA.ARRAYS) if (s.ar[k] && s.ar[k].length === this[k].length) this[k].set(s.ar[k]);
    s.timers.forEach((t, i) => Object.assign(this.timers[i], t, { ovf: t.ovf < 0 ? Infinity : t.ovf }));
    s.dma.forEach((d, i) => Object.assign(this.dma[i], d));
    s.fifo.forEach((f, i) => { const g = this.fifo[i]; g.buf.set(f.buf); g.rd = f.rd; g.wr = f.wr; g.n = f.n; g.cur = f.cur; g.timer = f.timer; });
    Object.assign(this.fl, s.fl); this.apu.setState(s.apu);
    this.updNextTimer(); this.updateIrq(); if (s.sc.halted) this.halted = true;
    this.saveDirty = true; this.audioLen = 0;
  }
}
if (typeof module !== 'undefined') module.exports = { GBA };
