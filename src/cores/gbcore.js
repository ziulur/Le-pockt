// ===== Núcleo do emulador Game Boy / Game Boy Color =====
'use strict';
const FZ = 0x80, FN = 0x40, FH = 0x20, FC = 0x10;

// ---------- Cartucho / MBC ----------
class Cart {
  constructor(rom) {
    this.rom = rom;
    this.type = rom[0x147];
    const t = this.type;
    this.mbc = 0;
    if (t >= 1 && t <= 3) this.mbc = 1;
    else if (t === 5 || t === 6) this.mbc = 2;
    else if (t >= 0x0F && t <= 0x13) this.mbc = 3;
    else if (t >= 0x19 && t <= 0x1E) this.mbc = 5;
    this.hasBattery = [0x03, 0x06, 0x09, 0x0D, 0x0F, 0x10, 0x13, 0x1B, 0x1E].includes(t);
    this.hasRtc = t === 0x0F || t === 0x10;
    const ramSizes = [0, 2048, 8192, 32768, 131072, 65536];
    let ramSize = ramSizes[rom[0x149]] || 0;
    if (this.mbc === 2) ramSize = 512;
    if (this.mbc === 3 || this.mbc === 5 || this.mbc === 1) ramSize = Math.max(ramSize, rom[0x149] ? ramSize : 0);
    this.ram = new Uint8Array(Math.max(ramSize, 1));
    this.ramSize = ramSize;
    this.romBanks = Math.max(2, rom.length >> 14);
    this.ramBanks = Math.max(1, ramSize >> 13);
    this.ramEnable = false;
    this.bank1 = 1; this.bank2 = 0; this.mode = 0;
    this.romBank = 1; this.ramBank = 0;
    // RTC
    this.rtc = new Uint8Array(5); this.rtcLatched = new Uint8Array(5);
    this.rtcBase = Date.now() / 1000; this.latchPrev = 0xFF;
    this.dirty = false;
    this.romOff0 = 0; this.romOff1 = 0x4000; this.ramOff = 0;
    this.update();
  }
  update() {
    const nb = this.romBanks;
    if (this.mbc === 1) {
      this.romOff0 = this.mode ? (((this.bank2 << 5) % nb) << 14) : 0;
      this.romOff1 = ((((this.bank2 << 5) | this.bank1)) % nb) << 14;
      this.ramOff = this.mode ? ((this.bank2 % this.ramBanks) << 13) : 0;
    } else if (this.mbc === 2) {
      this.romOff1 = (this.romBank % nb) << 14;
    } else if (this.mbc === 3 || this.mbc === 5) {
      this.romOff1 = (this.romBank % nb) << 14;
      this.ramOff = ((this.ramBank & 0xF) % this.ramBanks) << 13;
    }
  }
  read(a) {
    if (a < 0x4000) return this.rom[this.romOff0 + a] ?? 0xFF;
    return this.rom[this.romOff1 + (a - 0x4000)] ?? 0xFF;
  }
  write(a, v) {
    switch (this.mbc) {
      case 1:
        if (a < 0x2000) this.ramEnable = (v & 0xF) === 0xA;
        else if (a < 0x4000) { this.bank1 = (v & 0x1F) || 1; }
        else if (a < 0x6000) this.bank2 = v & 3;
        else this.mode = v & 1;
        break;
      case 2:
        if (a < 0x4000) {
          if (a & 0x100) this.romBank = (v & 0xF) || 1;
          else this.ramEnable = (v & 0xF) === 0xA;
        }
        break;
      case 3:
        if (a < 0x2000) this.ramEnable = (v & 0xF) === 0xA;
        else if (a < 0x4000) this.romBank = (v & 0x7F) || 1;
        else if (a < 0x6000) this.ramBank = v;
        else {
          if (this.latchPrev === 0 && v === 1) { this.rtcUpdate(); this.rtcLatched.set(this.rtc); }
          this.latchPrev = v;
        }
        break;
      case 5:
        if (a < 0x2000) this.ramEnable = (v & 0xF) === 0xA;
        else if (a < 0x3000) this.romBank = (this.romBank & 0x100) | v;
        else if (a < 0x4000) this.romBank = (this.romBank & 0xFF) | ((v & 1) << 8);
        else if (a < 0x6000) this.ramBank = v & 0xF;
        break;
    }
    this.update();
  }
  rtcUpdate() {
    const now = Date.now() / 1000;
    if (this.rtc[4] & 0x40) { this.rtcBase = now; return; } // parado
    let el = Math.floor(now - this.rtcBase);
    if (el <= 0) return;
    this.rtcBase += el;
    let s = this.rtc[0] + el;
    let m = this.rtc[1] + Math.floor(s / 60); s %= 60;
    let h = this.rtc[2] + Math.floor(m / 60); m %= 60;
    let d = (this.rtc[3] | ((this.rtc[4] & 1) << 8)) + Math.floor(h / 24); h %= 24;
    let carry = this.rtc[4] & 0x80;
    if (d > 511) { carry = 0x80; d %= 512; }
    this.rtc[0] = s; this.rtc[1] = m; this.rtc[2] = h; this.rtc[3] = d & 0xFF;
    this.rtc[4] = (this.rtc[4] & 0x40) | carry | ((d >> 8) & 1);
  }
  readRam(a) {
    if (!this.ramEnable && this.mbc !== 0) return 0xFF;
    if (this.mbc === 2) return 0xF0 | this.ram[(a - 0xA000) & 0x1FF];
    if (this.mbc === 3 && this.ramBank >= 8) {
      const i = this.ramBank - 8; return i < 5 ? this.rtcLatched[i] : 0xFF;
    }
    if (!this.ramSize) return 0xFF;
    return this.ram[(this.ramOff + (a - 0xA000)) % this.ramSize];
  }
  writeRam(a, v) {
    if (!this.ramEnable && this.mbc !== 0) return;
    if (this.mbc === 2) { this.ram[(a - 0xA000) & 0x1FF] = v & 0xF; this.dirty = true; return; }
    if (this.mbc === 3 && this.ramBank >= 8) {
      const i = this.ramBank - 8;
      if (i < 5) { this.rtcUpdate(); this.rtc[i] = v; this.rtcLatched[i] = v; this.dirty = true; }
      return;
    }
    if (!this.ramSize) return;
    this.ram[(this.ramOff + (a - 0xA000)) % this.ramSize] = v;
    this.dirty = true;
  }
  // Save de bateria: RAM + RTC
  getSave() {
    if (!this.hasBattery || !this.ramSize && !this.hasRtc) return null;
    const extra = this.hasRtc ? 16 : 0;
    const out = new Uint8Array(this.ramSize + extra);
    out.set(this.ram.subarray(0, this.ramSize));
    if (this.hasRtc) {
      this.rtcUpdate();
      out.set(this.rtc, this.ramSize);
      const dv = new DataView(out.buffer);
      dv.setFloat64(this.ramSize + 8, this.rtcBase, true);
    }
    return out;
  }
  loadSave(d) {
    const n = Math.min(this.ramSize, d.length);
    this.ram.set(d.subarray(0, n));
    if (this.hasRtc && d.length >= this.ramSize + 16) {
      this.rtc.set(d.subarray(this.ramSize, this.ramSize + 5));
      const dv = new DataView(d.buffer, d.byteOffset, d.byteLength);
      const b = dv.getFloat64(this.ramSize + 8, true);
      if (isFinite(b) && b > 0) this.rtcBase = b;
    }
  }
}

