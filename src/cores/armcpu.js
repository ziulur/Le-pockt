// ===== Processador ARM genérico (ARM7TDMI / ARM946E-S) usado pelo DS =====
class Arm {
  constructor(bus, v5, irqVec, base) {
    this.bus = bus; this.v5 = v5; this.irqVec = irqVec; this.base = base;
    this.r = new Int32Array(16); this.bank13 = new Int32Array(6); this.bank14 = new Int32Array(6); this.spsr = new Int32Array(6);
    this.fiqHi = new Int32Array(5); this.usrHi = new Int32Array(5);
    this.mode = 0x1F; this.cN = 0; this.cZ = 0; this.cC = 0; this.cV = 0; this.cI = 0; this.cF = 0; this.cT = 0; this.cQ = 0; this.sc = 0;
    this.cycles = 0; this.tgt = 0; this.halted = false; this.irqLine = false; this.ime = 0; this.intrWaiting = false; this.mlo = 0; this.mhi = 0;
  }
  read8(a) { return this.bus.r8(a >>> 0); }
  read16(a) { return this.bus.r16((a & ~1) >>> 0); }
  read32(a) { return this.bus.r32((a & ~3) >>> 0); }
  write8(a, v) { this.bus.w8(a >>> 0, v & 0xFF); }
  write16(a, v) { this.bus.w16((a & ~1) >>> 0, v & 0xFFFF); }
  write32(a, v) { this.bus.w32((a & ~3) >>> 0, v | 0); }
  swi(n) { this.bus.swi(this, n); }
  flushL() { if (this.v5 && (this.r[15] & 1)) this.cT = 1; this.flush(); }
  arm5(op) {
    const r = this.r;
    if ((op & 0x0FFFFFF0) === 0x012FFF30) { const t = r[op & 15]; r[14] = r[15] - 4; if (t & 1) { this.cT = 1; r[15] = (t & ~1) + 2; } else r[15] = (t & ~3) + 4; this.cycles += 2; return true; }
    if ((op & 0x0FFF0FF0) === 0x016F0F10) { r[(op >>> 12) & 15] = Math.clz32(r[op & 15]); return true; }
    if ((op & 0x0F900FF0) === 0x01000050) {
      const a = r[op & 15]; let b = r[(op >>> 16) & 15]; const o = (op >>> 21) & 3;
      if (o & 2) { const d = b * 2; if (d > 2147483647) { b = 2147483647; this.cQ = 1; } else if (d < -2147483648) { b = -2147483648; this.cQ = 1; } else b = d; }
      let s = (o & 1) ? a - b : a + b; if (s > 2147483647) { s = 2147483647; this.cQ = 1; } else if (s < -2147483648) { s = -2147483648; this.cQ = 1; }
      r[(op >>> 12) & 15] = s; return true;
    }
    if ((op & 0x0F900090) === 0x01000080) {
      const o = (op >>> 21) & 3, rd = (op >>> 16) & 15, rn = (op >>> 12) & 15, rs = r[(op >>> 8) & 15], rm = r[op & 15];
      const ys = (op & 0x40) ? rs >> 16 : (rs << 16) >> 16;
      if (o === 1) { const p = Math.floor((rm * ys) / 65536); r[rd] = (op & 0x20) ? p | 0 : (p + r[rn]) | 0; return true; }
      const xs = (op & 0x20) ? rm >> 16 : (rm << 16) >> 16, p = xs * ys;
      if (o === 0) r[rd] = (p + r[rn]) | 0; else if (o === 3) r[rd] = p;
      else { const lo = (r[rn] >>> 0) + (p >>> 0); r[rn] = lo | 0; r[rd] = (r[rd] + (p >> 31) + (lo > 0xFFFFFFFF ? 1 : 0)) | 0; }
      return true;
    }
    if ((op & 0x0E1000D0) === 0x000000D0) {
      const rn = (op >>> 16) & 15, rd = (op >>> 12) & 15, P = op & 0x01000000;
      let off = (op & 0x00400000) ? ((op >>> 4) & 0xF0) | (op & 0xF) : r[op & 15]; if (!(op & 0x00800000)) off = -off;
      let addr = r[rn]; if (P) addr = (addr + off) | 0;
      if (op & 0x20) { this.write32(addr, r[rd]); this.write32(addr + 4, r[(rd + 1) & 15]); if (!P) r[rn] = addr + off; else if (op & 0x00200000) r[rn] = addr; }
      else { if (!P) r[rn] = addr + off; else if (op & 0x00200000) r[rn] = addr; r[rd] = this.read32(addr); r[(rd + 1) & 15] = this.read32(addr + 4); }
      this.cycles += 2; return true;
    }
    if ((op & 0x0F000010) === 0x0E000010) {
      if (((op >>> 8) & 15) === 15) { const id = (((op >>> 16) & 15) << 8) | ((op & 15) << 4) | ((op >>> 5) & 7); if (op & 0x100000) r[(op >>> 12) & 15] = this.bus.cp15r(id); else this.bus.cp15w(id, r[(op >>> 12) & 15]); }
      return true;
    }
    return false;
  }
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
    r[14] = next + 4; this.cT = 0; this.cI = 1; r[15] = (this.irqVec + 4) | 0;
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
    const r = this.r, bus = this.bus, v5 = this.v5, base = this.base, m16 = bus.m16, m32 = bus.m32, a16 = bus.a16, a32 = bus.a32, aLo = bus.aLo, aHi = bus.aHi, aMask = bus.aMask;
    while (this.cycles < this.tgt) {
      if (this.irqLine && this.ime && this.cI === 0) this.enterIrq();
      if (this.halted) { this.cycles = this.tgt; return; }
      const pc = r[15];
      if (this.cT) { const a = (pc - 2) >>> 0; const op = (a >>> 24) === 2 ? m16[(a & 0x3FFFFE) >> 1] : (a >= aLo && a < aHi) ? a16[(a & aMask) >> 1] : bus.r16(a); r[15] = pc + 2; this.cycles += base; this.thumb(op); }
      else {
        const a = (pc - 4) >>> 0; const op = (a >>> 24) === 2 ? m32[(a & 0x3FFFFC) >> 2] : (a >= aLo && a < aHi) ? a32[(a & aMask) >> 2] : bus.r32(a); r[15] = pc + 4; this.cycles += base;
        const cond = op >>> 28;
        if (cond === 14) this.arm(op);
        else if (cond !== 15) { if (this.testCond(cond)) this.arm(op); }
        else if (v5 && (op & 0x0E000000) === 0x0A000000) { r[14] = r[15] - 4; r[15] = (r[15] + ((op << 8) >> 6) + ((op >>> 23) & 2) + 2) | 0; this.cT = 1; this.cycles += 2; }
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
    if (this.v5) { const t = op >>> 25 & 7; if ((t === 7 || (t === 0 && ((op & 0x01900000) === 0x01000000 || (op & 0x0E1000D0) === 0x000000D0))) && this.arm5(op)) return; }
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
            r[rd] = v; if (rd === 15) this.flushL();
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
          r[rd] = v; if (rd === 15) this.flushL();
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
          if (list & 0x8000) { if (S) this.restoreCpsr(); else if (this.v5 && (r[15] & 1)) this.cT = 1; this.flush(); }
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
            default: { const t = r[rs]; if (this.v5 && (op & 0x80)) r[14] = (r[15] - 2) | 1; if (t & 1) r[15] = (t & ~1) + 2; else { this.cT = 0; r[15] = (t & ~3) + 4; } this.cycles += 2; return; }
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
          if (op & 0x100) { const t = this.read32(addr); if (this.v5 && !(t & 1)) { this.cT = 0; r[15] = (t & ~3) + 4; } else r[15] = (t & ~1) + 2; addr += 4; this.cycles += 2; }
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
      case 14:
        if ((op & 0x800) && this.v5) { const next = r[15] - 2, t = (r[14] + ((op & 0x7FF) << 1)) & ~3; r[14] = next | 1; this.cT = 0; r[15] = t + 4; this.cycles += 2; return; }
        r[15] = (r[15] + (((op & 0x7FF) << 21) >> 20) + 2) | 0; this.cycles += 2; return;
      default: {
        if (!(op & 0x800)) r[14] = (r[15] + (((op & 0x7FF) << 21) >> 9)) | 0;
        else { const next = r[15] - 2, t = (r[14] + ((op & 0x7FF) << 1)) | 0; r[14] = next | 1; r[15] = (t & ~1) + 2; this.cycles += 2; }
      }
    }
  }

}
if (typeof module !== 'undefined') module.exports = { Arm };
