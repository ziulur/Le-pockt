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
    this.keys = 0; this.touchOn = false; this.tx = 0; this.ty = 0;
    this.info = this.parse();
    this.title = this.info.code || this.info.name || '3DS';
    this.reset();
  }

  // ---------- cabeçalhos ----------
  u32(o) { return o + 4 <= this.rom.length ? this.dv.getUint32(o, true) : 0; }
  u16(o) { return o + 2 <= this.rom.length ? this.dv.getUint16(o, true) : 0; }
  str(o, n) { let s = ''; for (let i = 0; i < n && o + i < this.rom.length; i++) { const c = this.rom[o + i]; if (!c) break; s += c >= 32 && c < 127 ? String.fromCharCode(c) : '?'; } return s; }
  smdh(o) { // nome em inglês do ícone SMDH
    if (this.str(o, 4) !== 'SMDH') return '';
    const t = o + 8 + 0x200; let s = ''; for (let i = 0; i < 0x40; i++) { const c = this.u16(t + i * 2); if (!c) break; s += String.fromCharCode(c); } return s;
  }
  parse() {
    const r = this.rom, info = { kind: '?', encrypted: false, problems: [] };
    const magic = (o) => this.str(o + 0x100, 4);
    if (this.str(0, 4) === '3DSX') return this.parse3dsx(info);
    let ncch = -1;
    if (magic(0) === 'NCSD') { info.kind = 'NCSD (.3ds/.cci)'; const off = this.u32(0x120) * 0x200; if (magic(off) === 'NCCH') ncch = off; }
    else if (magic(0) === 'NCCH') { info.kind = 'NCCH (.cxi)'; ncch = 0; }
    else if (this.u32(0) === 0x2020) { info.kind = 'CIA'; info.problems.push('arquivo .cia: instale e exporte como .3ds/.cxi'); return info; }
    if (ncch < 0) { info.problems.push('cabeçalho NCCH não encontrado'); return info; }
    info.ncch = ncch;
    info.code = this.str(ncch + 0x150, 16);
    info.programId = this.u32(ncch + 0x11C).toString(16).toUpperCase().padStart(8, '0') + this.u32(ncch + 0x118).toString(16).toUpperCase().padStart(8, '0');
    const flags7 = r[ncch + 0x18F];
    info.encrypted = !(flags7 & 4);
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
        if (name === 'icon') info.longName = this.smdh(start);
      }
    }
    if (!info.codeBin) info.problems.push('ExeFS sem .code');
    return info;
  }
  parse3dsx(info) { // homebrew: código + rodata + data com tabelas de relocação
    info.kind = 'Homebrew (.3dsx)'; info.homebrew = true;
    const hs = this.u16(4), rs = this.u16(6), code = this.u32(0x10), ro = this.u32(0x14), data = this.u32(0x18), bss = this.u32(0x1C);
    if (hs > 0x20) { const so = this.u32(0x20), ss = this.u32(0x24); if (ss) info.longName = this.smdh(so); }
    info.x = { hs, rs, code, ro, data, bss };
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

  // ---------- início ----------
  reset() {
    this.mem = new N3DSMem(); this.svcLog = []; this.svcCount = new Map(); this.stopped = ''; this.frame = 0; this.ticks = 0;
    this.services = new Map(); this.unknownSvc = new Set(); this.unknownIpc = new Map(); this.debug = [];
    this.handles = new Map(); this.nextHandle = 0x100; this.threads = []; this.cur = null; this.arb = []; this.linearNext = 0; this.fbSeen = false;
    this.gspShared = null; this.hidShared = null; this.gspEvent = 0; this.gspThreadId = 0; this.fb = [null, null]; this.cmdLists = 0;
    this.cpu = null;
    try { if (this.info.homebrew) this.load3dsx(); else if (this.info.codeBin) this.loadCxi(); } catch (e) { this.info.problems.push('falha ao carregar: ' + e.message); }
    if (this.entry !== undefined) this.boot();
    this.drawInfo();
  }
  loadCxi() {
    const I = this.info;
    const code = I.compressed ? N3DS.blz(I.codeBin) : I.codeBin;
    I.codeSize = code.length;
    const put = (seg, from) => { if (!seg || !seg.size) return from; this.mem.load(seg.addr, code.subarray(from, from + seg.size)); return from + seg.pages * 0x1000; };
    let p = put(I.text, 0); p = put(I.ro, p); put(I.data, p);
    this.entry = I.text ? I.text.addr : 0x100000; this.stackSize = I.stack || 0x4000;
  }
  load3dsx() {
    const X = this.info.x, base = 0x00100000, al = (v) => (v + 0xFFF) & ~0xFFF;
    const seg = [base, base + al(X.code), base + al(X.code) + al(X.ro)], size = [X.code, X.ro, X.data];
    let p = X.hs + X.rs * 3;
    const relocs = []; for (let k = 0; k < 3; k++) relocs.push([this.u32(X.hs + k * X.rs), this.u32(X.hs + k * X.rs + 4)]);
    this.mem.load(seg[0], this.rom.subarray(p, p + X.code)); p += X.code;
    this.mem.load(seg[1], this.rom.subarray(p, p + X.ro)); p += X.ro;
    this.mem.load(seg[2], this.rom.subarray(p, p + X.data - X.bss)); p += X.data - X.bss;
    const off0 = X.code, off1 = X.code + X.ro;
    const tr = (a) => a < off0 ? seg[0] + a : a < off1 ? seg[1] + a - off0 : seg[2] + a - off1;
    for (let k = 0; k < 3; k++) {
      for (let t = 0; t < 2; t++) {
        let pos = seg[k]; const end = seg[k] + size[k];
        for (let i = 0; i < relocs[k][t]; i++) {
          const skip = this.u16(p), patch = this.u16(p + 2); p += 4;
          pos += skip * 4;
          for (let j = 0; j < patch && pos < end; j++, pos += 4) {
            const v = this.mem.r32(pos) >>> 0, a = tr(v & 0x0FFFFFFF);
            this.mem.w32(pos, t === 0 ? a : (a - pos) | 0);
          }
        }
      }
    }
    this.info.codeSize = X.code + X.ro + X.data;
    this.info.text = { addr: seg[0] }; this.info.ro = { addr: seg[1] }; this.info.data = { addr: seg[2] };
    // __service_ptr = 0 (sem lista de serviços do carregador: o jogo usa srv normalmente)
    this.entry = base; this.stackSize = 0x8000;
  }
  boot() {
    const mem = this.mem, self = this;
    // página de configuração do kernel e página compartilhada
    mem.w32(0x1FF80000, 0x022E0000); // versão do kernel 2.46
    mem.w32(0x1FF80030, 0); mem.w32(0x1FF80040, 0x04000000); mem.w32(0x1FF80044, 0x02C00000); mem.w32(0x1FF80048, 0x01400000);
    mem.w32(0x1FF80060, 0x022E0000); mem.w32(0x1FF81004, 1); // rede/estado
    this.heapUsed = 0x00200000;
    const bus = {
      m16: mem.low16, m32: mem.low32, a16: mem.low16, a32: mem.low32, aLo: 0x00100000, aHi: 0x01000000, aMask: 0x00FFFFFF,
      r8: (a) => mem.r8(a), r16: (a) => mem.r16(a), r32: (a) => mem.r32(a), w8: (a, v) => mem.w8(a, v), w16: (a, v) => mem.w16(a, v), w32: (a, v) => mem.w32(a, v),
      swi: (cpu, n) => self.svc(n), cp15r: (id) => (id === 0xD03 ? self.cur.tls : 0), cp15w: () => {},
    };
    const cpu = new Arm11(bus, true, 0, 1); cpu.mode = 0x10; this.cpu = cpu;
    const t = this.newThread(this.entry, 0, 0x10000000, 0x30);
    this.cur = t; this.loadCtx(t);
  }

  // ---------- threads ----------
  newThread(entry, arg, sp, prio) {
    const id = this.threads.length, t = { id, prio, regs: new Int32Array(16), cpsr: 0x10, vfp: new Int32Array(33), state: 'ready', wait: null, tls: 0x1FF82000 + id * 0x200, h: 0 };
    t.regs[0] = arg; t.regs[13] = sp; t.regs[15] = (entry & ~1) + (entry & 1 ? 2 : 4); if (entry & 1) t.cpsr |= 0x20;
    this.threads.push(t); t.h = this.addHandle({ type: 'thread', t, signaled: false }); return t;
  }
  saveCtx(t) { const c = this.cpu; t.regs.set(c.r); t.cpsr = c.getCpsr(); t.vfp.set(c.vi); t.vfp[32] = c.fpscr; }
  loadCtx(t) { const c = this.cpu; c.r.set(t.regs); c.setCpsr(t.cpsr); c.vi.set(t.vfp.subarray(0, 32)); c.fpscr = t.vfp[32]; }
  pick() {
    let best = null;
    for (const t of this.threads) if (t.state === 'ready' && (!best || t.prio < best.prio)) best = t;
    return best;
  }
  yieldNow() { this.cpu.tgt = this.cpu.cycles; this.needSwitch = true; }

  // ---------- objetos do kernel ----------
  addHandle(o) { const h = this.nextHandle++; this.handles.set(h, o); return h; }
  obj(h) { if (h === 0xFFFF8000 || h === -32768) return this.handles.get(this.cur.h); return this.handles.get(h >>> 0) || this.handles.get(h); }
  isSignaled(o, t) {
    if (!o) return true;
    switch (o.type) {
      case 'event': case 'timer': return o.signaled;
      case 'mutex': return !o.owner || o.owner === t;
      case 'semaphore': return o.count > 0;
      case 'thread': return o.t.state === 'dead';
      case 'session': return true;
      default: return true;
    }
  }
  acquire(o, t) {
    if (!o) return;
    if ((o.type === 'event' || o.type === 'timer') && o.reset === 0) o.signaled = false; // ONESHOT
    else if (o.type === 'mutex') { o.owner = t; o.lock = (o.lock || 0) + 1; }
    else if (o.type === 'semaphore') o.count--;
  }
  wake() { // reavalia esperas
    for (const t of this.threads) {
      if (t.state !== 'wait' || !t.wait) continue;
      const w = t.wait;
      if (w.arb) continue;
      if (w.sleepUntil !== undefined) { if (this.ticks >= w.sleepUntil) { t.state = 'ready'; t.wait = null; } continue; }
      const os = w.handles.map((h) => this.obj(h));
      if (w.all) { if (os.every((o) => this.isSignaled(o, t))) { os.forEach((o) => this.acquire(o, t)); t.regs[0] = 0; t.state = 'ready'; t.wait = null; } }
      else { const i = os.findIndex((o) => this.isSignaled(o, t)); if (i >= 0) { this.acquire(os[i], t); t.regs[0] = 0; t.regs[1] = i; t.state = 'ready'; t.wait = null; } }
      if (t.wait && w.until !== undefined && this.ticks >= w.until) { t.regs[0] = 0x09401BFE; t.state = 'ready'; t.wait = null; } // tempo esgotado
    }
  }
  signal(h) { const o = this.handles.get(h); if (o) { o.signaled = true; } }

  // ---------- chamadas ao sistema ----------
  svc(n) {
    const c = this.cpu, r = c.r, mem = this.mem, t = this.cur;
    this.svcCount.set(n, (this.svcCount.get(n) || 0) + 1);
    if (this.svcLog.length < 24) this.svcLog.push(n);
    const ns = (lo, hi) => (hi >>> 0) * 4294967296 + (lo >>> 0);
    const wait = (handles, all, timeout, isN) => {
      const os = handles.map((h) => this.obj(h));
      if (all ? os.every((o) => this.isSignaled(o, t)) : os.some((o) => this.isSignaled(o, t))) {
        if (all) { os.forEach((o) => this.acquire(o, t)); r[0] = 0; } else { const i = os.findIndex((o) => this.isSignaled(o, t)); this.acquire(os[i], t); r[0] = 0; if (isN) r[1] = i; }
        return;
      }
      if (timeout === 0) { r[0] = 0x09401BFE; return; }
      t.state = 'wait'; t.wait = { handles, all, until: timeout > 0 ? this.ticks + timeout * 0.268111856 : undefined };
      this.yieldNow();
    };
    switch (n) {
      case 0x01: { // ControlMemory
        const op = r[0] >>> 0, a0 = r[1] >>> 0, size = r[3] >>> 0, kind = op & 0xFF;
        if (kind === 3) { // COMMIT
          if (op & 0x10000) { const base = 0x30000000 + this.linearNext; this.linearNext += (size + 0xFFF) & ~0xFFF; r[1] = base; }
          else { r[1] = a0 || 0x08000000; this.heapUsed += size; }
        } else r[1] = a0;
        r[0] = 0; return;
      }
      case 0x02: r[0] = 0; r[1] = r[2] & ~0xFFF; r[2] = 0x10000; r[3] = 3; r[4] = 0; r[5] = 0; return; // QueryMemory
      case 0x03: this.stopped = 'o jogo pediu para encerrar (ExitProcess)'; c.halted = true; this.yieldNow(); return;
      case 0x08: { // CreateThread(r0 prio, r1 entry, r2 arg, r3 stack)
        const nt = this.newThread(r[1] >>> 0, r[2], r[3] & ~7, r[0]); r[0] = 0; r[1] = nt.h; return;
      }
      case 0x09: t.state = 'dead'; this.handles.get(t.h).signaled = true; this.yieldNow(); return;
      case 0x0A: { const d = ns(r[0], r[1]); if (d > 0) { t.state = 'wait'; t.wait = { sleepUntil: this.ticks + d * 0.268111856 }; } this.yieldNow(); return; }
      case 0x0B: r[0] = 0; r[1] = t.prio; return;
      case 0x0C: { const o = this.obj(r[0]); if (o && o.t) o.t.prio = r[1]; r[0] = 0; return; }
      case 0x13: { const h = this.addHandle({ type: 'mutex', owner: r[1] ? t : null, lock: r[1] ? 1 : 0 }); r[0] = 0; r[1] = h; return; }
      case 0x14: { const o = this.obj(r[0]); if (o && o.owner === t) { o.lock--; if (o.lock <= 0) { o.owner = null; o.lock = 0; this.wake(); } } r[0] = 0; return; }
      case 0x15: { const h = this.addHandle({ type: 'semaphore', count: r[1], max: r[2] }); r[0] = 0; r[1] = h; return; }
      case 0x16: { const o = this.obj(r[1]); const prev = o ? o.count : 0; if (o) o.count += r[2]; r[0] = 0; r[1] = prev; this.wake(); return; }
      case 0x17: { const h = this.addHandle({ type: 'event', reset: r[1], signaled: false }); r[0] = 0; r[1] = h; return; }
      case 0x18: { const o = this.obj(r[0]); if (o) o.signaled = true; r[0] = 0; this.wake(); return; }
      case 0x19: { const o = this.obj(r[0]); if (o) o.signaled = false; r[0] = 0; return; }
      case 0x1A: { const h = this.addHandle({ type: 'timer', reset: r[1], signaled: false }); r[0] = 0; r[1] = h; return; }
      case 0x1B: { const o = this.obj(r[0]); if (o) { o.at = this.ticks + ns(r[2], r[3]) * 0.268111856; o.period = ns(r[1], c.r[4]) * 0.268111856; } r[0] = 0; return; }
      case 0x1C: { const o = this.obj(r[0]); if (o) o.at = undefined; r[0] = 0; return; }
      case 0x1D: { const o = this.obj(r[0]); if (o) o.signaled = false; r[0] = 0; return; }
      case 0x1E: { const h = this.addHandle({ type: 'shmem', addr: r[1] >>> 0, size: r[2] >>> 0 }); r[0] = 0; r[1] = h; return; } // CreateMemoryBlock
      case 0x1F: { const o = this.obj(r[0]); if (o && o.type === 'shmem') { const a = r[1] >>> 0; if (o.data) this.mem.load(a, o.data); o.addr = a; } r[0] = 0; return; } // MapMemoryBlock
      case 0x20: r[0] = 0; return;
      case 0x21: r[0] = 0; r[1] = this.addHandle({ type: 'arbiter' }); return;
      case 0x22: { // ArbitrateAddress(r0 arb, r1 addr, r2 type, r3 value)
        const addr = r[1] >>> 0, type = r[2], val = r[3];
        if (type === 0) { // signal
          let woken = 0;
          for (const o of this.threads) if (o.state === 'wait' && o.wait && o.wait.arb === addr && (val < 0 || woken < val)) { o.state = 'ready'; o.wait = null; o.regs[0] = 0; woken++; }
          r[0] = 0; return;
        }
        const cur = mem.r32(addr);
        if (cur < val) { if (type === 2 || type === 4) mem.w32(addr, cur - 1); t.state = 'wait'; t.wait = { arb: addr }; r[0] = 0; this.yieldNow(); return; }
        r[0] = 0; return;
      }
      case 0x23: r[0] = 0; return; // CloseHandle
      case 0x24: wait([r[0]], false, ns(r[2], r[3]), false); return;
      case 0x25: { const hs = []; for (let i = 0; i < r[2]; i++) hs.push(mem.r32((r[1] >>> 0) + i * 4)); if (!hs.length) { r[0] = 0; return; } wait(hs, !!r[3], ns(r[0], r[4]), true); return; }
      case 0x27: { const o = this.obj(r[1]); r[0] = 0; r[1] = o ? this.addHandle(o) : r[1]; return; }
      case 0x28: { const tk = Math.floor(this.ticks); r[0] = tk | 0; r[1] = Math.floor(tk / 4294967296); return; }
      case 0x2A: r[0] = 0; r[1] = this.heapUsed; r[2] = 0; return; // GetSystemInfo
      case 0x2B: r[0] = 0; if (r[2] === 20) { r[1] = 0xFC000000 | 0; r[2] = 0; } else if (r[2] === 2) { r[1] = this.heapUsed; r[2] = 0; } else { r[1] = 0; r[2] = 0; } return;
      case 0x2D: { const name = this.cstr(r[1] >>> 0); r[0] = 0; r[1] = this.addHandle({ type: 'session', svc: name }); return; }
      case 0x32: this.ipc(r[0]); return;
      case 0x35: r[0] = 0; r[1] = 0x28; return;
      case 0x37: { const o = this.obj(r[1]); r[0] = 0; r[1] = o && o.t ? o.t.id + 1 : t.id + 1; return; }
      case 0x38: r[0] = 0; r[1] = this.addHandle({ type: 'reslimit' }); return;
      case 0x39: case 0x3A: { const out = r[0] >>> 0, names = r[2] >>> 0, cnt = r[3]; for (let i = 0; i < cnt; i++) { const k = mem.r32(names + i * 4); const v = n === 0x39 ? (k === 1 ? 0x18 : 0x100) : 0; mem.w32(out + i * 8, v); mem.w32(out + i * 8 + 4, 0); } r[0] = 0; return; }
      case 0x3C: this.stopped = 'Break chamado pelo jogo (' + (r[0] >>> 0) + ')'; c.halted = true; this.yieldNow(); return;
      case 0x3D: { const s = this.cstr(r[0] >>> 0, r[1]); if (this.debug.length < 20) this.debug.push(s); r[0] = 0; return; }
      default: this.unknownSvc.add(n); r[0] = 0; return;
    }
  }
  cstr(a, max) { let s = ''; for (let i = 0; i < (max || 64); i++) { const c = this.mem.r8(a + i); if (!c) break; s += String.fromCharCode(c); } return s; }

  // ---------- serviços (IPC) ----------
  ipc(h) {
    const o = this.obj(h), mem = this.mem, cb = this.cur.tls + 0x80, r = this.cpu.r;
    r[0] = 0;
    if (!o) return;
    const hdr = mem.r32(cb) >>> 0, id = hdr >>> 16, P = (i) => mem.r32(cb + i * 4), S = (i, v) => mem.w32(cb + i * 4, v);
    const reply = (nNormal, nTrans) => { S(0, (id << 16) | (nNormal << 6) | (nTrans || 0)); S(1, 0); };
    const svc = o.svc || '';
    const ok = (n) => { reply(n || 1, 0); for (let i = 2; i <= (n || 1); i++) S(i, 0); };
    const giveHandle = (pos, hh) => { S(pos, 0); S(pos + 1, hh); };
    if (svc === 'srv:' || svc === 'srv:pm') {
      if (id === 0x0005) { const name = this.cstr(cb + 4, Math.min(8, P(3))); reply(1, 2); giveHandle(2, this.addHandle({ type: 'session', svc: name })); return; } // GetServiceHandle
      if (id === 0x0002) { reply(1, 2); giveHandle(2, this.addHandle({ type: 'semaphore', count: 0, max: 64 })); return; } // EnableNotification
      if (id === 0x000B) { reply(2, 0); S(2, 0); return; } // ReceiveNotification
      ok(1); return;
    }
    if (svc.startsWith('APT:')) {
      switch (id) {
        case 0x0001: { if (!this.aptLock) this.aptLock = this.addHandle({ type: 'mutex', owner: null, lock: 0 }); reply(5, 2); S(2, 0); S(3, 0); S(4, 0); giveHandle(5, this.aptLock); return; } // GetLockHandle
        case 0x0002: { this.aptNotif = this.addHandle({ type: 'event', reset: 0, signaled: false }); this.aptResume = this.addHandle({ type: 'event', reset: 0, signaled: true }); reply(1, 3); S(2, 0x04000000); S(3, this.aptNotif); S(4, this.aptResume); return; } // Initialize
        case 0x0009: reply(2, 0); S(2, 1); return; // IsRegistered
        case 0x000B: reply(2, 0); S(2, 0); return; // InquireNotification
        case 0x000D: case 0x000E: reply(4, 4); S(2, 0x300); S(3, 1); S(4, 0); S(5, 0); S(6, 0); return; // Glance/ReceiveParameter: WAKEUP
        case 0x0043: reply(3, 0); S(2, 0); S(3, 0); return; // GetAppletManInfo
        case 0x0044: { if (!this.fontMem) this.fontMem = this.addHandle({ type: 'shmem', addr: 0x18000000, size: 0x332000 }); reply(2, 2); S(2, 0x18000000); giveHandle(3, this.fontMem); return; } // GetSharedFont
        case 0x004B: reply(2, 2); S(2, 0); S(3, 0); S(4, 0); return; // AppletUtility
        case 0x0050: reply(2, 0); S(2, 30); return; // GetApplicationCpuTimeLimit
        case 0x0101: reply(3, 0); S(2, 0); S(3, 0); return; // GetTargetPlatform
        case 0x0102: reply(2, 0); S(2, 0); return; // CheckNew3DS
        default: ok(1); return;
      }
    }
    if (svc === 'gsp::Gpu') return this.gsp(id, P, S, reply, giveHandle, cb);
    if (svc === 'hid:USER' || svc === 'hid:SPVR') {
      if (id === 0x000A) { // GetIPCHandles
        if (!this.hidMemH) { this.hidMemH = this.addHandle({ type: 'shmem', size: 0x2B0, hid: true }); this.hidEv = []; for (let i = 0; i < 5; i++) this.hidEv.push(this.addHandle({ type: 'event', reset: 1, signaled: false })); }
        reply(1, 7); S(2, 0x14000000); S(3, this.hidMemH); for (let i = 0; i < 5; i++) S(4 + i, this.hidEv[i]); return;
      }
      ok(1); return;
    }
    if (svc === 'cfg:u' || svc === 'cfg:s' || svc === 'cfg:i') {
      if (id === 0x0001) { const size = P(1), blk = P(2) >>> 0, out = P(4) >>> 0; for (let i = 0; i < size; i++) mem.w8(out + i, 0);
        if (blk === 0x000A0002) mem.w8(out, 1); // idioma inglês
        if (blk === 0x000B0000) { mem.w8(out + 2, 1); mem.w8(out + 3, 1); } // país
        if (blk === 0x00050005) { mem.w32(out + 4, 0x40000000); } // estéreo
        ok(1); return; }
      if (id === 0x0002) { reply(2, 0); S(2, 1); return; } // região: EUA
      if (id === 0x0003) { reply(3, 0); S(2, 0x12345678); S(3, 0); return; }
      ok(1); return;
    }
    if (svc.startsWith('fs:')) {
      if (id === 0x080C) { reply(3, 0); S(1, 0xC8804478 | 0); return; } // OpenArchive: sem cartão SD por enquanto
      if (id === 0x0801 || id === 0x0862 || id === 0x0868) { ok(1); return; }
      if (id === 0x0803) { reply(1, 2); S(1, 0xC8804478 | 0); S(3, 0); return; } // OpenFileDirectly
      if (id === 0x0861) { reply(2, 0); S(2, 1); return; } // IsSdmcDetected
      reply(1, 0); S(1, 0xC8804478 | 0); return;
    }
    if (svc === 'ptm:u' || svc === 'ptm:sysm') { if (id === 0x0007) { reply(2, 0); S(2, 1); return; } if (id === 0x0008) { reply(2, 0); S(2, 5); return; } ok(2); return; } // carregando / bateria
    if (svc === 'dsp::DSP') { if (id === 0x0016) { reply(1, 2); giveHandle(2, this.addHandle({ type: 'semaphore', count: 0, max: 1 })); return; } if (id === 0x0011) { reply(2, 0); S(2, 1); return; } ok(3); return; }
    if (svc === 'ac:u' || svc === 'ac:i') { if (id === 0x000D) { reply(2, 0); S(2, 0); return; } ok(2); return; }
    if (!this.unknownIpc.has(svc)) this.unknownIpc.set(svc, id.toString(16));
    ok(3);
  }

  // ---------- GSP (telas e comandos gráficos) ----------
  gsp(id, P, S, reply, giveHandle) {
    switch (id) {
      case 0x0013: { // RegisterInterruptRelayQueue
        this.gspEvent = P(3); if (!this.gspMemH) this.gspMemH = this.addHandle({ type: 'shmem', size: 0x1000, gsp: true });
        reply(2, 2); S(1, 0x2A07); S(2, this.gspThreadId); giveHandle(3, this.gspMemH); return;
      }
      case 0x0016: case 0x0017: case 0x0014: case 0x0008: case 0x0009: case 0x000B: case 0x001F: reply(1, 0); return; // direitos, cache, LCD
      case 0x0001: case 0x0002: { // WriteHWRegs (com máscara)
        const reg = P(1) >>> 0, size = P(2), src = P(id === 1 ? 4 : 6) >>> 0;
        for (let i = 0; i < size; i += 4) this.gpuReg(reg + i, this.mem.r32(src + i)); reply(1, 0); return;
      }
      case 0x0004: { const size = P(2), out = P(0x41) >>> 0; for (let i = 0; i < size; i += 4) this.mem.w32(out + i, 0); reply(1, 0); return; } // ReadHWRegs
      case 0x0005: { // SetBufferSwap(screen, FrameBufferInfo)
        const scr = P(1) & 1; this.fb[scr] = { addr: P(3) >>> 0, stride: P(5), fmt: P(6) & 7 }; this.fbSeen = true; reply(1, 0); return;
      }
      case 0x000C: this.gxQueue(); reply(1, 0); return; // TriggerCmdReqQueue
      case 0x0018: reply(2, 0); S(2, 0); return; // ImportDisplayCaptureInfo
      default: reply(1, 0); return;
    }
  }
  gpuReg(a, v) {
    // registros do LCD: endereço do framebuffer e formato (0x400468.. topo, 0x400568.. baixo)
    const base = [0x400400, 0x400500];
    for (let s = 0; s < 2; s++) {
      const o = a - base[s];
      if (o === 0x68) { this.fb[s] = Object.assign(this.fb[s] || { stride: s ? 960 : 960, fmt: 1 }, { paddr: v >>> 0 }); this.fbSeen = true; }
      if (o === 0x70) { if (this.fb[s]) this.fb[s].fmt = v & 7; }
    }
  }
  gspMem() { const o = this.handles.get(this.gspMemH); return o && o.addr ? o.addr : 0; }
  gspIrq(n) { // coloca a interrupção na fila do GSP e acorda o jogo
    const base = this.gspMem(); if (!base) return;
    const q = base + this.gspThreadId * 0x40, m = this.mem, w = m.r32(q) >>> 0, start = w & 0xFF, count = (w >>> 8) & 0xFF;
    if (count < 0x34) { const idx = (start + count) % 0x34; m.w8(q + 0xC + idx, n); m.w8(q + 1, count + 1); }
    m.w8(q + 2, 0);
    const ev = this.obj(this.gspEvent); if (ev) ev.signaled = true;
  }
  gxQueue() {
    const base = this.gspMem(); if (!base) return;
    const m = this.mem, q = base + 0x800 + this.gspThreadId * 0x200;
    for (let guard = 0; guard < 16; guard++) {
      const hdr = m.r32(q) >>> 0, idx = hdr & 0xFF, total = (hdr >>> 8) & 0xFF;
      if (!total) break;
      const c = q + 0x20 + idx * 0x20, P = (i) => m.r32(c + i * 4) >>> 0, cmd = P(0) & 0xFF;
      if (cmd === 0) { const src = P(1), dst = P(2), size = P(3); for (let i = 0; i < size; i++) m.w8(this.v(dst) + i, m.r8(this.v(src) + i)); this.gspIrq(6); }
      else if (cmd === 1) { this.cmdLists++; this.gspIrq(5); } // lista de comandos da GPU 3D: próxima etapa (PICA200)
      else if (cmd === 2) { for (let k = 0; k < 2; k++) { const st = P(1 + k * 3), val = P(2 + k * 3), end = P(3 + k * 3), ctl = k ? P(7) >>> 16 : P(7) & 0xFFFF; if (!st) continue; const w = (ctl >> 8) & 3; const bpp = w === 0 ? 2 : w === 1 || w === 3 ? 3 : 4; for (let a = this.v(st); a < this.v(end); a += bpp) { m.w8(a, val); m.w8(a + 1, val >>> 8); if (bpp > 2) m.w8(a + 2, val >>> 16); if (bpp > 3) m.w8(a + 3, val >>> 24); } this.gspIrq(k); } }
      else if (cmd === 3) { this.displayTransfer(P(1), P(2), P(3), P(4), P(5)); this.gspIrq(4); }
      else if (cmd === 4) { const src = this.v(P(1)), dst = this.v(P(2)), size = P(3); for (let i = 0; i < size; i++) m.w8(dst + i, m.r8(src + i)); this.gspIrq(4); }
      m.w32(q, ((idx + 1) % 15) | ((total - 1) << 8));
    }
    this.wake();
  }
  v(a) { // físico → virtual (VRAM e FCRAM linear)
    a >>>= 0;
    if (a >= 0x18000000 && a < 0x18600000) return a - 0x18000000 + 0x1F000000;
    if (a >= 0x20000000 && a < 0x28000000) return a - 0x20000000 + 0x30000000;
    return a;
  }
  displayTransfer(src, dst, inDim, outDim, flags) {
    const m = this.mem, iw = inDim & 0xFFFF, ih = inDim >>> 16, ow = outDim & 0xFFFF, oh = outDim >>> 16;
    const inF = (flags >> 8) & 7, outF = (flags >> 12) & 7, tiledIn = !(flags & 2) && !(flags & 8), flip = flags & 1;
    const bpp = (f) => [4, 3, 2, 2, 2][f] || 4, bi = bpp(inF), bo = bpp(outF), s = this.v(src), d = this.v(dst);
    const W = Math.min(iw, ow), H = Math.min(ih, oh);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let si;
      if (tiledIn) { const tx = x >> 3, ty = y >> 3, lx = x & 7, ly = y & 7; let mo = 0; for (let b = 0; b < 3; b++) mo |= (((lx >> b) & 1) << (2 * b)) | (((ly >> b) & 1) << (2 * b + 1)); si = ((ty * (iw >> 3) + tx) * 64 + mo) * bi; }
      else si = (y * iw + x) * bi;
      const rgba = this.readPx(s + si, inF), yy = flip ? H - 1 - y : y;
      this.writePx(d + (yy * ow + x) * bo, outF, rgba);
    }
  }
  readPx(a, f) {
    const m = this.mem;
    switch (f) {
      case 0: return [m.r8(a + 3), m.r8(a + 2), m.r8(a + 1), m.r8(a)];
      case 1: return [m.r8(a + 2), m.r8(a + 1), m.r8(a), 255];
      case 2: { const v = m.r16(a); return [((v >> 11) & 31) * 255 / 31 | 0, ((v >> 5) & 63) * 255 / 63 | 0, (v & 31) * 255 / 31 | 0, 255]; }
      case 3: { const v = m.r16(a); return [((v >> 11) & 31) * 255 / 31 | 0, ((v >> 6) & 31) * 255 / 31 | 0, ((v >> 1) & 31) * 255 / 31 | 0, v & 1 ? 255 : 0]; }
      default: { const v = m.r16(a); return [((v >> 12) & 15) * 17, ((v >> 8) & 15) * 17, ((v >> 4) & 15) * 17, (v & 15) * 17]; }
    }
  }
  writePx(a, f, c) {
    const m = this.mem, [r, g, b, al] = c;
    switch (f) {
      case 0: m.w8(a, al); m.w8(a + 1, b); m.w8(a + 2, g); m.w8(a + 3, r); return;
      case 1: m.w8(a, b); m.w8(a + 1, g); m.w8(a + 2, r); return;
      case 2: m.w16(a, ((r >> 3) << 11) | ((g >> 2) << 5) | (b >> 3)); return;
      case 3: m.w16(a, ((r >> 3) << 11) | ((g >> 3) << 6) | ((b >> 3) << 1) | (al > 127 ? 1 : 0)); return;
      default: m.w16(a, ((r >> 4) << 12) | ((g >> 4) << 8) | ((b >> 4) << 4) | (al >> 4));
    }
  }

  // ---------- entrada ----------
  press(k, down) { const b = 1 << [4, 5, 6, 7, 0, 1, 2, 3, 8, 9, 10, 11][k]; if (down) this.keys |= b; else this.keys &= ~b; }
  touch(x, y, down) { this.touchOn = down; if (down) { this.tx = Math.max(0, Math.min(319, x | 0)); this.ty = Math.max(0, Math.min(239, y | 0)); } }
  hidUpdate() {
    const o = this.handles.get(this.hidMemH); if (!o || !o.addr) return;
    const m = this.mem, a = o.addr, tk = Math.floor(this.ticks);
    m.w32(a, tk | 0); m.w32(a + 4, Math.floor(tk / 4294967296)); m.w32(a + 8, (tk - 1) | 0); m.w32(a + 12, Math.floor((tk - 1) / 4294967296));
    m.w32(a + 0x10, 1); const prev = m.r32(a + 0x1C + 0x10) >>> 0;
    m.w32(a + 0x18, this.keys); m.w32(a + 0x28 + 0x10, this.keys); m.w32(a + 0x2C + 0x10, (this.keys & ~prev)); m.w32(a + 0x30 + 0x10, (prev & ~this.keys));
    const tb = a + 42 * 4; m.w32(tb, tk | 0); m.w32(tb + 8, (tk - 1) | 0); m.w32(tb + 0x10, 1);
    m.w32(tb + 8 * 4 + 8, this.tx | (this.ty << 16)); m.w32(tb + 8 * 4 + 12, this.touchOn ? 1 : 0);
    for (const h of this.hidEv || []) { const e = this.handles.get(h); if (e) e.signaled = true; }
  }

  // ---------- quadro ----------
  runFrame() {
    this.frame++;
    const c = this.cpu;
    if (c && !this.stopped) {
      this.hidUpdate();
      // vblank do GSP (topo e baixo) e temporizadores
      this.gspIrq(2); this.gspIrq(3);
      for (const o of this.handles.values()) if (o.type === 'timer' && o.at !== undefined && this.ticks >= o.at) { o.signaled = true; o.at = o.period > 0 ? o.at + o.period : undefined; }
      this.wake();
      let budget = 268111856 / 60, used = 0, spins = 0;
      while (used < budget && !this.stopped && spins < 200) {
        spins++;
        const t = this.pick();
        if (!t) break;
        if (t !== this.cur) { this.saveCtx(this.cur); this.cur = t; this.loadCtx(t); }
        this.needSwitch = false; const before = c.cycles; c.tgt = c.cycles + Math.min(budget - used, 2000000);
        try { c.run(); } catch (e) { this.stopped = 'erro no processador: ' + e.message; }
        const d = c.cycles - before; used += d; this.ticks += d;
        if (c.unknown && !this.stopped) this.stopped = 'instrução ainda não suportada ' + (c.unknown >>> 0).toString(16).toUpperCase().padStart(8, '0') + ' em ' + ((c.unknownPc >>> 0).toString(16).toUpperCase());
        if (this.needSwitch) { this.saveCtx(this.cur); this.wake(); }
      }
      if (used < budget) this.ticks += budget - used;
      this.saveCtx(this.cur);
    }
    if (this.present()) return;
    if ((this.frame & 15) === 1) this.drawInfo();
  }
  present() {
    // lê a informação de troca de tela que o jogo escreve na memória do GSP
    const base = this.gspMem(), m = this.mem;
    if (base) for (let s = 0; s < 2; s++) {
      const a = base + 0x200 + this.gspThreadId * 0x80 + s * 0x40, idx = m.r8(a) & 1, flag = m.r8(a + 1);
      const fi = a + 4 + idx * 0x1C, addr = m.r32(fi + 4) >>> 0;
      if (addr) { this.fb[s] = { addr, stride: m.r32(fi + 12), fmt: m.r32(fi + 16) & 7 }; this.fbSeen = true; if (flag) m.w8(a + 1, 0); }
    }
    if (!this.fbSeen) return false;
    const o = this.out; o.fill(0xFF000000);
    for (let s = 0; s < 2; s++) {
      const f = this.fb[s]; if (!f) continue;
      const W = s ? 320 : 400, ox = s ? 40 : 0, oy = s ? 240 : 0, bpp = [4, 3, 2, 2, 2][f.fmt] || 3, stride = f.stride || 240 * bpp;
      const src = f.addr ? f.addr : this.v(f.paddr || 0); if (!src) continue;
      const fmt = f.fmt;
      for (let x = 0; x < W; x++) {
        const col = src + x * stride; let a = col + 239 * bpp, oi = oy * N3DS_W + ox + x;
        for (let y = 0; y < 240; y++, a -= bpp, oi += N3DS_W) {
          let r, g, b;
          if (fmt === 1) { b = m.r8(a); g = m.r8(a + 1); r = m.r8(a + 2); }
          else if (fmt === 0) { b = m.r8(a + 1); g = m.r8(a + 2); r = m.r8(a + 3); }
          else { const c = this.readPx(a, fmt); r = c[0]; g = c[1]; b = c[2]; }
          o[oi] = 0xFF000000 | (b << 16) | (g << 8) | r;
        }
      }
    }
    return true;
  }

  // ---------- tela de informações ----------
  drawInfo() {
    const o = this.out; o.fill(0xFF000000);
    const rect = (x, y, w, h, c) => { for (let j = y; j < y + h; j++) o.fill(c, j * N3DS_W + x, j * N3DS_W + x + w); };
    rect(0, 0, 400, 240, 0xFF2A1A1A); rect(40, 240, 320, 240, 0xFF3A2424); rect(0, 0, 400, 22, 0xFF7A4FE0);
    let y = 6;
    const text = (s, x, yy, col) => {
      s = String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
      for (let i = 0; i < s.length; i++) {
        const gl = N3DS_FONT[s[i]] || N3DS_FONT['?'];
        for (let py = 0; py < 7; py++) for (let px = 0; px < 5; px++) if (gl[py * 5 + px] === '1') { const X = x + i * 6 + px, Y = yy + py; if (X < N3DS_W && Y < N3DS_H) o[Y * N3DS_W + X] = col; }
      }
    };
    const W = 0xFFFFFFFF, G = 0xFFB0B0B0, OK = 0xFF7AE07A, BAD = 0xFF6A6AFF;
    text('LE POCKET 3DS - EM PRODUCAO', 8, y, W); y = 30;
    const I = this.info, line = (s, c) => { text(String(s).slice(0, 64), 8, y, c || G); y += 11; };
    line('FORMATO: ' + I.kind, W);
    if (I.code) line('CODIGO: ' + I.code);
    if (I.programId) line('ID: ' + I.programId);
    if (I.longName) line('NOME: ' + I.longName.replace(/[^\x20-\x7E]/g, ''));
    if (I.name) line('EXHEADER: ' + I.name);
    line('CRIPTOGRAFADO: ' + (I.encrypted ? 'SIM' : 'NAO'), I.encrypted ? BAD : OK);
    if (I.codeSize) line('CODIGO CARREGADO: ' + (I.codeSize / 1024 | 0) + ' KB' + (I.compressed ? ' (DESCOMPACTADO)' : ''), OK);
    for (const p of I.problems) line(p, BAD);
    if (this.unknownIpc && this.unknownIpc.size) line('SERVICOS SEM SUPORTE: ' + [...this.unknownIpc.keys()].join(' '));
    if (this.cmdLists) line('LISTAS DA GPU 3D: ' + this.cmdLists + ' (PICA200: PROXIMA ETAPA)');
    y = 250;
    text('PROCESSADOR ARM11', 48, y, W); y += 12;
    const L = (s, c) => { text(String(s).slice(0, 52), 48, y, c || G); y += 11; };
    if (!this.cpu) L('NAO INICIADO');
    else {
      L('CICLOS: ' + Math.floor(this.ticks) + '  THREADS: ' + this.threads.length);
      L('PC: ' + ((this.cpu.r[15] >>> 0).toString(16).toUpperCase()) + (this.cpu.cT ? ' THUMB' : ' ARM'));
      L('SVC: ' + this.svcLog.map((n) => n.toString(16).toUpperCase()).join(' '));
      for (const d of this.debug.slice(-3)) L('> ' + d);
      if (this.stopped) L('PAROU: ' + this.stopped, BAD); else L('RODANDO', OK);
    }
  }

  // ---------- contrato comum ----------
  getSave() { return new Uint8Array(0); } loadSave() {} setAudioRate() {}
  saveState() { return null; } loadState() {}
  diag() {
    const I = this.info, c = this.cpu;
    return ['3DS em produção', 'formato ' + I.kind + ' · código ' + (I.code || '-') + ' · criptografado ' + (I.encrypted ? 'sim' : 'não'),
      c ? 'ARM11 pc ' + (c.r[15] >>> 0).toString(16) + ' ciclos ' + Math.floor(this.ticks) + ' threads ' + this.threads.length + ' (' + this.threads.map((t) => t.state[0]).join('') + ')' : 'ARM11 não iniciado',
      'SVC ' + this.svcLog.map((n) => n.toString(16)).join(' ') + (this.unknownSvc.size ? ' · sem suporte ' + [...this.unknownSvc].map((n) => n.toString(16)).join(' ') : ''),
      'serviços ' + [...new Set([...this.handles.values()].filter((o) => o.type === 'session').map((o) => o.svc))].join(' '),
      this.unknownIpc.size ? 'IPC sem suporte ' + [...this.unknownIpc].map(([k, v]) => k + ':' + v).join(' ') : '',
      'tela ' + (this.fbSeen ? 'sim' : 'não') + ' · listas GPU ' + this.cmdLists,
      this.debug.length ? 'debug ' + this.debug.slice(-3).join(' | ') : '',
      this.stopped ? 'parou: ' + this.stopped : 'rodando'].concat(I.problems).filter(Boolean).join('\n');
  }
}
// memória virtual do aplicativo: 16 MB fixos no começo (código) + páginas de 1 MB criadas sob demanda
class N3DSMem {
  constructor() {
    this.low = new ArrayBuffer(0x1000000); this.low8 = new Uint8Array(this.low); this.low16 = new Uint16Array(this.low); this.low32 = new Int32Array(this.low);
    this.pages = new Map(); this.lp = -1; this.lpg = null;
  }
  pg(a) {
    const k = a >>> 20; if (k === this.lp) return this.lpg;
    let p = this.pages.get(k); if (!p) { const b = new ArrayBuffer(0x100000); p = { b8: new Uint8Array(b), b16: new Uint16Array(b), b32: new Int32Array(b) }; this.pages.set(k, p); }
    this.lp = k; this.lpg = p; return p;
  }
  load(addr, data) { for (let i = 0; i < data.length; i++) this.w8(addr + i, data[i]); }
  r8(a) { a >>>= 0; return a < 0x1000000 ? this.low8[a] : this.pg(a).b8[a & 0xFFFFF]; }
  r16(a) { a >>>= 0; return a < 0x1000000 ? this.low16[a >> 1] : this.pg(a).b16[(a & 0xFFFFF) >> 1]; }
  r32(a) { a >>>= 0; if (a & 3) return this.r16(a) | (this.r16(a + 2) << 16); return a < 0x1000000 ? this.low32[a >> 2] : this.pg(a).b32[(a & 0xFFFFF) >> 2]; }
  w8(a, v) { a >>>= 0; if (a < 0x1000000) this.low8[a] = v; else this.pg(a).b8[a & 0xFFFFF] = v; }
  w16(a, v) { a >>>= 0; if (a < 0x1000000) this.low16[a >> 1] = v; else this.pg(a).b16[(a & 0xFFFFF) >> 1] = v; }
  w32(a, v) { a >>>= 0; if (a & 3) { this.w16(a, v); this.w16(a + 2, v >>> 16); return; } if (a < 0x1000000) this.low32[a >> 2] = v; else this.pg(a).b32[(a & 0xFFFFF) >> 2] = v; }
}