// ---------- Som (APU) ----------
const DUTY = [[0,0,0,0,0,0,0,1],[1,0,0,0,0,0,0,1],[1,0,0,0,0,1,1,1],[0,1,1,1,1,1,1,0]];
const NOISE_DIV = [8, 16, 32, 48, 64, 80, 96, 112];
class APU {
  constructor(sampleRate) {
    this.regs = new Uint8Array(0x30);
    this.wave = new Uint8Array(16);
    this.power = true;
    this.setRate(sampleRate || 44100);
    this.buf = new Float32Array(8192); this.bufLen = 0;
    this.seqCounter = 0; this.seqStep = 0;
    // canais
    this.on = new Uint8Array(4);
    this.len = new Int32Array(4); this.lenEn = new Uint8Array(4);
    this.vol = new Int32Array(4); this.envDir = new Int32Array(4); this.envPer = new Int32Array(4); this.envT = new Int32Array(4);
    this.timer = new Int32Array(4); this.freq = new Int32Array(4); this.pos = new Int32Array(4);
    this.sweepT = 0; this.sweepEn = 0; this.shadow = 0;
    this.lfsr = 0x7FFF;
    this.capL = 0; this.capR = 0;
  }
  setRate(r) { this.sampleRate = r; this.cyclesPerSample = 4194304 / r; this.sampleT = 0; }
  dac(i) {
    if (i === 2) return (this.regs[0x0A] & 0x80) !== 0;
    const nr2 = [0x02, 0x07, 0, 0x11][i];
    return (this.regs[nr2] & 0xF8) !== 0;
  }
  read(a) {
    const r = a - 0xFF10;
    if (a >= 0xFF30) return this.wave[a - 0xFF30];
    const masks = [0x80,0x3F,0x00,0xFF,0xBF, 0xFF,0x3F,0x00,0xFF,0xBF, 0x7F,0xFF,0x9F,0xFF,0xBF, 0xFF,0xFF,0x00,0x00,0xBF, 0x00,0x00,0x70];
    if (r === 0x16) return (this.power ? 0x80 : 0) | 0x70 | this.on[0] | (this.on[1] << 1) | (this.on[2] << 2) | (this.on[3] << 3);
    if (r > 0x16) return 0xFF;
    return this.regs[r] | masks[r];
  }
  write(a, v) {
    if (a >= 0xFF30) { this.wave[a - 0xFF30] = v; return; }
    const r = a - 0xFF10;
    if (r === 0x16) {
      const p = (v & 0x80) !== 0;
      if (!p && this.power) { for (let i = 0; i < 0x16; i++) this.regs[i] = 0; this.on.fill(0); }
      if (p && !this.power) { this.seqStep = 0; }
      this.power = p; return;
    }
    if (!this.power) return;
    this.regs[r] = v;
    switch (r) {
      case 0x01: this.len[0] = 64 - (v & 0x3F); break;
      case 0x06: this.len[1] = 64 - (v & 0x3F); break;
      case 0x0B: this.len[2] = 256 - v; break;
      case 0x10: this.len[3] = 64 - (v & 0x3F); break;
      case 0x02: case 0x07: case 0x11: case 0x0A: {
        const i = r === 0x02 ? 0 : r === 0x07 ? 1 : r === 0x11 ? 3 : 2;
        if (!this.dac(i)) this.on[i] = 0;
        break;
      }
      case 0x04: this.lenEn[0] = (v >> 6) & 1; if (v & 0x80) this.trigger(0); break;
      case 0x09: this.lenEn[1] = (v >> 6) & 1; if (v & 0x80) this.trigger(1); break;
      case 0x0E: this.lenEn[2] = (v >> 6) & 1; if (v & 0x80) this.trigger(2); break;
      case 0x13: this.lenEn[3] = (v >> 6) & 1; if (v & 0x80) this.trigger(3); break;
    }
  }
  getFreq(i) { const b = i === 0 ? 0x03 : i === 1 ? 0x08 : 0x0D; return this.regs[b] | ((this.regs[b + 1] & 7) << 8); }
  trigger(i) {
    const R = this.regs;
    if (this.len[i] === 0) this.len[i] = i === 2 ? 256 : 64;
    this.on[i] = this.dac(i) ? 1 : 0;
    if (i < 2) {
      const f = this.getFreq(i); this.freq[i] = f; this.timer[i] = (2048 - f) * 4;
      const nr2 = R[i === 0 ? 0x02 : 0x07];
      this.vol[i] = nr2 >> 4; this.envDir[i] = nr2 & 8 ? 1 : -1; this.envPer[i] = nr2 & 7; this.envT[i] = this.envPer[i] || 8;
      if (i === 0) {
        this.shadow = f;
        const per = (R[0] >> 4) & 7, sh = R[0] & 7;
        this.sweepT = per || 8; this.sweepEn = per || sh ? 1 : 0;
        if (sh && this.sweepCalc() > 2047) this.on[0] = 0;
      }
    } else if (i === 2) {
      const f = this.getFreq(2); this.timer[2] = (2048 - f) * 2; this.pos[2] = 0;
    } else {
      const nr2 = R[0x11];
      this.vol[3] = nr2 >> 4; this.envDir[3] = nr2 & 8 ? 1 : -1; this.envPer[3] = nr2 & 7; this.envT[3] = this.envPer[3] || 8;
      this.lfsr = 0x7FFF; this.timer[3] = this.noisePeriod();
    }
  }
  sweepCalc() {
    const sh = this.regs[0] & 7; let d = this.shadow >> sh;
    return this.regs[0] & 8 ? this.shadow - d : this.shadow + d;
  }
  noisePeriod() { const v = this.regs[0x12]; return NOISE_DIV[v & 7] << (v >> 4); }
  frameSeq() {
    const s = this.seqStep;
    if ((s & 1) === 0) { // comprimento
      for (let i = 0; i < 4; i++) if (this.lenEn[i] && this.len[i] > 0) { if (--this.len[i] === 0) this.on[i] = 0; }
    }
    if (s === 2 || s === 6) { // sweep
      if (--this.sweepT <= 0) {
        const per = (this.regs[0] >> 4) & 7;
        this.sweepT = per || 8;
        if (this.sweepEn && per) {
          const nf = this.sweepCalc();
          if (nf > 2047) this.on[0] = 0;
          else if (this.regs[0] & 7) {
            this.shadow = nf; this.freq[0] = nf;
            this.regs[0x03] = nf & 0xFF; this.regs[0x04] = (this.regs[0x04] & 0xF8) | (nf >> 8);
            if (this.sweepCalc() > 2047) this.on[0] = 0;
          }
        }
      }
    }
    if (s === 7) { // envelope
      for (const i of [0, 1, 3]) {
        if (this.envPer[i] && --this.envT[i] <= 0) {
          this.envT[i] = this.envPer[i];
          const nv = this.vol[i] + this.envDir[i];
          if (nv >= 0 && nv <= 15) this.vol[i] = nv;
        }
      }
    }
    this.seqStep = (s + 1) & 7;
  }
  tick(c) { if (this.power) this.advance(c); this.genSamples(c); }
  advance(c) {
    // canais quadrados
    for (let i = 0; i < 2; i++) {
      this.timer[i] -= c;
      while (this.timer[i] <= 0) { this.timer[i] += (2048 - this.getFreqLive(i)) * 4; this.pos[i] = (this.pos[i] + 1) & 7; }
    }
    // onda
    this.timer[2] -= c;
    while (this.timer[2] <= 0) { this.timer[2] += (2048 - this.getFreq(2)) * 2; this.pos[2] = (this.pos[2] + 1) & 31; }
    // ruído
    this.timer[3] -= c;
    while (this.timer[3] <= 0) {
      this.timer[3] += this.noisePeriod();
      const x = (this.lfsr ^ (this.lfsr >> 1)) & 1;
      this.lfsr = (this.lfsr >> 1) | (x << 14);
      if (this.regs[0x12] & 8) this.lfsr = (this.lfsr & ~0x40) | (x << 6);
    }
    this.seqCounter += c;
    while (this.seqCounter >= 8192) { this.seqCounter -= 8192; this.frameSeq(); }
  }
  getFreqLive(i) { return i === 0 ? (this.regs[0x03] | ((this.regs[0x04] & 7) << 8)) : this.getFreq(1); }
  // mistura instantânea dos 4 canais -> this.mL / this.mR (aprox. -1..1)
  mix() {
    let l = 0, r = 0;
    if (this.power) {
      const R = this.regs, pan = R[0x15];
      let s;
      if (R[0x02] & 0xF8) { s = this.on[0] ? (DUTY[R[0x01] >> 6][this.pos[0]] * this.vol[0]) / 7.5 - 1 : -1; if (pan & 0x10) l += s; if (pan & 0x01) r += s; }
      if (R[0x07] & 0xF8) { s = this.on[1] ? (DUTY[R[0x06] >> 6][this.pos[1]] * this.vol[1]) / 7.5 - 1 : -1; if (pan & 0x20) l += s; if (pan & 0x02) r += s; }
      if (R[0x0A] & 0x80) {
        let o = 0;
        if (this.on[2]) { const b = this.wave[this.pos[2] >> 1]; const n = this.pos[2] & 1 ? b & 0xF : b >> 4; const vc = (R[0x0C] >> 5) & 3; o = vc === 0 ? 0 : n >> (vc - 1); }
        s = o / 7.5 - 1; if (pan & 0x40) l += s; if (pan & 0x04) r += s;
      }
      if (R[0x11] & 0xF8) { s = this.on[3] ? ((~this.lfsr & 1) * this.vol[3]) / 7.5 - 1 : -1; if (pan & 0x80) l += s; if (pan & 0x08) r += s; }
      l *= (((R[0x14] >> 4) & 7) + 1) / 32;
      r *= ((R[0x14] & 7) + 1) / 32;
    }
    this.mL = l; this.mR = r;
  }
  genSamples(c) {
    this.sampleT += c;
    while (this.sampleT >= this.cyclesPerSample) {
      this.sampleT -= this.cyclesPerSample;
      this.mix();
      const l = this.mL, r = this.mR;
      // filtro passa-alta (remove DC)
      const ol = l - this.capL, or = r - this.capR;
      this.capL = l - ol * 0.996; this.capR = r - or * 0.996;
      if (this.bufLen < this.buf.length - 1) { this.buf[this.bufLen++] = ol; this.buf[this.bufLen++] = or; }
    }
  }
  getState() {
    const p = this;
    return { regs: Array.from(p.regs), wave: Array.from(p.wave), power: p.power, seqCounter: p.seqCounter, seqStep: p.seqStep,
      on: Array.from(p.on), len: Array.from(p.len), lenEn: Array.from(p.lenEn), vol: Array.from(p.vol), envDir: Array.from(p.envDir), envPer: Array.from(p.envPer), envT: Array.from(p.envT),
      timer: Array.from(p.timer), freq: Array.from(p.freq), pos: Array.from(p.pos), sweepT: p.sweepT, sweepEn: p.sweepEn, shadow: p.shadow, lfsr: p.lfsr };
  }
  setState(sp) {
    const p = this;
    for (const k of ['regs','wave','on','len','lenEn','vol','envDir','envPer','envT','timer','freq','pos']) p[k].set(sp[k]);
    Object.assign(p, { power: sp.power, seqCounter: sp.seqCounter, seqStep: sp.seqStep, sweepT: sp.sweepT, sweepEn: sp.sweepEn, shadow: sp.shadow, lfsr: sp.lfsr });
  }
}

// ---------- Máquina ----------
const DMG_SHADES = {
  verde: [0xFF0FBC9B, 0xFF0FAC8B, 0xFF306230, 0xFF0F380F].map(x => x),
};
class GB {
  constructor(rom, opts = {}) {
    this.cart = new Cart(rom);
    const cgbFlag = rom[0x143];
    this.cgb = (cgbFlag === 0x80 || cgbFlag === 0xC0) && opts.forceDmg !== true;
    this.title = this.readTitle(rom);
    this.vram = new Uint8Array(0x4000);
    this.wram = new Uint8Array(0x8000);
    this.oam = new Uint8Array(0xA0);
    this.hram = new Uint8Array(0x7F);
    this.io = new Uint8Array(0x80);
    this.bgPal = new Uint8Array(64); this.objPal = new Uint8Array(64);
    this.bgPal.fill(0xFF);
    this.fb = new Uint32Array(160 * 144);
    this.out = new Uint32Array(160 * 144);
    this.bgCi = new Uint8Array(160); this.bgPri = new Uint8Array(160); this.objUsed = new Uint8Array(160);
    this.apu = new APU(opts.sampleRate);
    this.shades = opts.shades || [0xFFD0F8E0, 0xFF70C088, 0xFF566834, 0xFF201808];
    this.keys = 0;
    this.reset();
  }
  readTitle(rom) {
    let s = '';
    for (let i = 0x134; i < 0x144; i++) { const c = rom[i]; if (!c || c > 0x7E) break; s += String.fromCharCode(c); }
    return s.trim() || 'SEM TITULO';
  }
  reset() {
    const c = this.cgb;
    this.a = c ? 0x11 : 0x01; this.f = c ? 0x80 : 0xB0;
    this.b = 0; this.c = c ? 0x00 : 0x13; this.d = c ? 0xFF : 0x00; this.e = c ? 0x56 : 0xD8;
    this.h = c ? 0x00 : 0x01; this.l = c ? 0x0D : 0x4D;
    this.sp = 0xFFFE; this.pc = 0x100;
    this.ime = false; this.eiDelay = 0; this.halted = false;
    this.ie = 0; this.if_ = 0xE1;
    this.divc = 0xABCC; this.tima = 0; this.tma = 0; this.tac = 0xF8;
    this.lcdc = 0x91; this.stat = 0x85; this.scy = 0; this.scx = 0; this.ly = 0; this.lyc = 0;
    this.bgp = 0xFC; this.obp0 = 0xFF; this.obp1 = 0xFF; this.wy = 0; this.wx = 0;
    this.mode = 2; this.dot = 0; this.winLine = 0; this.statLine = false;
    this.joySel = 0x30;
    this.vbank = 0; this.wbank = 1; this.double = false; this.key1 = 0;
    this.bcps = 0; this.ocps = 0;
    this.hdmaSrc = 0; this.hdmaDst = 0; this.hdmaLen = 0; this.hdmaActive = false;
    this.sb = 0; this.sc = 0;
    this.frameReady = false;
    this.cycles = 0;
    const ap = this.apu;
    const init = [[0xFF26,0xF1],[0xFF10,0x80],[0xFF11,0xBF],[0xFF12,0xF3],[0xFF14,0xBF],[0xFF16,0x3F],[0xFF19,0xBF],[0xFF1A,0x7F],[0xFF1B,0xFF],[0xFF1C,0x9F],[0xFF1E,0xBF],[0xFF20,0xFF],[0xFF23,0xBF],[0xFF24,0x77],[0xFF25,0xF3]];
    for (const [a, v] of init) ap.write(a, v);
    ap.on.fill(0); ap.on[0] = 1;
    ap.write(0xFF12, 0x00); // silencia
    if (!c) {
      // paletas de DMG em CGB não usadas
    }
  }