// ARM11 (ARMv6K + VFPv2): o ARM9 do DS + as instruções novas usadas pelos jogos e homebrew
const ArmBase = (typeof Arm !== 'undefined') ? Arm : require('./armcpu.js').Arm;
class Arm11 extends ArmBase {
  constructor(bus, v5, irqVec, base) {
    super(bus, v5, irqVec, base);
    this.vbuf = new ArrayBuffer(128); this.vs = new Float32Array(this.vbuf); this.vd = new Float64Array(this.vbuf); this.vi = new Int32Array(this.vbuf);
    this.fpscr = 0; this.ge = 0; this.unal = true;
  }
  // a CPU do 3DS lê palavras sem alinhamento (ARMv6), sem girar como no ARM9
  read32(a) { return this.bus.r32(a >>> 0); }
  read16(a) { return this.bus.r16((a & ~1) >>> 0); }
  ext(v, rot, kind) { v = rot ? (v >>> rot) | (v << (32 - rot)) : v; switch (kind) { case 0: return (v << 24) >> 24; case 1: return (v << 16) >> 16; case 2: return v & 0xFF; default: return v & 0xFFFF; } }
  sat(v, bits, signed) { if (signed) { const mx = 2 ** (bits - 1) - 1, mn = -(2 ** (bits - 1)); if (v > mx) { this.cQ = 1; return mx; } if (v < mn) { this.cQ = 1; return mn; } return v; } const mx = 2 ** bits - 1; if (v > mx) { this.cQ = 1; return mx; } if (v < 0) { this.cQ = 1; return 0; } return v; }
  media(op) {
    const r = this.r, rd = (op >>> 12) & 15, rn = (op >>> 16) & 15, rm = op & 15;
    // extensões (SXTB/SXTH/UXTB/UXTH/SXTB16/UXTB16 e versões com soma)
    if ((op & 0x0F8003F0) === 0x06800070) {
      const sub = (op >>> 20) & 7, rot = ((op >>> 10) & 3) * 8, v = r[rm], rv = rot ? (v >>> rot) | (v << (32 - rot)) : v;
      if (sub === 0 || sub === 4) { // SXTB16 / UXTB16
        let lo = rv & 0xFF, hi = (rv >>> 16) & 0xFF; if (sub === 0) { lo = (lo << 24) >> 24; hi = (hi << 24) >> 24; }
        if (rn !== 15) { lo += r[rn] & 0xFFFF; hi += r[rn] >>> 16; }
        r[rd] = (lo & 0xFFFF) | (hi << 16); return true;
      }
      const kind = sub === 2 ? 0 : sub === 3 ? 1 : sub === 6 ? 2 : sub === 7 ? 3 : -1;
      if (kind >= 0) { const e = this.ext(v, rot, kind); r[rd] = rn === 15 ? e : (r[rn] + e) | 0; return true; }
    }
    if ((op & 0x0FFF0FF0) === 0x06BF0F30) { const v = r[rm]; r[rd] = ((v & 0xFF) << 24) | ((v & 0xFF00) << 8) | ((v >>> 8) & 0xFF00) | (v >>> 24); return true; } // REV
    if ((op & 0x0FFF0FF0) === 0x06BF0FB0) { const v = r[rm]; r[rd] = ((v & 0x00FF00FF) << 8) | ((v >>> 8) & 0x00FF00FF); return true; } // REV16
    if ((op & 0x0FFF0FF0) === 0x06FF0FB0) { const v = r[rm]; r[rd] = ((((v & 0xFF) << 8) | ((v >>> 8) & 0xFF)) << 16) >> 16; return true; } // REVSH
    if ((op & 0x0FF00FF0) === 0x06800FB0) { const g = this.ge, a = r[rn], b = r[rm]; let v = 0; for (let i = 0; i < 4; i++) v |= (((g >> i) & 1) ? a : b) & (0xFF << (i * 8)); r[rd] = v; return true; } // SEL
    // USAT / SSAT (e as versões de 16 bits)
    if ((op & 0x0FA00030) === 0x06A00010 || (op & 0x0FE00030) === 0x06E00010) {
      const u = (op >>> 22) & 1, sh = (op >>> 7) & 31, asr = (op >>> 6) & 1, bits = (op >>> 16) & 31;
      let v = r[rm]; if (asr) v = v >> (sh || 31); else v = v << sh;
      r[rd] = u ? this.sat(v, bits, false) : this.sat(v, bits + 1, true); return true;
    }
    // PKHBT / PKHTB
    if ((op & 0x0FF00030) === 0x06800010) { const sh = (op >>> 7) & 31, tb = (op >>> 6) & 1, a = r[rn], b = r[rm];
      if (!tb) r[rd] = (a & 0xFFFF) | ((b << sh) & 0xFFFF0000); else r[rd] = (a & 0xFFFF0000) | ((sh ? b >> sh : b >> 31) & 0xFFFF); return true; }
    // somas/subtrações paralelas: ADD16, ASX, SAX, SUB16, ADD8, SUB8 (normal, com saturação Q, metade H; com e sem sinal)
    if ((op & 0x0F800F10) === 0x06000F10) {
      const kind = (op >>> 20) & 7, o2 = (op >>> 5) & 7, a = r[rn], b = r[rm];
      if (o2 === 5 || o2 === 6) return false;
      const signed = kind <= 3, sat = kind === 2 || kind === 6, half = kind === 3 || kind === 7;
      const lanes = o2 >= 4 ? 4 : 2, w = 32 / lanes, mask = lanes === 4 ? 0xFF : 0xFFFF;
      const lane = (v, i) => { const x = (v >>> (i * w)) & mask; return signed ? (x << (32 - w)) >> (32 - w) : x; };
      let res = 0, ge = 0;
      for (let i = 0; i < lanes; i++) {
        let v, sub;
        if (o2 === 1) { sub = i === 0; v = sub ? lane(a, 0) - lane(b, 1) : lane(a, 1) + lane(b, 0); } // ASX
        else if (o2 === 2) { sub = i === 1; v = sub ? lane(a, 1) - lane(b, 0) : lane(a, 0) + lane(b, 1); } // SAX
        else { sub = o2 === 3 || o2 === 7; v = sub ? lane(a, i) - lane(b, i) : lane(a, i) + lane(b, i); }
        if (half) v = v >> 1;
        else if (sat) v = signed ? Math.max(-(mask + 1) / 2, Math.min((mask - 1) / 2, v)) : Math.max(0, Math.min(mask, v));
        else if (signed ? v >= 0 : (sub ? v >= 0 : v > mask)) ge |= (lanes === 4 ? 1 : 3) << (i * (lanes === 4 ? 1 : 2));
        res |= (v & mask) << (i * w);
      }
      r[rd] = res; if (!sat && !half) this.ge = ge; return true;
    }
    // SMUAD/SMUSD/SMLAD/SMLSD
    if ((op & 0x0FF00090) === 0x07000010) {
      const d = (op >>> 16) & 15, ra = (op >>> 12) & 15, N = r[op & 15], M0 = r[(op >>> 8) & 15], M = (op & 0x20) ? (M0 >>> 16) | (M0 << 16) : M0;
      const lo = ((N << 16) >> 16) * ((M << 16) >> 16), hi = (N >> 16) * (M >> 16);
      let v = (op & 0x40) ? lo - hi : lo + hi; if (ra !== 15) v += r[ra]; r[d] = v | 0; return true;
    }
    // SMMUL / SMMLA / SMMLS
    if ((op & 0x0FF000D0) === 0x07500010 || (op & 0x0FF000D0) === 0x075000D0) {
      const d = (op >>> 16) & 15, ra = (op >>> 12) & 15, round = op & 0x20, p = BigInt(r[op & 15]) * BigInt(r[(op >>> 8) & 15]);
      let v = (op & 0xC0) === 0xC0 ? (BigInt(r[ra]) << 32n) - p : (ra !== 15 ? (BigInt(r[ra]) << 32n) + p : p);
      if (round) v += 0x80000000n; r[d] = Number(BigInt.asIntN(32, v >> 32n)); return true;
    }
    // UMAAL
    if ((op & 0x0FF000F0) === 0x00400090) { const lo = (op >>> 12) & 15, hi = (op >>> 16) & 15, v = BigInt(r[op & 15] >>> 0) * BigInt(r[(op >>> 8) & 15] >>> 0) + BigInt(r[lo] >>> 0) + BigInt(r[hi] >>> 0); r[lo] = Number(BigInt.asIntN(32, v)); r[hi] = Number(BigInt.asIntN(32, v >> 32n)); return true; }
    return false;
  }
  arm(op) {
    const r = this.r;
    if ((op & 0x0F000000) === 0x0F000000) { this.swi(op & 0xFF); return; } // SVC do 3DS: número no byte de baixo
    const k = (op >>> 25) & 7;
    if (k === 3 && (op & 0x10)) { if (this.media(op)) return; }
    if ((op & 0x0FF000F0) === 0x00400090 && this.media(op)) return;
    // LDREX/STREX (palavra, dupla, byte, meia) — um núcleo só, sempre dá certo
    if ((op & 0x0F900FFF) === 0x01900F9F) { const kk = (op >>> 21) & 3, a = r[(op >>> 16) & 15], d = (op >>> 12) & 15;
      if (kk === 0) r[d] = this.read32(a); else if (kk === 1) { r[d] = this.read32(a); r[d + 1] = this.read32(a + 4); } else if (kk === 2) r[d] = this.read8(a); else r[d] = this.read16(a); return; }
    if ((op & 0x0F900FF0) === 0x01800F90) { const kk = (op >>> 21) & 3, a = r[(op >>> 16) & 15], t = op & 15;
      if (kk === 0) this.write32(a, r[t]); else if (kk === 1) { this.write32(a, r[t]); this.write32(a + 4, r[t + 1]); } else if (kk === 2) this.write8(a, r[t]); else this.write16(a, r[t]);
      r[(op >>> 12) & 15] = 0; return; }
    if ((op & 0x0FFFFF00) === 0x0320F000) return; // NOP/YIELD/WFE/WFI/SEV
    if ((op & 0x0F000F10) === 0x0E000F10) { if (op & 0x100000) { const id = (((op >>> 16) & 15) << 8) | ((op & 15) << 4) | ((op >>> 5) & 7); r[(op >>> 12) & 15] = this.bus.cp15r(id); } return; } // MRC/MCR p15
    if (((op >>> 8) & 14) === 10 && (k === 6 || k === 7)) { this.vfp(op); return; } // VFP (coprocessadores 10 e 11)
    super.arm(op);
  }
  // ----- VFPv2 -----
  fcmp(a, b) { let f; if (a !== a || b !== b) f = 0x3; else if (a === b) f = 0x6; else if (a < b) f = 0x8; else f = 0x2; this.fpscr = (this.fpscr & 0x0FFFFFFF) | (f << 28); }
  rint(v) { const m = (this.fpscr >>> 22) & 3; if (m === 1) return Math.ceil(v); if (m === 2) return Math.floor(v); if (m === 3) return Math.trunc(v); const f = Math.floor(v), d = v - f; return d > 0.5 ? f + 1 : d < 0.5 ? f : (f % 2 === 0 ? f : f + 1); }
  vfp(op) {
    const r = this.r, dbl = (op >>> 8) & 1, k = (op >>> 25) & 7, S = this.vs, D = this.vd, I = this.vi;
    const sd = ((op >>> 11) & 0x1E) | ((op >>> 22) & 1), sn = ((op >>> 15) & 0x1E) | ((op >>> 7) & 1), sm = ((op & 15) << 1) | ((op >>> 5) & 1);
    const dd = (op >>> 12) & 15, dn = (op >>> 16) & 15, dm = op & 15;
    if (k === 6) {
      if ((op & 0x0FE00000) === 0x0C400000) { // VMOV dois registradores
        const rt = (op >>> 12) & 15, rt2 = (op >>> 16) & 15, L = op & 0x100000;
        if (dbl) { if (L) { r[rt] = I[dm * 2]; r[rt2] = I[dm * 2 + 1]; } else { I[dm * 2] = r[rt]; I[dm * 2 + 1] = r[rt2]; } }
        else { if (L) { r[rt] = I[sm]; r[rt2] = I[(sm + 1) & 31]; } else { I[sm] = r[rt]; I[(sm + 1) & 31] = r[rt2]; } }
        return;
      }
      const P = op & 0x01000000, U = op & 0x00800000, W = op & 0x00200000, L = op & 0x00100000, rn = (op >>> 16) & 15, imm = op & 0xFF;
      let base = rn === 15 ? (r[15] & ~3) : r[rn];
      if (P && !W) { const a = (base + (U ? imm * 4 : -imm * 4)) >>> 0; // VLDR / VSTR
        if (dbl) { if (L) { I[dd * 2] = this.read32(a); I[dd * 2 + 1] = this.read32(a + 4); } else { this.write32(a, I[dd * 2]); this.write32(a + 4, I[dd * 2 + 1]); } }
        else { if (L) I[sd] = this.read32(a); else this.write32(a, I[sd]); }
        return; }
      // VLDM / VSTM (e PUSH/POP)
      let a = P ? (base - imm * 4) >>> 0 : base >>> 0; const first = dbl ? dd * 2 : sd, words = dbl ? (imm & ~1) : imm;
      for (let i = 0; i < words; i++) { const reg = (first + i) & 31; if (L) I[reg] = this.read32(a + i * 4); else this.write32(a + i * 4, I[reg]); }
      if (W) r[rn] = U ? (base + imm * 4) | 0 : (base - imm * 4) | 0;
      return;
    }
    // k === 7
    if (op & 0x10) { // transferências de registrador
      const rt = (op >>> 12) & 15, L = op & 0x100000, opc = (op >>> 21) & 7;
      if (opc === 7) { // VMRS / VMSR
        if (L) { if (rt === 15) { const f = this.fpscr >>> 28; this.cN = f >> 3 & 1; this.cZ = f >> 2 & 1; this.cC = f >> 1 & 1; this.cV = f & 1; } else r[rt] = dn === 1 ? this.fpscr : dn === 0 ? 0x410120B4 : dn === 8 ? 0x40000000 : 0; }
        else if (dn === 1) this.fpscr = r[rt];
        return;
      }
      if (dbl) { const i = dn * 2 + (opc & 1); if (L) r[rt] = I[i]; else I[i] = r[rt]; } // VMOV r <-> metade de Dn
      else { if (L) r[rt] = I[sn]; else I[sn] = r[rt]; } // VMOV r <-> Sn
      return;
    }
    const opc = ((op >>> 20) & 0xB) | ((op >>> 4) & 4) /* bits 23,21,20 e 6 */;
    const p = (op >>> 23) & 1, q = (op >>> 21) & 1, rr = (op >>> 20) & 1, s = (op >>> 6) & 1, code = (p << 3) | (q << 2) | (rr << 1) | s; void opc;
    const get = (i) => (dbl ? D[i] : S[i]), set = (i, v) => { if (dbl) D[i] = v; else S[i] = v; };
    const d = dbl ? dd : sd, n = dbl ? dn : sn, m = dbl ? dm : sm;
    const R = dbl ? (v) => v : Math.fround;
    switch (code) {
      case 0: set(d, R(get(d) + get(n) * get(m))); return;
      case 1: set(d, R(get(d) - get(n) * get(m))); return;
      case 2: set(d, R(-get(d) + get(n) * get(m))); return;
      case 3: set(d, R(-get(d) - get(n) * get(m))); return;
      case 4: set(d, R(get(n) * get(m))); return;
      case 5: set(d, R(-(get(n) * get(m)))); return;
      case 6: set(d, R(get(n) + get(m))); return;
      case 7: set(d, R(get(n) - get(m))); return;
      case 8: set(d, R(get(n) / get(m))); return;
      case 15: {
        const ex = (dn << 1) | ((op >>> 7) & 1);
        switch (ex) {
          case 0: set(d, get(m)); return; // VMOV
          case 1: set(d, Math.abs(get(m))); return;
          case 2: set(d, -get(m)); return;
          case 3: set(d, R(Math.sqrt(get(m)))); return;
          case 8: case 9: this.fcmp(get(d), get(m)); return;
          case 10: case 11: this.fcmp(get(d), 0); return;
          case 15: if (dbl) S[sd] = Math.fround(D[dm]); else D[dd] = S[sm]; return; // VCVT entre precisões
          case 16: set(d, R(I[sm] >>> 0)); return; // VCVT de inteiro sem sinal
          case 17: set(d, R(I[sm])); return; // com sinal
          case 24: case 25: { const v = get(m), t = ex === 25 ? Math.trunc(v) : this.rint(v); I[sd] = v !== v ? 0 : t <= 0 ? 0 : t >= 4294967295 ? -1 : t >>> 0; return; }
          case 26: case 27: { const v = get(m), t = ex === 27 ? Math.trunc(v) : this.rint(v); I[sd] = v !== v ? 0 : t >= 2147483647 ? 2147483647 : t <= -2147483648 ? -2147483648 : t; return; }
          default: if (!this.unknown) { this.unknown = op; this.unknownPc = r[15] - 8; } return;
        }
      }
      default: if (!this.unknown) { this.unknown = op; this.unknownPc = r[15] - 8; }
    }
  }
  thumb(op) {
    const r = this.r;
    if ((op & 0xFF00) === 0xB200) { const v = r[(op >> 3) & 7], kk = (op >> 6) & 3; r[op & 7] = kk === 0 ? (v << 16) >> 16 : kk === 1 ? (v << 24) >> 24 : kk === 2 ? v & 0xFFFF : v & 0xFF; return; }
    if ((op & 0xFFC0) === 0xBA00) { const v = r[(op >> 3) & 7]; r[op & 7] = ((v & 0xFF) << 24) | ((v & 0xFF00) << 8) | ((v >>> 8) & 0xFF00) | (v >>> 24); return; }
    if ((op & 0xFFC0) === 0xBA40) { const v = r[(op >> 3) & 7]; r[op & 7] = ((v & 0x00FF00FF) << 8) | ((v >>> 8) & 0x00FF00FF); return; }
    if ((op & 0xFFC0) === 0xBAC0) { const v = r[(op >> 3) & 7]; r[op & 7] = ((((v & 0xFF) << 8) | ((v >>> 8) & 0xFF)) << 16) >> 16; return; }
    if ((op & 0xFFE8) === 0xB660) return; // CPS
    if ((op & 0xFF00) === 0xDF00) { this.swi(op & 0xFF); return; }
    super.thumb(op);
  }
}
if (typeof module !== 'undefined') module.exports = { N3DS, N3DSMem, Arm11 };