  // ---------- Memória ----------
  rb(a) {
    if (a < 0x8000) return this.cart.read(a);
    if (a < 0xA000) return this.vram[(this.vbank << 13) + (a - 0x8000)];
    if (a < 0xC000) return this.cart.readRam(a);
    if (a < 0xD000) return this.wram[a - 0xC000];
    if (a < 0xE000) return this.wram[(this.wbank << 12) + (a - 0xD000)];
    if (a < 0xFE00) return this.rb(a - 0x2000);
    if (a < 0xFEA0) return this.oam[a - 0xFE00];
    if (a < 0xFF00) return 0xFF;
    if (a < 0xFF80) return this.ioRead(a);
    if (a < 0xFFFF) return this.hram[a - 0xFF80];
    return this.ie;
  }
  wb(a, v) {
    v &= 0xFF;
    if (a < 0x8000) { this.cart.write(a, v); return; }
    if (a < 0xA000) { this.vram[(this.vbank << 13) + (a - 0x8000)] = v; return; }
    if (a < 0xC000) { this.cart.writeRam(a, v); return; }
    if (a < 0xD000) { this.wram[a - 0xC000] = v; return; }
    if (a < 0xE000) { this.wram[(this.wbank << 12) + (a - 0xD000)] = v; return; }
    if (a < 0xFE00) { this.wb(a - 0x2000, v); return; }
    if (a < 0xFEA0) { this.oam[a - 0xFE00] = v; return; }
    if (a < 0xFF00) return;
    if (a < 0xFF80) { this.ioWrite(a, v); return; }
    if (a < 0xFFFF) { this.hram[a - 0xFF80] = v; return; }
    this.ie = v;
  }
  ioRead(a) {
    switch (a) {
      case 0xFF00: {
        let r = 0xF;
        if (!(this.joySel & 0x10)) r &= ~(this.keys & 0xF);
        if (!(this.joySel & 0x20)) r &= ~((this.keys >> 4) & 0xF);
        return 0xC0 | this.joySel | r;
      }
      case 0xFF01: return this.sb;
      case 0xFF02: return this.sc | 0x7E;
      case 0xFF04: return this.divc >> 8;
      case 0xFF05: return this.tima;
      case 0xFF06: return this.tma;
      case 0xFF07: return this.tac | 0xF8;
      case 0xFF0F: return this.if_ | 0xE0;
      case 0xFF40: return this.lcdc;
      case 0xFF41: return 0x80 | (this.stat & 0x78) | (this.ly === this.lyc ? 4 : 0) | ((this.lcdc & 0x80) ? this.mode : 0);
      case 0xFF42: return this.scy;
      case 0xFF43: return this.scx;
      case 0xFF44: return this.ly;
      case 0xFF45: return this.lyc;
      case 0xFF46: return this.io[0x46];
      case 0xFF47: return this.bgp;
      case 0xFF48: return this.obp0;
      case 0xFF49: return this.obp1;
      case 0xFF4A: return this.wy;
      case 0xFF4B: return this.wx;
    }
    if (a >= 0xFF10 && a < 0xFF40) return this.apu.read(a);
    if (this.cgb) {
      switch (a) {
        case 0xFF4D: return (this.double ? 0x80 : 0) | (this.key1 & 1) | 0x7E;
        case 0xFF4F: return 0xFE | this.vbank;
        case 0xFF55: return this.hdmaActive ? ((this.hdmaLen - 1) & 0x7F) : 0xFF;
        case 0xFF68: return this.bcps | 0x40;
        case 0xFF69: return this.bgPal[this.bcps & 0x3F];
        case 0xFF6A: return this.ocps | 0x40;
        case 0xFF6B: return this.objPal[this.ocps & 0x3F];
        case 0xFF70: return 0xF8 | this.wbank;
      }
    }
    return 0xFF;
  }
  ioWrite(a, v) {
    switch (a) {
      case 0xFF00: this.joySel = v & 0x30; return;
      case 0xFF01: this.sb = v; return;
      case 0xFF02: this.sc = v & 0x83; if ((v & 0x81) === 0x81) { this.sb = 0xFF; this.sc &= 0x7F; this.if_ |= 8; } return;
      case 0xFF04: {
        const bit = [9, 3, 5, 7][this.tac & 3];
        if ((this.tac & 4) && (this.divc >> bit & 1)) this.incTima();
        this.divc = 0; return;
      }
      case 0xFF05: this.tima = v; return;
      case 0xFF06: this.tma = v; return;
      case 0xFF07: this.tac = v & 7; return;
      case 0xFF0F: this.if_ = v & 0x1F; return;
      case 0xFF40: {
        const was = this.lcdc & 0x80;
        this.lcdc = v;
        if (was && !(v & 0x80)) { this.ly = 0; this.dot = 0; this.mode = 0; }
        if (!was && (v & 0x80)) { this.ly = 0; this.dot = 0; this.mode = 2; this.winLine = 0; this.checkStat(); }
        return;
      }
      case 0xFF41: this.stat = v & 0x78; this.checkStat(); return;
      case 0xFF42: this.scy = v; return;
      case 0xFF43: this.scx = v; return;
      case 0xFF44: return;
      case 0xFF45: this.lyc = v; this.checkStat(); return;
      case 0xFF46: {
        this.io[0x46] = v; const src = v << 8;
        for (let i = 0; i < 0xA0; i++) this.oam[i] = this.rb(src + i);
        return;
      }
      case 0xFF47: this.bgp = v; return;
      case 0xFF48: this.obp0 = v; return;
      case 0xFF49: this.obp1 = v; return;
      case 0xFF4A: this.wy = v; return;
      case 0xFF4B: this.wx = v; return;
    }
    if (a >= 0xFF10 && a < 0xFF40) { this.apu.write(a, v); return; }
    if (this.cgb) {
      switch (a) {
        case 0xFF4D: this.key1 = v & 1; return;
        case 0xFF4F: this.vbank = v & 1; return;
        case 0xFF51: this.hdmaSrc = (this.hdmaSrc & 0xFF) | (v << 8); return;
        case 0xFF52: this.hdmaSrc = (this.hdmaSrc & 0xFF00) | (v & 0xF0); return;
        case 0xFF53: this.hdmaDst = (this.hdmaDst & 0xFF) | ((v & 0x1F) << 8); return;
        case 0xFF54: this.hdmaDst = (this.hdmaDst & 0xFF00) | (v & 0xF0); return;
        case 0xFF55:
          if (this.hdmaActive && !(v & 0x80)) { this.hdmaActive = false; return; }
          this.hdmaLen = (v & 0x7F) + 1;
          if (v & 0x80) { this.hdmaActive = true; if (this.mode === 0 && (this.lcdc & 0x80) === 0) {} }
          else { while (this.hdmaLen > 0) this.hdmaBlock(); this.cycles += 0; }
          return;
        case 0xFF68: this.bcps = v & 0xBF; return;
        case 0xFF69: this.bgPal[this.bcps & 0x3F] = v; if (this.bcps & 0x80) this.bcps = 0x80 | ((this.bcps + 1) & 0x3F); return;
        case 0xFF6A: this.ocps = v & 0xBF; return;
        case 0xFF6B: this.objPal[this.ocps & 0x3F] = v; if (this.ocps & 0x80) this.ocps = 0x80 | ((this.ocps + 1) & 0x3F); return;
        case 0xFF70: this.wbank = (v & 7) || 1; return;
      }
    }
    this.io[a - 0xFF00] = v;
  }
  hdmaBlock() {
    for (let i = 0; i < 16; i++) {
      this.vram[(this.vbank << 13) + ((this.hdmaDst + i) & 0x1FFF)] = this.rb((this.hdmaSrc + i) & 0xFFFF);
    }
    this.hdmaSrc = (this.hdmaSrc + 16) & 0xFFFF; this.hdmaDst = (this.hdmaDst + 16) & 0x1FFF;
    this.hdmaLen--;
    if (this.hdmaLen <= 0) { this.hdmaLen = 0; this.hdmaActive = false; }
  }
  incTima() {
    this.tima++;
    if (this.tima > 0xFF) { this.tima = this.tma; this.if_ |= 4; }
  }

  // ---------- PPU ----------
  checkStat() {
    const s = this.stat;
    const line = (this.lcdc & 0x80) && (
      ((s & 0x40) && this.ly === this.lyc) ||
      ((s & 0x08) && this.mode === 0) ||
      ((s & 0x10) && this.mode === 1) ||
      ((s & 0x20) && this.mode === 2));
    if (line && !this.statLine) this.if_ |= 2;
    this.statLine = !!line;
  }
  ppuTick(c) {
    if (!(this.lcdc & 0x80)) {
      this.dot += c;
      if (this.dot >= 70224) { this.dot -= 70224; this.out.fill(this.cgb ? 0xFFFFFFFF : this.shades[0]); this.frameReady = true; }
      return;
    }
    this.dot += c;
    for (;;) {
      if (this.ly < 144) {
        if (this.mode === 2) {
          if (this.dot < 80) return;
          this.mode = 3; this.checkStat();
        } else if (this.mode === 3) {
          if (this.dot < 252) return;
          this.renderLine();
          this.mode = 0; this.checkStat();
          if (this.hdmaActive) this.hdmaBlock();
        } else {
          if (this.dot < 456) return;
          this.dot -= 456; this.ly++;
          if (this.ly === 144) {
            this.mode = 1; this.if_ |= 1;
            const t = this.out; this.out = this.fb; this.fb = t; this.frameReady = true;
          } else this.mode = 2;
          this.checkStat();
        }
      } else {
        if (this.dot < 456) return;
        this.dot -= 456; this.ly++;
        if (this.ly > 153) { this.ly = 0; this.mode = 2; this.winLine = 0; }
        this.checkStat();
      }
    }
  }
  cgbColor(pal, idx) {
    const c = pal[idx] | (pal[idx + 1] << 8);
    const r = c & 31, g = (c >> 5) & 31, b = (c >> 10) & 31;
    // correção de cor leve tipo tela GBC
    const R = (r * 13 + g * 2 + b) >> 1, G = (g * 3 + b) << 1, B = (r * 3 + g * 2 + b * 11) >> 1;
    return 0xFF000000 | (Math.min(255, B) << 16) | (Math.min(255, G) << 8) | Math.min(255, R);
  }
  renderLine() {
    const ly = this.ly, lcdc = this.lcdc, cgb = this.cgb, vram = this.vram;
    const fb = this.fb, off = ly * 160;
    const bgCi = this.bgCi, bgPri = this.bgPri;
    const shades = this.shades;
    const unsigned = lcdc & 0x10;
    const tileAddr = (t) => unsigned ? t << 4 : 0x1000 + (((t << 24) >> 24) << 4);
    const bgOn = cgb || (lcdc & 1);
    if (bgOn) {
      const mapBase = lcdc & 0x08 ? 0x1C00 : 0x1800;
      const y = (ly + this.scy) & 0xFF;
      let winX = 999;
      if ((lcdc & 0x20) && this.wy <= ly && this.wx <= 166) winX = this.wx - 7;
      const winMap = lcdc & 0x40 ? 0x1C00 : 0x1800;
      for (let x = 0; x < 160; x++) {
        let mapAddr, py, px;
        if (x >= winX) {
          px = x - winX; py = this.winLine;
          mapAddr = winMap + ((py >> 3) << 5) + (px >> 3);
        } else {
          px = (x + this.scx) & 0xFF; py = y;
          mapAddr = mapBase + ((py >> 3) << 5) + (px >> 3);
        }
        const tile = vram[mapAddr];
        let attr = cgb ? vram[0x2000 + mapAddr] : 0;
        let row = py & 7; if (attr & 0x40) row = 7 - row;
        const addr = tileAddr(tile) + (row << 1) + ((attr & 8) ? 0x2000 : 0);
        const lo = vram[addr], hi = vram[addr + 1];
        const bit = (attr & 0x20) ? (px & 7) : 7 - (px & 7);
        const ci = ((hi >> bit) & 1) << 1 | ((lo >> bit) & 1);
        bgCi[x] = ci; bgPri[x] = attr & 0x80;
        fb[off + x] = cgb ? this.cgbColor(this.bgPal, ((attr & 7) << 3) + (ci << 1)) : shades[(this.bgp >> (ci << 1)) & 3];
      }
      if (winX < 160) this.winLine++;
    } else {
      for (let x = 0; x < 160; x++) { bgCi[x] = 0; bgPri[x] = 0; fb[off + x] = shades[this.bgp & 3]; }
    }
    // sprites
    if (lcdc & 2) {
      const h = lcdc & 4 ? 16 : 8;
      const list = [];
      for (let i = 0; i < 40 && list.length < 10; i++) {
        const sy = this.oam[i * 4] - 16;
        if (ly >= sy && ly < sy + h) list.push(i);
      }
      if (!cgb) list.sort((p, q) => (this.oam[p * 4 + 1] - this.oam[q * 4 + 1]) || (p - q));
      const used = this.objUsed; used.fill(0);
      const master = cgb && !(lcdc & 1);
      for (const i of list) {
        const o = i * 4;
        const sy = this.oam[o] - 16, sx = this.oam[o + 1] - 8;
        let tile = this.oam[o + 2]; const attr = this.oam[o + 3];
        if (h === 16) tile &= 0xFE;
        let row = ly - sy; if (attr & 0x40) row = h - 1 - row;
        const addr = (tile << 4) + (row << 1) + (cgb && (attr & 8) ? 0x2000 : 0);
        const lo = vram[addr], hi = vram[addr + 1];
        for (let px = 0; px < 8; px++) {
          const x = sx + px;
          if (x < 0 || x >= 160 || used[x]) continue;
          const bit = (attr & 0x20) ? px : 7 - px;
          const ci = ((hi >> bit) & 1) << 1 | ((lo >> bit) & 1);
          if (!ci) continue;
          used[x] = 1;
          if (!master && bgCi[x] && ((attr & 0x80) || bgPri[x])) continue;
          fb[off + x] = cgb ? this.cgbColor(this.objPal, ((attr & 7) << 3) + (ci << 1))
            : shades[(((attr & 0x10) ? this.obp1 : this.obp0) >> (ci << 1)) & 3];
        }
      }
    }
  }

  // ---------- Execução ----------
  runFrame() {
    this.frameReady = false;
    let guard = 0;
    const lim = 70224 * (this.double ? 2 : 1) * 2;
    while (!this.frameReady && guard < lim) {
      const c = this.step();
      guard += c;
      this.timerTick(c);
      const pc = this.double ? c >> 1 : c;
      this.ppuTick(pc);
      this.apu.tick(pc);
    }
  }
  timerTick(c) {
    const tac = this.tac;
    if (!(tac & 4)) { this.divc = (this.divc + c) & 0xFFFF; return; }
    const bit = [9, 3, 5, 7][tac & 3];
    for (let i = 0; i < c; i += 4) {
      const old = this.divc;
      this.divc = (old + 4) & 0xFFFF;
      if ((old >> bit & 1) && !(this.divc >> bit & 1)) this.incTima();
    }
  }
  press(k, down) {
    const m = 1 << k;
    if (down) { if (!(this.keys & m)) this.if_ |= 0x10; this.keys |= m; }
    else this.keys &= ~m;
  }

  // ---------- CPU SM83 ----------
  fetch() { const v = this.rb(this.pc); this.pc = (this.pc + 1) & 0xFFFF; return v; }
  fetch16() { const lo = this.fetch(); return lo | (this.fetch() << 8); }
  push(v) { this.sp = (this.sp - 1) & 0xFFFF; this.wb(this.sp, v >> 8); this.sp = (this.sp - 1) & 0xFFFF; this.wb(this.sp, v & 0xFF); }
  pop() { const lo = this.rb(this.sp); this.sp = (this.sp + 1) & 0xFFFF; const hi = this.rb(this.sp); this.sp = (this.sp + 1) & 0xFFFF; return lo | (hi << 8); }
  get hl() { return (this.h << 8) | this.l; }
  set hl(v) { this.h = (v >> 8) & 0xFF; this.l = v & 0xFF; }
  get bc() { return (this.b << 8) | this.c; }
  set bc(v) { this.b = (v >> 8) & 0xFF; this.c = v & 0xFF; }
  get de() { return (this.d << 8) | this.e; }
  set de(v) { this.d = (v >> 8) & 0xFF; this.e = v & 0xFF; }
  getR(i) {
    switch (i) { case 0: return this.b; case 1: return this.c; case 2: return this.d; case 3: return this.e;
      case 4: return this.h; case 5: return this.l; case 6: return this.rb(this.hl); default: return this.a; }
  }
  setR(i, v) {
    switch (i) { case 0: this.b = v; break; case 1: this.c = v; break; case 2: this.d = v; break; case 3: this.e = v; break;
      case 4: this.h = v; break; case 5: this.l = v; break; case 6: this.wb(this.hl, v); break; default: this.a = v; }
  }
  alu(op, v) {
    const a = this.a; let r;
    switch (op) {
      case 0: r = a + v; this.f = ((r & 0xFF) ? 0 : FZ) | (((a & 0xF) + (v & 0xF)) > 0xF ? FH : 0) | (r > 0xFF ? FC : 0); this.a = r & 0xFF; break;
      case 1: { const c = (this.f >> 4) & 1; r = a + v + c; this.f = ((r & 0xFF) ? 0 : FZ) | (((a & 0xF) + (v & 0xF) + c) > 0xF ? FH : 0) | (r > 0xFF ? FC : 0); this.a = r & 0xFF; break; }
      case 2: r = a - v; this.f = FN | ((r & 0xFF) ? 0 : FZ) | ((a & 0xF) < (v & 0xF) ? FH : 0) | (r < 0 ? FC : 0); this.a = r & 0xFF; break;
      case 3: { const c = (this.f >> 4) & 1; r = a - v - c; this.f = FN | ((r & 0xFF) ? 0 : FZ) | (((a & 0xF) - (v & 0xF) - c) < 0 ? FH : 0) | (r < 0 ? FC : 0); this.a = r & 0xFF; break; }
      case 4: this.a = a & v; this.f = (this.a ? 0 : FZ) | FH; break;
      case 5: this.a = a ^ v; this.f = this.a ? 0 : FZ; break;
      case 6: this.a = a | v; this.f = this.a ? 0 : FZ; break;
      case 7: r = a - v; this.f = FN | ((r & 0xFF) ? 0 : FZ) | ((a & 0xF) < (v & 0xF) ? FH : 0) | (r < 0 ? FC : 0); break;
    }
  }
  inc8(v) { const r = (v + 1) & 0xFF; this.f = (this.f & FC) | (r ? 0 : FZ) | ((v & 0xF) === 0xF ? FH : 0); return r; }
  dec8(v) { const r = (v - 1) & 0xFF; this.f = (this.f & FC) | FN | (r ? 0 : FZ) | ((v & 0xF) === 0 ? FH : 0); return r; }
  addHL(v) { const hl = this.hl, r = hl + v; this.f = (this.f & FZ) | (((hl & 0xFFF) + (v & 0xFFF)) > 0xFFF ? FH : 0) | (r > 0xFFFF ? FC : 0); this.hl = r & 0xFFFF; }
  spE() {
    const e = this.fetch(), sp = this.sp;
    this.f = (((sp & 0xF) + (e & 0xF)) > 0xF ? FH : 0) | (((sp & 0xFF) + e) > 0xFF ? FC : 0);
    return (sp + ((e << 24) >> 24)) & 0xFFFF;
  }
  cond(i) {
    switch (i) { case 0: return !(this.f & FZ); case 1: return !!(this.f & FZ); case 2: return !(this.f & FC); default: return !!(this.f & FC); }
  }
  cb() {
    const op = this.fetch(); const r = op & 7; let v = this.getR(r);
    const x = op >> 6, y = (op >> 3) & 7;
    if (x === 1) { this.f = (this.f & FC) | FH | ((v >> y) & 1 ? 0 : FZ); return r === 6 ? 12 : 8; }
    if (x === 2) { this.setR(r, v & ~(1 << y)); return r === 6 ? 16 : 8; }
    if (x === 3) { this.setR(r, v | (1 << y)); return r === 6 ? 16 : 8; }
    let c;
    switch (y) {
      case 0: c = v >> 7; v = ((v << 1) | c) & 0xFF; break;
      case 1: c = v & 1; v = (v >> 1) | (c << 7); break;
      case 2: c = v >> 7; v = ((v << 1) | ((this.f >> 4) & 1)) & 0xFF; break;
      case 3: c = v & 1; v = (v >> 1) | ((this.f & FC) << 3); break;
      case 4: c = v >> 7; v = (v << 1) & 0xFF; break;
      case 5: c = v & 1; v = (v >> 1) | (v & 0x80); break;
      case 6: c = 0; v = ((v & 0xF) << 4) | (v >> 4); break;
      case 7: c = v & 1; v = v >> 1; break;
    }
    this.f = (v ? 0 : FZ) | (c ? FC : 0);
    this.setR(r, v);
    return r === 6 ? 16 : 8;
  }
  step() {
    const pend = this.ie & this.if_ & 0x1F;
    if (this.halted) {
      if (!pend) return 4;
      this.halted = false;
    }
    if (this.ime && pend) {
      this.ime = false;
      let bit = 0; while (!((pend >> bit) & 1)) bit++;
      this.if_ &= ~(1 << bit);
      this.push(this.pc); this.pc = 0x40 + bit * 8;
      return 20;
    }
    const cyc = this.exec(this.fetch());
    if (this.eiDelay && --this.eiDelay === 0) this.ime = true;
    return cyc;
  }
  exec(op) {
    if (op >= 0x40 && op < 0x80) {
      if (op === 0x76) { this.halted = true; return 4; }
      const d = (op >> 3) & 7, s = op & 7;
      this.setR(d, this.getR(s));
      return (d === 6 || s === 6) ? 8 : 4;
    }
    if (op >= 0x80 && op < 0xC0) { const s = op & 7; this.alu((op >> 3) & 7, this.getR(s)); return s === 6 ? 8 : 4; }
    let t, v;
    switch (op) {
      case 0x00: return 4;
      case 0x01: this.bc = this.fetch16(); return 12;
      case 0x11: this.de = this.fetch16(); return 12;
      case 0x21: this.hl = this.fetch16(); return 12;
      case 0x31: this.sp = this.fetch16(); return 12;
      case 0x02: this.wb(this.bc, this.a); return 8;
      case 0x12: this.wb(this.de, this.a); return 8;
      case 0x22: t = this.hl; this.wb(t, this.a); this.hl = (t + 1) & 0xFFFF; return 8;
      case 0x32: t = this.hl; this.wb(t, this.a); this.hl = (t - 1) & 0xFFFF; return 8;
      case 0x0A: this.a = this.rb(this.bc); return 8;
      case 0x1A: this.a = this.rb(this.de); return 8;
      case 0x2A: t = this.hl; this.a = this.rb(t); this.hl = (t + 1) & 0xFFFF; return 8;
      case 0x3A: t = this.hl; this.a = this.rb(t); this.hl = (t - 1) & 0xFFFF; return 8;
      case 0x03: this.bc = (this.bc + 1) & 0xFFFF; return 8;
      case 0x13: this.de = (this.de + 1) & 0xFFFF; return 8;
      case 0x23: this.hl = (this.hl + 1) & 0xFFFF; return 8;
      case 0x33: this.sp = (this.sp + 1) & 0xFFFF; return 8;
      case 0x0B: this.bc = (this.bc - 1) & 0xFFFF; return 8;
      case 0x1B: this.de = (this.de - 1) & 0xFFFF; return 8;
      case 0x2B: this.hl = (this.hl - 1) & 0xFFFF; return 8;
      case 0x3B: this.sp = (this.sp - 1) & 0xFFFF; return 8;
      case 0x04: case 0x0C: case 0x14: case 0x1C: case 0x24: case 0x2C: case 0x34: case 0x3C:
        t = (op >> 3) & 7; this.setR(t, this.inc8(this.getR(t))); return t === 6 ? 12 : 4;
      case 0x05: case 0x0D: case 0x15: case 0x1D: case 0x25: case 0x2D: case 0x35: case 0x3D:
        t = (op >> 3) & 7; this.setR(t, this.dec8(this.getR(t))); return t === 6 ? 12 : 4;
      case 0x06: case 0x0E: case 0x16: case 0x1E: case 0x26: case 0x2E: case 0x36: case 0x3E:
        t = (op >> 3) & 7; this.setR(t, this.fetch()); return t === 6 ? 12 : 8;
      case 0x07: v = this.a >> 7; this.a = ((this.a << 1) | v) & 0xFF; this.f = v ? FC : 0; return 4;
      case 0x0F: v = this.a & 1; this.a = (this.a >> 1) | (v << 7); this.f = v ? FC : 0; return 4;
      case 0x17: v = this.a >> 7; this.a = ((this.a << 1) | ((this.f >> 4) & 1)) & 0xFF; this.f = v ? FC : 0; return 4;
      case 0x1F: v = this.a & 1; this.a = (this.a >> 1) | ((this.f & FC) << 3); this.f = v ? FC : 0; return 4;
      case 0x08: t = this.fetch16(); this.wb(t, this.sp & 0xFF); this.wb((t + 1) & 0xFFFF, this.sp >> 8); return 20;
      case 0x09: this.addHL(this.bc); return 8;
      case 0x19: this.addHL(this.de); return 8;
      case 0x29: this.addHL(this.hl); return 8;
      case 0x39: this.addHL(this.sp); return 8;
      case 0x10:
        this.fetch();
        if (this.cgb && (this.key1 & 1)) { this.double = !this.double; this.key1 = 0; }
        this.divc = 0;
        return 4;
      case 0x18: t = this.fetch(); this.pc = (this.pc + ((t << 24) >> 24)) & 0xFFFF; return 12;
      case 0x20: case 0x28: case 0x30: case 0x38:
        t = this.fetch(); if (this.cond((op >> 3) & 3)) { this.pc = (this.pc + ((t << 24) >> 24)) & 0xFFFF; return 12; } return 8;
      case 0x27: {
        let a = this.a, f = this.f;
        if (!(f & FN)) { if ((f & FC) || a > 0x99) { a += 0x60; f |= FC; } if ((f & FH) || (a & 0xF) > 9) a += 6; }
        else { if (f & FC) a -= 0x60; if (f & FH) a -= 6; }
        a &= 0xFF; this.a = a; this.f = (f & (FN | FC)) | (a ? 0 : FZ); return 4;
      }
      case 0x2F: this.a ^= 0xFF; this.f |= FN | FH; return 4;
      case 0x37: this.f = (this.f & FZ) | FC; return 4;
      case 0x3F: this.f = (this.f & FZ) | ((this.f & FC) ^ FC); return 4;
      case 0xC0: case 0xC8: case 0xD0: case 0xD8:
        if (this.cond((op >> 3) & 3)) { this.pc = this.pop(); return 20; } return 8;
      case 0xC9: this.pc = this.pop(); return 16;
      case 0xD9: this.pc = this.pop(); this.ime = true; return 16;
      case 0xC1: this.bc = this.pop(); return 12;
      case 0xD1: this.de = this.pop(); return 12;
      case 0xE1: this.hl = this.pop(); return 12;
      case 0xF1: t = this.pop(); this.a = t >> 8; this.f = t & 0xF0; return 12;
      case 0xC5: this.push(this.bc); return 16;
      case 0xD5: this.push(this.de); return 16;
      case 0xE5: this.push(this.hl); return 16;
      case 0xF5: this.push((this.a << 8) | this.f); return 16;
      case 0xC2: case 0xCA: case 0xD2: case 0xDA:
        t = this.fetch16(); if (this.cond((op >> 3) & 3)) { this.pc = t; return 16; } return 12;
      case 0xC3: this.pc = this.fetch16(); return 16;
      case 0xE9: this.pc = this.hl; return 4;
      case 0xC4: case 0xCC: case 0xD4: case 0xDC:
        t = this.fetch16(); if (this.cond((op >> 3) & 3)) { this.push(this.pc); this.pc = t; return 24; } return 12;
      case 0xCD: t = this.fetch16(); this.push(this.pc); this.pc = t; return 24;
      case 0xC7: case 0xCF: case 0xD7: case 0xDF: case 0xE7: case 0xEF: case 0xF7: case 0xFF:
        this.push(this.pc); this.pc = op & 0x38; return 16;
      case 0xC6: case 0xCE: case 0xD6: case 0xDE: case 0xE6: case 0xEE: case 0xF6: case 0xFE:
        this.alu((op >> 3) & 7, this.fetch()); return 8;
      case 0xCB: return this.cb();
      case 0xE0: this.wb(0xFF00 | this.fetch(), this.a); return 12;
      case 0xF0: this.a = this.rb(0xFF00 | this.fetch()); return 12;
      case 0xE2: this.wb(0xFF00 | this.c, this.a); return 8;
      case 0xF2: this.a = this.rb(0xFF00 | this.c); return 8;
      case 0xEA: this.wb(this.fetch16(), this.a); return 16;
      case 0xFA: this.a = this.rb(this.fetch16()); return 16;
      case 0xE8: this.sp = this.spE(); return 16;
      case 0xF8: this.hl = this.spE(); return 12;
      case 0xF9: this.sp = this.hl; return 8;
      case 0xF3: this.ime = false; this.eiDelay = 0; return 4;
      case 0xFB: if (!this.ime && !this.eiDelay) this.eiDelay = 2; return 4;
      default: return 4; // opcodes inválidos: ignora
    }
  }

  // ---------- Interface comum ----------
  get sys() { return this.cgb ? 'gbc' : 'gb'; }
  get width() { return 160; } get height() { return 144; }
  get audioBuf() { return this.apu.buf; }
  get audioLen() { return this.apu.bufLen; } set audioLen(v) { this.apu.bufLen = v; }
  get audioRate() { return this.apu.sampleRate; }
  setAudioRate(r) { this.apu.setRate(r); }
  get hasSave() { return this.cart.hasBattery; }
  get saveDirty() { return this.cart.dirty; } set saveDirty(v) { this.cart.dirty = v; }
  getSave() { return this.cart.getSave(); }
  loadSave(d) { this.cart.loadSave(d); }

  // ---------- Save state ----------
  static STATE_KEYS = ['a','f','b','c','d','e','h','l','sp','pc','ime','eiDelay','halted','ie','if_','divc','tima','tma','tac',
    'lcdc','stat','scy','scx','ly','lyc','bgp','obp0','obp1','wy','wx','mode','dot','winLine','statLine','joySel','vbank','wbank',
    'double','key1','bcps','ocps','hdmaSrc','hdmaDst','hdmaLen','hdmaActive','sb','sc'];
  static ARR_KEYS = ['vram','wram','oam','hram','io','bgPal','objPal'];
  saveState() {
    const s = { v: 1, sys: 'gb', title: this.title };
    for (const k of GB.STATE_KEYS) s[k] = this[k];
    for (const k of GB.ARR_KEYS) s[k] = Array.from(this[k]);
    const c = this.cart;
    s.cart = { ram: Array.from(c.ram), ramEnable: c.ramEnable, bank1: c.bank1, bank2: c.bank2, mode: c.mode, romBank: c.romBank, ramBank: c.ramBank, rtc: Array.from(c.rtc), rtcL: Array.from(c.rtcLatched), rtcBase: c.rtcBase };
    s.apu = this.apu.getState();
    return s;
  }
  loadState(s) {
    for (const k of GB.STATE_KEYS) if (k in s) this[k] = s[k];
    for (const k of GB.ARR_KEYS) if (s[k]) this[k].set(s[k]);
    const c = this.cart, sc = s.cart;
    if (sc) { c.ram.set(sc.ram.slice(0, c.ram.length)); Object.assign(c, { ramEnable: sc.ramEnable, bank1: sc.bank1, bank2: sc.bank2, mode: sc.mode, romBank: sc.romBank, ramBank: sc.ramBank, rtcBase: sc.rtcBase }); c.rtc.set(sc.rtc); c.rtcLatched.set(sc.rtcL); c.update(); c.dirty = true; }
    if (s.apu) this.apu.setState(s.apu);
  }
}
if (typeof module !== 'undefined') module.exports = { GB, Cart, APU };
