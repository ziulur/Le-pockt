// ===== Núcleo Nintendo DS (etapa 1: dois processadores, duas telas 2D, toque) =====
const NArm = (typeof module !== 'undefined' && typeof require !== 'undefined') ? require('./armcpu.js').Arm : Arm;
const MV = (n) => { const a = new ArrayBuffer(n); return { b: new Uint8Array(a), h: new Uint16Array(a), w: new Uint32Array(a) }; };
const N_OBJ_W = [[8, 16, 32, 64], [16, 32, 32, 64], [8, 8, 16, 32], [8, 8, 8, 8]];
const N_OBJ_H = [[8, 16, 32, 64], [8, 8, 16, 32], [16, 32, 32, 64], [8, 8, 8, 8]];
const N_KEY = [4, 5, 6, 7, 0, 1, 2, 3, 8, 9];
const BG_KIND = [[0, 0, 0, 0], [0, 0, 0, 1], [0, 0, 1, 1], [0, 0, 0, 2], [0, 0, 1, 2], [0, 0, 2, 2], [-1, -1, -1, -1], [-1, -1, -1, -1]];
const BMP_SIZE = [[128, 128], [256, 256], [512, 256], [512, 512]];
const BANK_OFF = [0, 0x20000, 0x40000, 0x60000, 0x80000, 0x90000, 0x94000, 0x98000, 0xA0000];
const BANK_PAGES = [8, 8, 8, 8, 4, 1, 1, 2, 1];
const BANK_LCDC = [0, 8, 16, 24, 32, 36, 37, 38, 40];
function crc16(d, off, len, crc) {
  for (let i = 0; i < len; i++) { crc ^= d[off + i]; for (let k = 0; k < 8; k++) crc = (crc & 1) ? (crc >>> 1) ^ 0xA001 : crc >>> 1; }
  return crc & 0xFFFF;
}

class NDS {
  constructor(rom) {
    this.rom = rom; this.romLen = rom.length; this.dv = new DataView(rom.buffer, rom.byteOffset, rom.byteLength);
    let m = 1; while (m < rom.length) m <<= 1; this.romMask = m - 1;
    let t = ''; for (let i = 0; i < 12; i++) { const c = rom[i]; if (!c || c > 0x7E) break; t += String.fromCharCode(c); }
    this.title = t.trim() || 'SEM TITULO';
    this.ram = MV(0x400000); this.swram = MV(0x8000); this.wram7 = MV(0x10000); this.itcm = MV(0x8000); this.dtcm = MV(0x4000);
    this.pal = MV(0x800); this.oam = MV(0x800); this.vram = MV(0xA4000); this.bios9 = MV(0x1000); this.bios7 = MV(0x1000);
    this.bios9.w.set([0xE92D500F, 0xEE190F11, 0xE1A00620, 0xE1A00600, 0xE2800901, 0xE28FE000, 0xE510F004, 0xE8BD500F, 0xE25EF004], 0x200 >> 2);
    this.bios7.w.set([0xE92D500F, 0xE3A00301, 0xE28FE000, 0xE510F004, 0xE8BD500F, 0xE25EF004], 0x200 >> 2);
    this.io = [new Uint32Array(0x800), new Uint32Array(0x800)]; this.io16 = new Uint16Array(this.io[0].buffer);
    const bus = (c) => ({ m16: this.ram.h, m32: this.ram.w, a16: c ? this.wram7.h : this.itcm.h, a32: c ? this.wram7.w : this.itcm.w, aLo: c ? 0x03800000 : 0, aHi: c ? 0x04000000 : 0x02000000, aMask: c ? 0xFFFF : 0x7FFF, r8: (a) => this.r8(c, a), r16: (a) => this.r16(c, a), r32: (a) => this.r32(c, a), w8: (a, v) => this.w8(c, a, v), w16: (a, v) => this.w16(c, a, v), w32: (a, v) => this.w32(c, a, v),
      swi: (cpu, n) => this.swi(c, cpu, n), cp15r: (id) => this.cp15r(id), cp15w: (id, v) => this.cp15w(id, v) });
    this.cpu = [new NArm(bus(0), true, 0xFFFF0200 | 0, 2), new NArm(bus(1), false, 0x200, 1)];
    this.tBgA = new Int32Array(32); this.tBgB = new Int32Array(8); this.tObjA = new Int32Array(16); this.tObjB = new Int32Array(8); this.tLcdc = new Int32Array(64);
    this.tTex = new Int32Array(32); this.tTexPal = new Int32Array(8);
    this.bgExt = [new Int32Array(4), new Int32Array(4)]; this.objExt = [-1, -1]; this.vt7 = [-1, -1];
    this.affX = [new Int32Array(2), new Int32Array(2)]; this.affY = [new Int32Array(2), new Int32Array(2)];
    this.bgLine = [0, 1, 2, 3].map(() => new Uint16Array(256));
    this.objLine = new Uint16Array(256); this.objPri = new Uint8Array(256); this.objSemi = new Uint8Array(256); this.objWin = new Uint8Array(256); this.winMask = new Uint8Array(256);
    this.lineBuf = new Uint16Array(256); this.capOn = false;
    this.order = [0, 0, 0, 0]; this.bgPrio = [0, 0, 0, 0];
    this.fb = new Uint32Array(256 * 384); this.out = new Uint32Array(256 * 384);
    this.lut = new Uint32Array(0x8000);
    for (let c = 0; c < 0x8000; c++) { const r = c & 31, g = (c >> 5) & 31, b = (c >> 10) & 31; this.lut[c] = (0xFF000000 | (((b << 3) | (b >> 2)) << 16) | (((g << 3) | (g >> 2)) << 8) | ((r << 3) | (r >> 2))) >>> 0; }
    this.timers = [0, 1].map(() => [0, 1, 2, 3].map(() => ({ reload: 0, counter: 0, start: 0, ovf: Infinity, div: 1, on: false, cascade: false, irq: false })));
    this.dma = [0, 1].map(() => [0, 1, 2, 3].map(() => ({ src: 0, dst: 0, timing: 0 })));
    this.fifo = [0, 1].map(() => ({ buf: new Uint32Array(16), rd: 0, n: 0 }));
    this.saveData = new Uint8Array(0); this.svAddrLen = 0; this.saveDirty = false; this.saveUsed = false;
    this.irCart = rom[0x0C] === 0x49; if (this.irCart) this.svAlloc(3, 0x80000);
    this.skipDraw = false; this.dDma7 = 0; this.dLcdc = 0; this.dRemap = 0; this.gxIrqAt = 0; this.d3 = { cmd: 0, vtx: 0, beg: 0, cull: 0, clip: 0 }; this.dIrq = new Uint32Array(32);
    this.dPc = [[], []]; this.dPolys = 0; this.dSwaps = 0; this.dCard = 0; this.dSv = []; this.dSwi = [new Set(), new Set()]; this.dFrame = 0;
    this.buildFirmware();
    this.reset();
  }
  get sys() { return 'nds'; }
  get width() { return 256; } get height() { return 384; }
  setAudioRate() {}
  get hasSave() { return true; }
  getSave() { return this.saveUsed && this.saveData.length ? this.saveData.slice() : null; }
  loadSave(d) {
    this.svAddrLen = d.length <= 512 ? 1 : d.length <= 0x10000 ? 2 : 3;
    const size = this.svAddrLen === 1 ? 512 : this.svAddrLen === 2 ? 0x10000 : Math.max(0x80000, d.length);
    this.saveData = new Uint8Array(size).fill(0xFF); this.saveData.set(d.subarray(0, size)); this.saveUsed = true;
  }
  diag() {
    const h = (v, n = 8) => (v >>> 0).toString(16).toUpperCase().padStart(n, '0'), io = this.io, g = this.g;
    const cpu = (c) => { const p = this.cpu[c]; return `pc ${h(p.r[15])}${p.cT ? ' T' : ' A'} lr ${h(p.r[14])} sp ${h(p.r[13])}\n  modo ${h(p.mode, 2)} I${p.cI} ${p.halted ? 'PARADO' : 'rodando'}${p.intrWaiting ? ' esperando-irq' : ''}\n  IME ${this.ime[c]} IE ${h(this.ie[c])} IF ${h(this.if_[c])}\n  pcs ${this.dPc[c].map(x => h(x)).join(' ')}`; };
    return [`ARM9 ${cpu(0)}`, `ARM7 ${cpu(1)}`,
      `DISP A ${h(io[0][0])} B ${h(io[0][0x400])} POW ${h(io[0][0x304 >> 2], 4)} STAT ${h(this.dispstat[0], 4)}/${h(this.dispstat[1], 4)}`,
      `VRAM ${h(io[0][0x240 >> 2])} ${h(io[0][0x244 >> 2])} ${h(io[0][0x248 >> 2], 4)} CAP ${h(io[0][0x64 >> 2])}`,
      `3D polis ${this.dPolys} trocas ${this.dSwaps} dma3d ${this.dDma7}\n3Dq cmds ${this.d3s ? this.d3s.cmd : 0} begin ${this.d3s ? this.d3s.beg : 0} vtx ${this.d3s ? this.d3s.vtx : 0} costas ${this.d3s ? this.d3s.cull : 0} fora ${this.d3s ? this.d3s.clip : 0}\n3Dv fora ${this.d3s && this.d3s.out ? this.d3s.out : '-'} | dentro ${this.d3s && this.d3s.inn ? this.d3s.inn : '-'}\n3Df proj ${this.d3s && this.d3s.outP || '-'} | pos ${this.d3s && this.d3s.outM || '-'}\n3Dp ${this.d3s && this.d3s.poly || '-'}\n3Dl ${this.d3s && this.d3s.list || '-'}\nPIX ${this.pixDiag()}\n3Dt ${this.d3s && this.d3s.pal || '-'} | escritas LCDC ${this.dLcdc} | trocas VRAM ${this.dRemap}\nPROJ ${this.g ? Array.from(this.g.proj, (x) => x.toFixed(2)).join(' ') : ''}\nPOS ${this.g ? Array.from(this.g.pos, (x) => x.toFixed(2)).join(' ') : ''} sp ${this.g ? this.g.sp : 0}\nIRQ9 ${[...this.dIrq].map((v, i) => v ? i + ':' + v : '').filter(Boolean).join(' ')} ctl ${h(io[0][0x60 >> 2], 4)} irq ${g.irq}`,
      `IPC sync ${this.ipcOut[0]}/${this.ipcOut[1]} fifo ${this.fifo[0].n}/${this.fifo[1].n} cnt ${h(this.fcnt[0], 4)}/${h(this.fcnt[1], 4)} err ${this.ferr[0]}/${this.ferr[1]}`,
      `CARD ctl ${h(this.romctrl)} cmd ${h(io[this.cardC][0x1A8 >> 2])} leituras ${this.dCard}`,
      `SAVE end ${this.svAddrLen} tam ${this.saveData.length} usado ${this.saveUsed ? 1 : 0} ir ${this.irCart ? 1 : 0} cmds ${this.dSv.map(x => h(x, 2)).join(' ')}`,
      `SWI9 ${[...this.dSwi[0]].map(x => h(x, 2)).join(' ')} | SWI7 ${[...this.dSwi[1]].map(x => h(x, 2)).join(' ')}`,
      `R9 ${Array.from(this.cpu[0].r.slice(0, 8), x => h(x)).join(' ')}`,
      `R9b ${Array.from(this.cpu[0].r.slice(8, 13), x => h(x)).join(' ')}`,
      `COD ${((a0) => { const o = []; for (let a = a0; a < a0 + 32; a += 2) o.push(h(this.r16(0, a >>> 0), 4)); return h(a0) + ': ' + o.join(' '); })(((this.cpu[0].r[15] & ~1) - 0x14) >>> 0)}`,
      `DMA9 ${[0, 1, 2, 3].map(i => h(io[0][((0xB0 + i * 12) >> 2) + 2])).join(' ')}`,
      `DMA7 ${[0, 1, 2, 3].map(i => h(io[1][((0xB0 + i * 12) >> 2) + 2])).join(' ')}`,
      `SOM ${h(io[1][0x500 >> 2], 4)} TMR9 ${this.timers[0].map(t => t.on ? 1 : 0).join('')} TMR7 ${this.timers[1].map(t => t.on ? 1 : 0).join('')} quadro ${this.dFrame}`].join('\n');
  }
  // ----- Salvar estado: copia toda a memória e o estado interno (o jogo continua exatamente de onde parou) -----
  pixDiag() {
    const s = this.d3s, h = (v, k) => (v >>> 0).toString(16).toUpperCase().padStart(k, '0'), R = (o) => h(this.io16[o >> 1], 4);
    const regs = `BG0 ${R(8)} BG1 ${R(0xA)} BG2 ${R(0xC)} BG3 ${R(0xE)} BLD ${R(0x50)} ALF ${R(0x52)} Y ${R(0x54)} WIN ${R(0x48)}/${R(0x4A)} MB ${R(0x6C)}`;
    if (!s || !s.px) return '3D vazio · ' + regs;
    const top = (this.io[0][0x304 >> 2] & 0x8000) !== 0, o = this.out[(s.px.y + (top ? 0 : 192)) * 256 + s.px.x];
    return `3D em ${s.px.x},${s.px.y} cor ${h(s.px.c, 4)} alfa ${s.px.a} → tela ${h(o & 0xFFFFFF, 6)} · ${regs}`;
  }
  saveState() {
    const s = { v: 1, sys: 'nds', title: this.title, f: {}, cpu: [] };
    for (const k of Object.keys(this)) {
      if (NDS.NO_STATE.has(k)) continue;
      const v = this[k];
      if (typeof v === 'function') continue;
      if (v && v.b instanceof Uint8Array && v.h instanceof Uint16Array) s.f[k] = { mv: v.b.slice() };
      else if (k === 'g') { const g = Object.assign({}, v); g.texCache = null; s.f[k] = structuredClone(g); }
      else s.f[k] = structuredClone(v);
    }
    for (const c of this.cpu) { const o = {}; for (const k of NDS.CPU_STATE) o[k] = (c[k] && c[k].slice) ? c[k].slice() : c[k]; s.cpu.push(o); }
    return s;
  }
  loadState(s) {
    if (!s || s.sys !== 'nds' || !s.f) throw new Error('estado de outro console');
    for (const k of Object.keys(s.f)) {
      const v = s.f[k], cur = this[k];
      if (v && v.mv) { if (cur && cur.b && cur.b.length === v.mv.length) cur.b.set(v.mv); continue; }
      this[k] = structuredClone(v);
    }
    if (this.g) this.g.texCache = new Map();
    s.cpu.forEach((o, i) => { const c = this.cpu[i]; for (const k of NDS.CPU_STATE) { if (c[k] && c[k].set && o[k]) c[k].set(o[k]); else c[k] = o[k]; } });
    this.remap(); this.updNext(0); this.updNext(1);
    this.saveDirty = true; this.audioLen = 0;
  }
  press(k, down) {
    if (k >= 10) { const b = 1 << (k - 10); if (down) this.xy |= b; else this.xy &= ~b; return; }
    const b = 1 << N_KEY[k]; if (down) this.keys |= b; else this.keys &= ~b;
  }
  touch(x, y, down) { this.penDown = down; if (down) { this.touchX = Math.max(0, Math.min(255, x | 0)) << 4; this.touchY = Math.max(0, Math.min(191, y | 0)) << 4; } }

  buildFirmware() {
    const fw = this.fw = new Uint8Array(0x40000).fill(0xFF), us = this.userSettings = new Uint8Array(0x74);
    us[0] = 5; us[2] = 2; us[3] = 1; us[4] = 1; us[6] = 0x4C; us[8] = 0x45; us[0x1A] = 2;
    us.set([0x00, 0x02, 0x00, 0x02, 0x20, 0x20, 0x00, 0x0E, 0x00, 0x0A, 0xE0, 0xA0], 0x58);
    us[0x64] = 1;
    const c = crc16(us, 0, 0x70, 0xFFFF); us[0x72] = c & 0xFF; us[0x73] = c >> 8;
    fw.fill(0, 0, 0x200); fw[0x1D] = 0xFF; fw[0x20] = 0xC0; fw[0x21] = 0x7F; fw[0x2C] = 0x38; fw[0x2D] = 0x01;
    fw.set([0x00, 0x09, 0xBF, 0x12, 0x34, 0x56], 0x36);
    const wc = crc16(fw, 0x2C, 0x138, 0); fw[0x2A] = wc & 0xFF; fw[0x2B] = wc >> 8;
    fw.fill(0, 0x3FE00, 0x40000); fw.set(us, 0x3FE00); fw.set(us, 0x3FF00);
  }

  reset() {
    for (const k of ['ram', 'swram', 'wram7', 'itcm', 'dtcm', 'pal', 'oam', 'vram']) this[k].b.fill(0);
    this.io[0].fill(0); this.io[1].fill(0);
    this.ie = [0, 0]; this.if_ = [0, 0]; this.ime = [0, 0]; this.dispstat = [0, 0]; this.vcount = 0;
    this.keys = 0; this.xy = 0; this.penDown = false; this.touchX = 0; this.touchY = 0xFFF;
    this.ipcOut = [0, 0]; this.ipcIrqEn = [0, 0]; this.fcnt = [0, 0]; this.ferr = [0, 0]; this.flast = [0, 0];
    for (const f of this.fifo) { f.rd = 0; f.n = 0; }
    for (const ts of this.timers) for (const t of ts) { t.reload = 0; t.counter = 0; t.start = 0; t.ovf = Infinity; t.div = 1; t.on = false; t.cascade = false; t.irq = false; }
    this.nextTimer = [Infinity, Infinity];
    this.romctrl = 0; this.auxspicnt = 0; this.auxspidata = 0; this.cardKind = 0; this.cardAddr = 0; this.cardPos = 0; this.cardLen = 0; this.cardC = 0;
    this.sv = { pos: 0, cmd: 0, addr: 0, wren: false, tmp: [] }; this.irPos = 0; this.irCmd = 0;
    this.spicnt = 0; this.spidata = 0; this.fwPos = 0; this.fwCmd = 0; this.fwAddr = 0; this.tscPos = 0; this.tscConv = 0;
    this.rtcIO = 0; this.rtcIn = 0; this.rtcInBit = 0; this.rtcInPos = 0; this.rtcOut = new Uint8Array(8); this.rtcOutBit = 0; this.rtcOutPos = 0;
    this.cp15ctl = 0x00052078; this.dtcmReg = 0x0300000A; this.dtcmBase = 0x03000000; this.itcmReg = 0x20;
    this.sysT = 0; this.lineStart = 0; this.audioLen = 0;
    this.gxInit(); this.sndInit(); this.setWram(3); this.remap();
    // --- inicialização direta (sem BIOS/firmware originais) ---
    const dv = this.dv, rom = this.rom, ram = this.ram;
    const hdr = (o) => dv.getUint32(o, true);
    const load = (off, addr, size) => { for (let i = 0; i < size && off + i < this.romLen; i++) { const a = (addr + i) >>> 0; if ((a >>> 24) === 2) ram.b[a & 0x3FFFFF] = rom[off + i]; else if ((a >>> 24) === 3) this.wram7.b[a & 0xFFFF] = rom[off + i]; } };
    load(hdr(0x20), hdr(0x28), hdr(0x2C)); load(hdr(0x30), hdr(0x38), hdr(0x3C));
    ram.b.set(rom.subarray(0, 0x170), 0x3FFE00);
    const w32 = (a, v) => { ram.w[(a & 0x3FFFFF) >> 2] = v; }, w16 = (a, v) => { ram.h[(a & 0x3FFFFF) >> 1] = v; };
    w32(0x027FF800, 0x1FC2); w32(0x027FF804, 0x1FC2); w16(0x027FF808, dv.getUint16(0x15E, true)); w16(0x027FF80A, dv.getUint16(0x6C, true));
    w16(0x027FF850, 0x5835); w32(0x027FF880, 7); w32(0x027FF884, 6);
    w32(0x027FFC00, 0x1FC2); w32(0x027FFC04, 0x1FC2); w16(0x027FFC08, dv.getUint16(0x15E, true)); w16(0x027FFC0A, dv.getUint16(0x6C, true));
    w16(0x027FFC10, 0x5835); w16(0x027FFC30, 0xFFFF); w16(0x027FFC40, 1);
    ram.b.set(this.userSettings.subarray(0, 0x70), 0x3FFC80);
    const init = (cpu, entry, sp, irq, svc) => {
      cpu.r.fill(0); cpu.bank13.fill(0); cpu.bank14.fill(0); cpu.spsr.fill(0); cpu.fiqHi.fill(0); cpu.usrHi.fill(0);
      cpu.mode = 0x1F; cpu.cN = cpu.cZ = cpu.cC = cpu.cV = cpu.cI = cpu.cF = cpu.cT = 0;
      cpu.r[12] = cpu.r[14] = entry; cpu.r[13] = sp; cpu.bank13[2] = irq; cpu.bank13[3] = svc; cpu.r[15] = (entry + 4) | 0;
      cpu.cycles = 0; cpu.tgt = 0; cpu.halted = false; cpu.irqLine = false; cpu.ime = 0; cpu.intrWaiting = false;
    };
    init(this.cpu[0], hdr(0x24), 0x03002F7C, 0x03003F80, 0x03003FC0);
    init(this.cpu[1], hdr(0x34), 0x0380FD80, 0x0380FF80, 0x0380FFC0);
    this.io[0][0x304 >> 2] = 0x820F; this.io[1][0x504 >> 2] = 0x200;
  }

  // ================= Memória =================
  setWram(v) {
    this.wramcnt = v & 3;
    [this.w9off, this.w9mask, this.w7off, this.w7mask] = [[0, 0x7FFF, 0, -1], [0x4000, 0x3FFF, 0, 0x3FFF], [0, 0x3FFF, 0x4000, 0x3FFF], [0, -1, 0, 0x7FFF]][this.wramcnt];
  }
  remap() {
    const io = this.io[0], cnt = [0, 1, 2, 3, 4, 5, 6, 8, 9].map(i => (io[(0x240 + (i & ~3)) >> 2] >>> ((i & 3) << 3)) & 0xFF);
    if (this.g) this.g.texCache.clear();
    this.dRemap = (this.dRemap || 0) + 1;
    this.tTex.fill(-1); this.tTexPal.fill(-1); this.tBgA.fill(-1); this.tBgB.fill(-1); this.tObjA.fill(-1); this.tObjB.fill(-1); this.tLcdc.fill(-1);
    this.bgExt[0].fill(-1); this.bgExt[1].fill(-1); this.objExt[0] = -1; this.objExt[1] = -1; this.vt7[0] = -1; this.vt7[1] = -1;
    const set = (t, page, b) => { for (let i = 0; i < BANK_PAGES[b]; i++) if (page + i < t.length) t[page + i] = BANK_OFF[b] + i * 0x4000; };
    for (let b = 0; b < 9; b++) {
      const c = cnt[b]; if (!(c & 0x80)) continue;
      const mst = b < 2 ? c & 3 : c & 7, ofs = (c >> 3) & 3, off = BANK_OFF[b];
      if (mst === 0) { set(this.tLcdc, BANK_LCDC[b], b); continue; }
      if (b < 4) {
        if (mst === 1) set(this.tBgA, ofs * 8, b);
        else if (mst === 2) { if (b < 2) set(this.tObjA, (ofs & 1) * 8, b); else this.vt7[ofs & 1] = off; }
        else if (mst === 3) set(this.tTex, ofs * 8, b);
        else if (mst === 4) { if (b === 2) set(this.tBgB, 0, b); else if (b === 3) set(this.tObjB, 0, b); }
      } else if (b === 4) {
        if (mst === 1) set(this.tBgA, 0, b); else if (mst === 2) set(this.tObjA, 0, b); else if (mst === 3) set(this.tTexPal, 0, b);
        else if (mst === 4) for (let i = 0; i < 4; i++) this.bgExt[0][i] = off + i * 0x2000;
      } else if (b < 7) {
        const page = (ofs & 1) + (ofs >> 1) * 4;
        if (mst === 1) set(this.tBgA, page, b); else if (mst === 2) set(this.tObjA, page, b); else if (mst === 3) set(this.tTexPal, page, b);
        else if (mst === 4) { this.bgExt[0][(ofs & 1) * 2] = off; this.bgExt[0][(ofs & 1) * 2 + 1] = off + 0x2000; }
        else if (mst === 5) this.objExt[0] = off;
      } else if (b === 7) {
        if (mst === 1) set(this.tBgB, 0, b); else if (mst === 2) for (let i = 0; i < 4; i++) this.bgExt[1][i] = off + i * 0x2000;
      } else {
        if (mst === 1) set(this.tBgB, 2, b); else if (mst === 2) set(this.tObjB, 0, b); else if (mst === 3) this.objExt[1] = off;
      }
    }
    this.vramstat = ((cnt[2] & 0x87) === 0x82 ? 1 : 0) | ((cnt[3] & 0x87) === 0x82 ? 2 : 0);
  }
  map(c, a) {
    if (c === 0) {
      if (a < 0x02000000) { this.mm = this.itcm; this.mo = a & 0x7FFF; return true; }
      if (((a - this.dtcmBase) >>> 0) < 0x4000) { this.mm = this.dtcm; this.mo = (a - this.dtcmBase) & 0x3FFF; return true; }
      switch (a >>> 24) {
        case 2: this.mm = this.ram; this.mo = a & 0x3FFFFF; return true;
        case 3: if (this.w9mask < 0) return false; this.mm = this.swram; this.mo = this.w9off + (a & this.w9mask); return true;
        case 5: this.mm = this.pal; this.mo = a & 0x7FF; return true;
        case 6: {
          const s = (a >>> 21) & 7; let o;
          if (s === 0) o = this.tBgA[(a >>> 14) & 31]; else if (s === 1) o = this.tBgB[(a >>> 14) & 7]; else if (s === 2) o = this.tObjA[(a >>> 14) & 15];
          else if (s === 3) o = this.tObjB[(a >>> 14) & 7]; else o = this.tLcdc[(a >>> 14) & 63];
          if (o < 0) return false; this.mm = this.vram; this.mo = o + (a & 0x3FFF); return true;
        }
        case 7: this.mm = this.oam; this.mo = a & 0x7FF; return true;
        case 0xFF: if ((a & 0x00FFF000) === 0x00FF0000) { this.mm = this.bios9; this.mo = a & 0xFFF; return true; } return false;
      }
      return false;
    }
    switch (a >>> 24) {
      case 0: if (a < 0x1000) { this.mm = this.bios7; this.mo = a; return true; } return false;
      case 2: this.mm = this.ram; this.mo = a & 0x3FFFFF; return true;
      case 3: if (a < 0x03800000 && this.w7mask >= 0) { this.mm = this.swram; this.mo = this.w7off + (a & this.w7mask); } else { this.mm = this.wram7; this.mo = a & 0xFFFF; } return true;
      case 6: { const o = this.vt7[(a >>> 17) & 1]; if (o < 0) return false; this.mm = this.vram; this.mo = o + (a & 0x1FFFF); return true; }
    }
    return false;
  }
  // caminho rápido: RAM principal (e DTCM/ITCM no ARM9); o resto passa por map()
  fast(c, a) {
    if (c === 0) {
      const d = (a - this.dtcmBase) >>> 0;
      if (d < 0x4000) { this.mm = this.dtcm; this.mo = d; return true; }
    }
    if ((a >>> 24) === 2) { this.mm = this.ram; this.mo = a & 0x3FFFFF; return true; }
    return this.map(c, a);
  }
  r8(c, a) { if (this.fast(c, a)) return this.mm.b[this.mo]; if ((a >>> 24) === 4) return (this.ioR(c, (a & ~3) >>> 0) >>> ((a & 3) << 3)) & 0xFF; return 0; }
  r16(c, a) { if (this.fast(c, a)) return this.mm.h[this.mo >> 1]; if ((a >>> 24) === 4) return (this.ioR(c, (a & ~3) >>> 0) >>> ((a & 2) << 3)) & 0xFFFF; return 0; }
  r32(c, a) { if (this.fast(c, a)) return this.mm.w[this.mo >> 2] | 0; if ((a >>> 24) === 4) return this.ioR(c, a) | 0; return 0; }
  w8(c, a, v) { if (this.fast(c, a)) { this.mm.b[this.mo] = v; return; } if ((a >>> 24) === 4) { const s = (a & 3) << 3; this.ioW(c, (a & ~3) >>> 0, v << s, (0xFF << s) >>> 0); } }
  w16(c, a, v) { if ((a >>> 23) === 0x0D) this.dLcdc++; if (this.fast(c, a)) { this.mm.h[this.mo >> 1] = v; return; } if ((a >>> 24) === 4) { const s = (a & 2) << 3; this.ioW(c, (a & ~3) >>> 0, v << s, (0xFFFF << s) >>> 0); } }
  w32(c, a, v) { if ((a >>> 23) === 0x0D) this.dLcdc++; if (this.fast(c, a)) { this.mm.w[this.mo >> 2] = v; return; } if ((a >>> 24) === 4) this.ioW(c, a, v, 0xFFFFFFFF); }

  cp15r(id) { switch (id) { case 0x000: return 0x41059461; case 0x001: return 0x0F0D2112; case 0x100: return this.cp15ctl; case 0x910: return this.dtcmReg; case 0x911: return this.itcmReg; } return 0; }
  cp15w(id, v) {
    switch (id) {
      case 0x100: this.cp15ctl = v; return;
      case 0x910: this.dtcmReg = v; this.dtcmBase = (v & 0xFFFFF000) >>> 0; return;
      case 0x911: this.itcmReg = v; return;
      case 0x704: case 0x782: this.halt(0); return;
    }
  }
  halt(c) { const cpu = this.cpu[c]; if (!cpu.irqLine) { cpu.halted = true; cpu.tgt = 0; } }
  raise(c, bits) { if (c === 0) for (let i = 0; i < 25; i++) if (bits & (1 << i)) this.dIrq[i]++; this.if_[c] |= bits; this.updIrq(c); }
  updIrq(c) { const cpu = this.cpu[c]; cpu.irqLine = (this.ie[c] & this.if_[c]) !== 0; cpu.ime = this.ime[c]; if (cpu.irqLine) cpu.halted = false; }

  // ================= E/S =================
  ioR(c, a) {
    if (a >= 0x04100000) { if (a === 0x04100000) return this.fifoRecv(c); if (a === 0x04100010) return this.cardRead(); return 0; }
    if (a & 0x00FFE000) return 0;
    const o = a & 0x1FFC, io = this.io[c];
    if (c === 0 && o >= 0x600 && o < 0x6A4) return this.gxRead(o);
    switch (o) {
      case 0x004: return this.dispstat[c] | (this.vcount << 16);
      case 0x100: case 0x104: case 0x108: case 0x10C: return this.timerRead(c, (o - 0x100) >> 2) | (io[o >> 2] & 0xFFFF0000);
      case 0x130: return ((~this.keys) & 0x3FF) | (io[o >> 2] & 0xFFFF0000);
      case 0x134: if (c === 1) return 0x8000 | (((~this.xy & 3) | 0x3C | (this.penDown ? 0 : 0x40)) << 16); break;
      case 0x138: if (c === 1) return this.rtcIO; break;
      case 0x180: return this.ipcOut[1 - c] | (this.ipcOut[c] << 8) | (this.ipcIrqEn[c] << 14);
      case 0x184: { const s = this.fifo[c], r = this.fifo[1 - c]; return (s.n === 0 ? 1 : 0) | (s.n === 16 ? 2 : 0) | this.fcnt[c] | (r.n === 0 ? 0x100 : 0) | (r.n === 16 ? 0x200 : 0) | (this.ferr[c] ? 0x4000 : 0); }
      case 0x1A0: return this.auxspicnt | (this.auxspidata << 16);
      case 0x1A4: return this.romctrl;
      case 0x1C0: if (c === 1) return this.spicnt | (this.spidata << 16); break;
      case 0x208: return this.ime[c];
      case 0x210: return this.ie[c];
      case 0x214: return this.if_[c];
      case 0x240: if (c === 1) return this.vramstat | (this.wramcnt << 8); break;
      case 0x300: return 1;
    }
    return io[o >> 2];
  }
  ioW(c, a, v, m) {
    if (a >= 0x04100000 || (a & 0x00FFE000)) return;
    const o = a & 0x1FFC, io = this.io[c], k = o >> 2, old = io[k], nv = ((old & ~m) | (v & m)) >>> 0;
    if (c === 1 && o >= 0x400 && o < 0x520) { this.sndRun(this.cpu[1].cycles); io[k] = nv; this.sndWrite(o, old, nv); return; }
    io[k] = nv;
    if (c === 0 && o >= 0x400 && o <= 0x600) {
      if (o === 0x600) { this.g.irq = (nv >>> 30) & 3; if (this.g.irq) this.raise(0, 1 << 21); }
      else { io[k] = 0; if (m === 0xFFFFFFFF) this.gxPort(o, v | 0); }
      return;
    }
    if (c === 0) {
      const e = o & 0xFFF;
      if (e >= 0x28 && e < 0x40 && (e & 8)) { const en = o >> 12, i = (e >> 4) - 2; this.affX[en][i] = (io[(o & 0x1FF0 | 8) >> 2] << 4) >> 4; this.affY[en][i] = (io[(o & 0x1FF0 | 0xC) >> 2] << 4) >> 4; return; }
    }
    switch (o) {
      case 0x004: if (m & 0xFFFF) this.dispstat[c] = (this.dispstat[c] & 7) | (nv & 0xFFB8); return;
      case 0x0B8: case 0x0C4: case 0x0D0: case 0x0DC: if (m & 0xFF000000) this.dmaCtrl(c, ((o - 0xB8) / 12) | 0, old); return;
      case 0x100: case 0x104: case 0x108: case 0x10C: { const i = (o - 0x100) >> 2; if (m & 0xFFFF) this.timers[c][i].reload = nv & 0xFFFF; if (m & 0xFF0000) this.timerCtrl(c, i, (nv >>> 16) & 0xFF); return; }
      case 0x138: if (c === 1 && (m & 0xFF)) this.rtcWrite(nv & 0xFF); return;
      case 0x180: if (m & 0xFF00) { this.ipcOut[c] = (nv >> 8) & 0xF; this.ipcIrqEn[c] = (nv >> 14) & 1; if ((nv & 0x2000) && this.ipcIrqEn[1 - c]) this.raise(1 - c, 1 << 16); } return;
      case 0x184: if (m & 0xFFFF) {
        const w = nv & 0xFFFF, s = this.fifo[c], oldc = this.fcnt[c];
        if (w & 8) { s.rd = 0; s.n = 0; }
        if (w & 0x4000) this.ferr[c] = 0;
        this.fcnt[c] = w & 0x8404; io[k] = this.fcnt[c];
        if ((w & 4) && !(oldc & 4) && s.n === 0) this.raise(c, 1 << 17);
        if ((w & 0x400) && !(oldc & 0x400) && this.fifo[1 - c].n > 0) this.raise(c, 1 << 18);
      } return;
      case 0x188: if (this.fcnt[c] & 0x8000) {
        const s = this.fifo[c];
        if (s.n === 16) { this.ferr[c] = 1; return; }
        s.buf[(s.rd + s.n) & 15] = nv; s.n++;
        if (s.n === 1 && (this.fcnt[1 - c] & 0x400)) this.raise(1 - c, 1 << 18);
      } return;
      case 0x1A0: if (m & 0xFFFF) this.auxspicnt = nv & 0xE043; if (m & 0xFF0000) this.auxSpiWrite((nv >>> 16) & 0xFF); return;
      case 0x1A4: this.romctrl = (nv & 0x7F7FFFFF) | (this.romctrl & 0x80800000); if ((m & 0xFF000000) && (nv >>> 31)) this.cardStart(c, nv); return;
      case 0x1C0: if (c === 1) { if (m & 0xFFFF) this.spicnt = nv & 0xCF03; if (m & 0xFF0000) this.spiWrite((nv >>> 16) & 0xFF); } return;
      case 0x208: this.ime[c] = nv & 1; this.updIrq(c); return;
      case 0x210: this.ie[c] = nv; this.updIrq(c); return;
      case 0x214: this.if_[c] &= ~(v & m); io[k] = 0; if (c === 0 && (v & m & (1 << 21)) && this.g.irq) this.gxIrqAt = this.cpu[0].cycles + 400; this.updIrq(c); return;
      case 0x240: if (c === 0) this.remap(); return;
      case 0x244: if (c === 0) { if (m & 0xFF000000) this.setWram(nv >>> 24); this.remap(); } return;
      case 0x248: if (c === 0) this.remap(); return;
      case 0x280: case 0x290: case 0x294: case 0x298: case 0x29C: if (c === 0) this.hwDiv(); return;
      case 0x2B0: case 0x2B8: case 0x2BC: if (c === 0) this.hwSqrt(); return;
      case 0x300: if (c === 1 && (m & 0xFF00) && ((nv >> 14) & 3) === 2) this.halt(1); return;
    }
  }
  hwDiv() {
    const io = this.io[0], mode = io[0x280 >> 2] & 3; let q, r, zero = false;
    const s64 = (i) => (BigInt(io[i + 1] | 0) << 32n) | BigInt(io[i]);
    if (mode === 0) {
      const n = io[0x290 >> 2] | 0, d = io[0x298 >> 2] | 0;
      if (d === 0) { zero = true; q = BigInt(n < 0 ? 1 : -1); r = BigInt(n); } else { q = BigInt(Math.trunc(n / d)); r = BigInt(n % d); }
    } else {
      const n = s64(0x290 >> 2), d = mode === 1 ? BigInt(io[0x298 >> 2] | 0) : s64(0x298 >> 2);
      if (d === 0n) { zero = true; q = n < 0n ? 1n : -1n; r = n; } else { q = n / d; r = n % d; }
    }
    if (mode !== 0 && s64(0x298 >> 2) === 0n) zero = true;
    const put = (i, v) => { io[i] = Number(BigInt.asUintN(32, v)); io[i + 1] = Number(BigInt.asUintN(32, v >> 32n)); };
    put(0x2A0 >> 2, q); put(0x2A8 >> 2, r);
    io[0x280 >> 2] = (io[0x280 >> 2] & 3) | (zero ? 0x4000 : 0);
  }
  hwSqrt() {
    const io = this.io[0];
    if (!(io[0x2B0 >> 2] & 1)) { io[0x2B4 >> 2] = Math.floor(Math.sqrt(io[0x2B8 >> 2])); return; }
    const v = (BigInt(io[0x2BC >> 2]) << 32n) | BigInt(io[0x2B8 >> 2]); let r = BigInt(Math.floor(Math.sqrt(Number(v))));
    while (r * r > v) r--; while ((r + 1n) * (r + 1n) <= v) r++;
    io[0x2B4 >> 2] = Number(BigInt.asUintN(32, r));
  }
  fifoRecv(c) {
    const r = this.fifo[1 - c];
    if (!(this.fcnt[c] & 0x8000)) return r.n ? r.buf[r.rd] : this.flast[c];
    if (r.n === 0) { this.ferr[c] = 1; return this.flast[c]; }
    const v = r.buf[r.rd]; r.rd = (r.rd + 1) & 15; r.n--; this.flast[c] = v;
    if (r.n === 0 && (this.fcnt[1 - c] & 4)) this.raise(1 - c, 1 << 17);
    return v;
  }

  // ----- Cartucho -----
  cardStart(c, nv) {
    const io = this.io[c], w0 = io[0x1A8 >> 2], cmd = w0 & 0xFF, bs = (nv >>> 24) & 7;
    this.dCard++; this.cardC = c; this.cardLen = bs === 0 ? 0 : bs === 7 ? 4 : 0x100 << bs; this.cardPos = 0;
    if (cmd === 0xB7) { this.cardKind = 1; this.cardAddr = (((w0 >>> 8) & 0xFF) << 24 | ((w0 >>> 16) & 0xFF) << 16 | (w0 >>> 24) << 8 | (io[0x1AC >> 2] & 0xFF)) >>> 0; }
    else if (cmd === 0xB8 || cmd === 0x90) this.cardKind = 2;
    else this.cardKind = 0;
    if (this.cardLen === 0) { this.cardDone(); return; }
    this.romctrl |= 0x80800000;
    this.cardDma();
  }
  // DMA do cartucho: transfere enquanto houver dado pronto (alguns jogos pedem 1 palavra por vez, em modo contínuo)
  cardDma() {
    for (let c = 0; c < 2; c++) for (let i = 0; i < 4; i++) {
      const k = ((0xB0 + i * 12) >> 2) + 2; let guard = 0x10000;
      while ((this.romctrl & 0x00800000) && (this.io[c][k] >>> 31) && this.dma[c][i].timing === 5 && guard-- > 0) this.runDma(c, i);
    }
  }
  cardDone() { this.romctrl &= 0x7F7FFFFF; if (this.auxspicnt & 0x4000) this.raise(this.cardC, 1 << 19); }
  cardRead() {
    if (!(this.romctrl & 0x00800000)) return 0;
    let v = 0xFFFFFFFF;
    if (this.cardKind === 1) { let a = ((this.cardAddr + this.cardPos) & this.romMask) >>> 0; if (a < 0x8000) a = 0x8000 + (a & 0x1FF); if (a + 4 <= this.romLen) v = this.dv.getUint32(a, true); }
    else if (this.cardKind === 2) v = 0x1FC2;
    this.cardPos += 4;
    if (this.cardPos >= this.cardLen) this.cardDone();
    return v;
  }
  svAlloc(al, size) { this.svAddrLen = al; this.saveData = new Uint8Array(size || (al === 1 ? 512 : al === 2 ? 0x10000 : 0x100000)).fill(0xFF); }
  auxSpiWrite(v) {
    const last = !(this.auxspicnt & 0x40); let out;
    if (this.irCart) { // cartuchos com infravermelho: o 1º byte escolhe entre a memória de save (0) e o chip de IR
      if (this.irPos === 0) { this.irCmd = v; out = 0; }
      else if (this.irCmd === 0) out = this.svByte(v, last);
      else out = this.irCmd === 0x08 ? 0xAA : 0;
      if (last) { if (this.irCmd === 0 && this.irPos > 0 && this.sv.pos !== 0) this.sv.pos = 0; this.irPos = 0; } else this.irPos++;
    } else out = this.svByte(v, last);
    this.auxspidata = out;
  }
  svByte(v, last) {
    const s = this.sv; let out = 0xFF;
    if (s.pos === 0) { this.dSv.push(v); if (this.dSv.length > 8) this.dSv.shift(); s.cmd = v; s.addr = 0; s.tmp.length = 0; if (v === 6) s.wren = true; else if (v === 4) s.wren = false; }
    else {
      const al = this.svAddrLen, cmd = s.cmd, hi = al === 1, d = this.saveData;
      const isRead = cmd === 0x03 || cmd === 0x0B, isWrite = cmd === 0x02 || cmd === 0x0A, isErase = (cmd === 0xD8 || cmd === 0xDB) && al === 3;
      if (cmd === 0x05) out = s.wren ? 2 : 0;
      else if (isRead || isWrite || isErase) {
        if (al === 0) { if (isWrite) s.tmp.push(v); }
        else if (s.pos <= al) {
          s.addr = ((s.addr << 8) | v) >>> 0;
          if (s.pos === al) {
            if (hi && (cmd === 0x0A || cmd === 0x0B)) s.addr |= 0x100;
            if (isErase) { const n = cmd === 0xD8 ? 0x10000 : 0x100, b0 = (s.addr - (s.addr % n)) % d.length; d.fill(0xFF, b0, Math.min(d.length, b0 + n)); this.saveDirty = true; this.saveUsed = true; }
          }
        }
        else if (isRead) { if (!(cmd === 0x0B && !hi && s.pos === al + 1)) out = d[s.addr++ % d.length]; }
        else if (isWrite) { d[s.addr++ % d.length] = v; this.saveDirty = true; this.saveUsed = true; }
      }
    }
    if (!last) s.pos++;
    else {
      if (this.svAddrLen === 0 && s.tmp.length > 1 && (s.cmd === 0x02 || s.cmd === 0x0A)) {
        const n = s.tmp.length % 16, al = n >= 1 && n <= 3 ? n : 2; this.svAlloc(al);
        let addr = 0; for (let i = 0; i < al; i++) addr = (addr << 8) | s.tmp[i];
        if (al === 1 && s.cmd === 0x0A) addr |= 0x100;
        for (let i = al; i < s.tmp.length; i++) this.saveData[addr++ % this.saveData.length] = s.tmp[i];
        this.saveDirty = true; this.saveUsed = true;
      }
      s.pos = 0; s.tmp.length = 0;
    }
    return out;
  }

  // ----- SPI do ARM7: firmware, tela de toque -----
  spiWrite(v) {
    const dev = (this.spicnt >> 8) & 3, hold = this.spicnt & 0x800; let out = 0;
    if (dev === 1) {
      if (this.fwPos === 0) { this.fwCmd = v; this.fwAddr = 0; }
      else if (this.fwCmd === 3) { if (this.fwPos <= 3) this.fwAddr = (this.fwAddr << 8) | v; else out = this.fw[this.fwAddr++ & 0x3FFFF]; }
      this.fwPos = hold ? this.fwPos + 1 : 0;
    } else if (dev === 2) {
      if (this.tscPos === 1) out = (this.tscConv >> 5) & 0xFF; else if (this.tscPos === 2) out = (this.tscConv << 3) & 0xFF;
      if (v & 0x80) {
        this.tscPos = 1;
        const ch = v & 0x70;
        this.tscConv = ch === 0x10 ? (this.penDown ? this.touchY : 0xFFF) : ch === 0x50 ? (this.penDown ? this.touchX : 0) : ch === 0x60 ? 0x800 : 0xFFF;
        if (v & 8) this.tscConv &= 0xFF0;
      } else this.tscPos++;
    }
    this.spidata = out;
    if (this.spicnt & 0x4000) this.raise(1, 1 << 23);
  }
  rtcWrite(val) {
    const bcd = (n) => ((n / 10 | 0) << 4) | (n % 10);
    if (val & 4) {
      if (!(this.rtcIO & 4)) { this.rtcIn = 0; this.rtcInBit = 0; this.rtcInPos = 0; this.rtcOut.fill(0); this.rtcOutBit = 0; this.rtcOutPos = 0; }
      else if (!(val & 2)) {
        if (val & 0x10) {
          if (val & 1) this.rtcIn |= 1 << this.rtcInBit;
          if (++this.rtcInBit >= 8) {
            this.rtcInBit = 0;
            if (this.rtcInPos === 0) {
              let cmd = this.rtcIn;
              if ((cmd & 0xF0) === 0x60) { let r = 0; for (let i = 0; i < 8; i++) if (cmd & (1 << i)) r |= 0x80 >> i; cmd = r; }
              if (cmd & 0x80) {
                const d = new Date(), o = this.rtcOut, h = d.getHours();
                switch (cmd & 0x70) {
                  case 0x00: o[0] = 0x02; break;
                  case 0x20: o.set([bcd(d.getFullYear() % 100), bcd(d.getMonth() + 1), bcd(d.getDate()), d.getDay(), bcd(h) | (h >= 12 ? 0x40 : 0), bcd(d.getMinutes()), bcd(d.getSeconds())]); break;
                  case 0x60: o.set([bcd(h) | (h >= 12 ? 0x40 : 0), bcd(d.getMinutes()), bcd(d.getSeconds())]); break;
                }
              }
            }
            this.rtcIn = 0; this.rtcInPos++;
          }
        } else {
          const bit = (this.rtcOut[this.rtcOutPos] >> this.rtcOutBit) & 1;
          this.rtcIO = (this.rtcIO & ~1) | bit;
          if (++this.rtcOutBit >= 8) { this.rtcOutBit = 0; if (this.rtcOutPos < 7) this.rtcOutPos++; }
        }
      }
    }
    this.rtcIO = (val & 0x10) ? val : (this.rtcIO & 1) | (val & 0xFE);
  }

  // ----- Timers -----
  timerRead(c, i) { const t = this.timers[c][i]; if (!t.on || t.cascade) return t.counter & 0xFFFF; return (t.counter + Math.floor((this.cpu[c].cycles - t.start) / t.div)) & 0xFFFF; }
  timerCtrl(c, i, v) {
    const t = this.timers[c][i], was = t.on, cpu = this.cpu[c];
    if (was && !t.cascade) t.counter = this.timerRead(c, i);
    t.div = [1, 64, 256, 1024][v & 3] * (c === 0 ? 2 : 1); t.cascade = i > 0 && (v & 4) !== 0; t.irq = (v & 0x40) !== 0; t.on = (v & 0x80) !== 0;
    if (t.on && !was) t.counter = t.reload;
    t.start = cpu.cycles; t.ovf = (t.on && !t.cascade) ? t.start + (0x10000 - t.counter) * t.div : Infinity;
    this.updNext(c); if (this.nextTimer[c] < cpu.tgt) cpu.tgt = this.nextTimer[c];
  }
  updNext(c) { const t = this.timers[c]; this.nextTimer[c] = Math.min(t[0].ovf, t[1].ovf, t[2].ovf, t[3].ovf); }
  timerEvents(c) {
    const now = this.cpu[c].cycles;
    for (let i = 0; i < 4; i++) { const t = this.timers[c][i]; while (t.ovf <= now) { const when = t.ovf; t.counter = t.reload; t.start = when; t.ovf = when + (0x10000 - t.reload) * t.div; this.timerOvf(c, i); } }
    this.updNext(c);
  }
  timerOvf(c, i) {
    if (this.timers[c][i].irq) this.raise(c, 8 << i);
    if (i < 3) { const n = this.timers[c][i + 1]; if (n.on && n.cascade) { n.counter++; if (n.counter > 0xFFFF) { n.counter = n.reload; this.timerOvf(c, i + 1); } } }
  }

  // ----- DMA -----
  dmaCtrl(c, i, old) {
    const io = this.io[c], k = (0xB0 + i * 12) >> 2, ctrl = io[k + 2], d = this.dma[c][i];
    if ((ctrl >>> 31) && !(old >>> 31)) {
      d.src = io[k] & 0x0FFFFFFE; d.dst = io[k + 1] & 0x0FFFFFFE;
      d.timing = c === 0 ? (ctrl >>> 27) & 7 : [0, 1, 5, 6][(ctrl >>> 28) & 3];
      if (d.timing === 0 || (c === 0 && d.timing === 7)) this.runDma(c, i); else if (d.timing === 5) this.cardDma();
    }
  }
  dmaTrig(c, tm) {
    if (tm === 7) return; for (let i = 0; i < 4; i++) if ((this.io[c][((0xB0 + i * 12) >> 2) + 2] >>> 31) && this.dma[c][i].timing === tm) this.runDma(c, i); }
  runDma(c, i) {
    const io = this.io[c], k = (0xB0 + i * 12) >> 2, ctrl = io[k + 2], d = this.dma[c][i];
    if (c === 0 && d.timing === 7) this.dDma7++;
    let count = c === 0 ? ctrl & 0x1FFFFF : ctrl & (i === 3 ? 0xFFFF : 0x3FFF); if (!count) count = c === 0 ? 0x200000 : (i === 3 ? 0x10000 : 0x4000);
    const word = ctrl & 0x04000000, dm = (ctrl >>> 21) & 3, sz = word ? 4 : 2;
    const ds = [1, -1, 0, 1][dm] * sz, ss = [1, -1, 0, 1][(ctrl >>> 23) & 3] * sz;
    let src = d.src, dst = d.dst;
    if (word) for (let n = 0; n < count; n++) { this.w32(c, (dst & ~3) >>> 0, this.r32(c, (src & ~3) >>> 0)); src += ss; dst += ds; }
    else for (let n = 0; n < count; n++) { this.w16(c, dst >>> 0, this.r16(c, src >>> 0)); src += ss; dst += ds; }
    d.src = src >>> 0; d.dst = dm === 3 ? io[k + 1] & 0x0FFFFFFE : dst >>> 0;
    this.cpu[c].cycles += count * 2;
    if (ctrl & 0x40000000) this.raise(c, 0x100 << i);
    if (!(ctrl & 0x02000000) || d.timing === 0) io[k + 2] = ctrl & 0x7FFFFFFF;
  }

  // ================= Quadro =================
  runFrame() {
    this.dFrame++;
    if (this.dFrame % 60 === 0) { this.dIrq.fill(0); this.dLcdc = 0; this.dRemap = 0; }
    if ((this.dFrame & 7) === 0) for (let c = 0; c < 2; c++) { const a = this.dPc[c]; a.push(this.cpu[c].r[15]); if (a.length > 6) a.shift(); }
    for (let line = 0; line < 263; line++) {
      this.vcount = line;
      for (let c = 0; c < 2; c++) {
        const ds = this.dispstat[c], lyc = (ds >> 8) | ((ds & 0x80) << 1);
        if (line === lyc) { this.dispstat[c] |= 4; if (ds & 0x20) this.raise(c, 4); } else this.dispstat[c] &= ~4;
        if (line === 192) { this.dispstat[c] |= 1; if (ds & 8) this.raise(c, 1); this.dmaTrig(c, 1); }
        else if (line === 262) this.dispstat[c] &= ~1;
      }
      if (line === 192) { if (!this.skipDraw || this.capOn) { const t = this.out; this.out = this.fb; this.fb = t; } this.gxVblank(); if (this.capOn) { this.capOn = false; this.io[0][0x64 >> 2] &= 0x7FFFFFFF; } }
      else if (line === 0) this.capOn = (this.io[0][0x64 >> 2] >>> 31) !== 0;
      else if (line === 0) for (let e = 0; e < 2; e++) for (let i = 0; i < 2; i++) { const b = (e * 0x1000 + 0x28 + i * 0x10) >> 2; this.affX[e][i] = (this.io[0][b] << 4) >> 4; this.affY[e][i] = (this.io[0][b + 1] << 4) >> 4; }
      if (this.g.irq) this.raise(0, 1 << 21);
      const t0 = this.lineStart;
      this.runTo(t0 + 1606);
      if (line < 192 && (!this.skipDraw || this.capOn)) {
        const swap = this.io[0][0x304 >> 2] & 0x8000;
        this.drawEngine(0, line, (swap ? line : line + 192) * 256); this.drawEngine(1, line, (swap ? line + 192 : line) * 256);
        this.dmaTrig(0, 2);
      }
      for (let c = 0; c < 2; c++) { this.dispstat[c] |= 2; if (this.dispstat[c] & 0x10) this.raise(c, 2); }
      this.runTo(t0 + 2130);
      this.sndRun(t0 + 2130);
      this.dispstat[0] &= ~2; this.dispstat[1] &= ~2;
      this.lineStart = t0 + 2130;
    }
  }
  runTo(t) { let s = this.sysT; while (s < t) { s = Math.min(t, s + 96); this.runCpu(0, s * 2); this.runCpu(1, s); if (this.gxIrqAt && this.cpu[0].cycles >= this.gxIrqAt) { this.gxIrqAt = 0; if (this.g.irq) this.raise(0, 1 << 21); } } this.sysT = t; }
  runCpu(c, t) {
    const cpu = this.cpu[c];
    while (cpu.cycles < t) { const nt = this.nextTimer[c]; cpu.tgt = t < nt ? t : nt; cpu.run(); if (cpu.cycles >= this.nextTimer[c]) this.timerEvents(c); }
  }

  // ================= Vídeo =================
  vb(T, mk, a) { const o = T[(a >>> 14) & mk]; return o < 0 ? 0 : this.vram.b[o + (a & 0x3FFF)]; }
  vh(T, mk, a) { const o = T[(a >>> 14) & mk]; return o < 0 ? 0 : this.vram.h[(o + (a & 0x3FFE)) >> 1]; }
  affStep(e) {
    const io = this.io16, rb = e << 11;
    for (let i = 0; i < 2; i++) { this.affX[e][i] += (io[rb + ((0x22 + i * 16) >> 1)] << 16) >> 16; this.affY[e][i] += (io[rb + ((0x26 + i * 16) >> 1)] << 16) >> 16; }
  }
  drawEngine(e, y, base) {
    const io = this.io16, rb = e << 11, out = this.fb, lut = this.lut, dc = this.io[0][e << 10], dmode = (dc >>> 16) & 3;
    const lb = this.lineBuf, cap = e === 0 && this.capOn, mb0 = io[rb + (0x6C >> 1)];
    if (dmode !== 1 && !cap) { this.affStep(e); this.lineOut(e, y, base, dmode, dc, mb0); return; }
    if (dc & 0x80) { lb.fill(0x7FFF); this.affStep(e); if (cap) this.capture(y); this.lineOut(e, y, base, dmode, dc, mb0); return; }
    const kinds = BG_KIND[dc & 7]; let en = (dc >>> 8) & 0xF;
    for (let b = 0; b < 4; b++) {
      if (!(en & (1 << b))) continue;
      if (b === 0 && e === 0 && (dc & 8)) { this.gxLine(y, this.bgLine[0]); continue; }
      if (kinds[b] < 0) { en &= ~(1 << b); continue; }
      if (kinds[b] === 0) this.renderText(e, b, y, dc); else this.renderAff(e, b, y, dc, kinds[b]);
    }
    this.affStep(e);
    const objOn = (dc & 0x1000) !== 0;
    if (objOn) this.renderObj(e, y, dc);
    const winOn = (dc & 0xE000) !== 0, mask = this.winMask, R = (o) => io[rb + (o >> 1)];
    if (winOn) {
      mask.fill(R(0x4A) & 0x3F);
      if ((dc & 0x8000) && objOn) { const m = (R(0x4A) >> 8) & 0x3F, ow = this.objWin; for (let x = 0; x < 256; x++) if (ow[x]) mask[x] = m; }
      for (let w = 1; w >= 0; w--) {
        if (!(dc & (0x2000 << w))) continue;
        const v = R(0x44 + w * 2), y1 = v >> 8, y2 = v & 0xFF;
        if (!(y1 <= y2 ? (y >= y1 && y < y2) : (y >= y1 || y < y2))) continue;
        const h = R(0x40 + w * 2), x1 = h >> 8, x2 = h & 0xFF, m = (w ? R(0x48) >> 8 : R(0x48)) & 0x3F;
        if (x1 <= x2) mask.fill(m, x1, x2); else { mask.fill(m, 0, x2); mask.fill(m, x1, 256); }
      }
    }
    const order = this.order, bgPrio = this.bgPrio; let n = 0;
    for (let p = 0; p < 4; p++) for (let b = 0; b < 4; b++) if ((en & (1 << b)) && (R(8 + b * 2) & 3) === p) { order[n++] = b; bgPrio[b] = p; }
    const bld = R(0x50), bldMode = (bld >> 6) & 3, t1 = bld & 0x3F, t2 = (bld >> 8) & 0x3F, alpha = R(0x52);
    let eva = alpha & 0x1F, evb = (alpha >> 8) & 0x1F, evy = R(0x54) & 0x1F;
    if (eva > 16) eva = 16; if (evb > 16) evb = 16; if (evy > 16) evy = 16;
    const backdrop = this.pal.h[e << 9] & 0x7FFF, objLine = this.objLine, objPri = this.objPri, objSemi = this.objSemi, bgLine = this.bgLine;
    const needSecond = bldMode === 1 || (objOn && this.anySemi);
    for (let x = 0; x < 256; x++) {
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
        else c1 = this.fade(c1, bldMode === 2, evy);
      }
      lb[x] = c1;
    }
    if (cap) this.capture(y);
    this.lineOut(e, y, base, dmode, dc, mb0);
  }
  lineOut(e, y, base, dmode, dc, mb) {
    const out = this.fb, lut = this.lut, lb = this.lineBuf, mbMode = mb >> 14; let f = mb & 31; if (f > 16) f = 16;
    if (dmode === 0) { out.fill(0xFFFFFFFF, base, base + 256); return; }
    if (dmode === 3 || (dmode === 2 && e === 1)) { out.fill(0xFF000000, base, base + 256); return; }
    if (dmode === 2) { const vh = this.vram.h, o = (((dc >>> 18) & 3) * 0x20000 + y * 512) >> 1; for (let x = 0; x < 256; x++) lb[x] = vh[o + x] & 0x7FFF; }
    if (mbMode === 1 || mbMode === 2) for (let x = 0; x < 256; x++) out[base + x] = lut[this.fade(lb[x], mbMode === 1, f)];
    else for (let x = 0; x < 256; x++) out[base + x] = lut[lb[x]];
  }
  capture(y) {
    const io = this.io[0], cnt = io[0x64 >> 2], size = (cnt >>> 20) & 3, w = size === 0 ? 128 : 256, h = [128, 64, 128, 192][size];
    if (y >= h) return;
    const vh = this.vram.h, wbase = ((cnt >>> 16) & 3) * 0x20000, wofs = ((cnt >>> 18) & 3) * 0x8000, lb = this.lineBuf, g = this.g, row = y * 256;
    const src = (cnt >>> 29) & 3, a3d = cnt & 0x01000000, rbase = ((io[0] >>> 18) & 3) * 0x20000, rofs = ((cnt >>> 26) & 3) * 0x8000;
    let eva = cnt & 31, evb = (cnt >>> 8) & 31; if (eva > 16) eva = 16; if (evb > 16) evb = 16;
    for (let x = 0; x < w; x++) {
      let ca = 0, aa = 1;
      if (a3d) { aa = g.alpha[row + x] ? 1 : 0; ca = g.color[row + x]; } else ca = lb[x];
      let out;
      if (src === 0) out = aa ? ca | 0x8000 : 0;
      else {
        const cb = vh[(rbase + ((rofs + (y * 256 + x) * 2) & 0x1FFFF)) >> 1];
        if (src === 1) out = cb;
        else {
          const ka = aa ? eva : 0, kb = (cb & 0x8000) ? evb : 0;
          let r = ((ca & 31) * ka + (cb & 31) * kb + 8) >> 4, gg = (((ca >> 5) & 31) * ka + ((cb >> 5) & 31) * kb + 8) >> 4, bb = (((ca >> 10) & 31) * ka + ((cb >> 10) & 31) * kb + 8) >> 4;
          if (r > 31) r = 31; if (gg > 31) gg = 31; if (bb > 31) bb = 31;
          out = r | (gg << 5) | (bb << 10) | ((ka || kb) ? 0x8000 : 0);
        }
      }
      vh[(wbase + ((wofs + (y * w + x) * 2) & 0x1FFFF)) >> 1] = out;
    }
  }
  blend(c1, c2, eva, evb) {
    let r = ((c1 & 31) * eva + (c2 & 31) * evb) >> 4, g = (((c1 >> 5) & 31) * eva + ((c2 >> 5) & 31) * evb) >> 4, b = (((c1 >> 10) & 31) * eva + ((c2 >> 10) & 31) * evb) >> 4;
    if (r > 31) r = 31; if (g > 31) g = 31; if (b > 31) b = 31;
    return r | (g << 5) | (b << 10);
  }
  fade(c, up, f) {
    let r = c & 31, g = (c >> 5) & 31, b = (c >> 10) & 31;
    if (up) { r += ((31 - r) * f) >> 4; g += ((31 - g) * f) >> 4; b += ((31 - b) * f) >> 4; } else { r -= (r * f) >> 4; g -= (g * f) >> 4; b -= (b * f) >> 4; }
    return r | (g << 5) | (b << 10);
  }
  renderText(e, b, y, dc) {
    const io = this.io16, rb = e << 11, cnt = io[rb + 4 + b], T = e ? this.tBgB : this.tBgA, mk = e ? 7 : 31, vram = this.vram.b, vh = this.vram.h, pal = this.pal.h, pb = e << 9, out = this.bgLine[b];
    const charBase = ((cnt >> 2) & 15) * 0x4000 + (e ? 0 : ((dc >>> 24) & 7) * 0x10000), screenBase = ((cnt >> 8) & 31) * 0x800 + (e ? 0 : ((dc >>> 27) & 7) * 0x10000);
    const is8 = cnt & 0x80, size = cnt >> 14;
    const ext = (is8 && (dc & 0x40000000)) ? this.bgExt[e][(b < 2 && (cnt & 0x2000)) ? b + 2 : b] : -1;
    const hofs = io[rb + 8 + b * 2] & 0x1FF, vofs = io[rb + 9 + b * 2] & 0x1FF;
    const yy = (y + vofs) & ((size & 2) ? 511 : 255), wMask = (size & 1) ? 511 : 255;
    const rowBase = screenBase + ((yy & 256) ? (size === 3 ? 0x1000 : 0x800) : 0) + (((yy >> 3) & 31) << 6), fy = yy & 7;
    let row = -1, hflip = 0, pbank = 0;
    for (let x = 0; x < 256; x++) {
      const px = (x + hofs) & wMask;
      if (x === 0 || (px & 7) === 0) {
        const en = this.vh(T, mk, rowBase + ((px & 256) ? 0x800 : 0) + (((px >> 3) & 31) << 1));
        hflip = en & 0x400; pbank = en >> 12;
        const r = (en & 0x800) ? 7 - fy : fy, addr = is8 ? charBase + ((en & 0x3FF) << 6) + (r << 3) : charBase + ((en & 0x3FF) << 5) + (r << 2);
        const o = T[(addr >>> 14) & mk]; row = o < 0 ? -1 : o + (addr & 0x3FFF);
      }
      let c = 0x8000;
      if (row >= 0) {
        const col = hflip ? 7 - (px & 7) : px & 7;
        if (is8) { const ci = vram[row + col]; if (ci) c = (ext >= 0 ? vh[(ext >> 1) + (pbank << 8) + ci] : pal[pb + ci]) & 0x7FFF; }
        else { const v = vram[row + (col >> 1)], ci = (col & 1) ? v >> 4 : v & 15; if (ci) c = pal[pb + (pbank << 4) + ci] & 0x7FFF; }
      }
      out[x] = c;
    }
  }
  renderAff(e, b, y, dc, kind) {
    const io = this.io16, rb = e << 11, cnt = io[rb + 4 + b], T = e ? this.tBgB : this.tBgA, mk = e ? 7 : 31, vh = this.vram.h, pal = this.pal.h, pb = e << 9, out = this.bgLine[b], k = b - 2;
    const charBase = ((cnt >> 2) & 15) * 0x4000 + (e ? 0 : ((dc >>> 24) & 7) * 0x10000), screenBase = ((cnt >> 8) & 31) * 0x800 + (e ? 0 : ((dc >>> 27) & 7) * 0x10000);
    const wrap = cnt & 0x2000, bmp = kind === 2 && (cnt & 0x80), direct = cnt & 4;
    let w = 128 << (cnt >> 14), h = w; if (bmp) { w = BMP_SIZE[cnt >> 14][0]; h = BMP_SIZE[cnt >> 14][1]; }
    const tw = w >> 3, bbase = ((cnt >> 8) & 31) * 0x4000, ext = (kind === 2 && (dc & 0x40000000)) ? this.bgExt[e][b] : -1;
    let fx = this.affX[e][k], fy = this.affY[e][k];
    const pa = (io[rb + ((0x20 + k * 16) >> 1)] << 16) >> 16, pc = (io[rb + ((0x24 + k * 16) >> 1)] << 16) >> 16;
    for (let x = 0; x < 256; x++) {
      let px = fx >> 8, py = fy >> 8; fx += pa; fy += pc;
      if (wrap) { px &= w - 1; py &= h - 1; } else if (px < 0 || py < 0 || px >= w || py >= h) { out[x] = 0x8000; continue; }
      let c = 0x8000;
      if (bmp) {
        if (direct) { const v = this.vh(T, mk, bbase + (py * w + px) * 2); if (v & 0x8000) c = v & 0x7FFF; }
        else { const ci = this.vb(T, mk, bbase + py * w + px); if (ci) c = pal[pb + ci] & 0x7FFF; }
      } else if (kind === 1) {
        const tile = this.vb(T, mk, screenBase + (py >> 3) * tw + (px >> 3)), ci = this.vb(T, mk, charBase + (tile << 6) + ((py & 7) << 3) + (px & 7));
        if (ci) c = pal[pb + ci] & 0x7FFF;
      } else {
        const en = this.vh(T, mk, screenBase + ((py >> 3) * tw + (px >> 3)) * 2), tx = (en & 0x400) ? 7 - (px & 7) : px & 7, ty = (en & 0x800) ? 7 - (py & 7) : py & 7;
        const ci = this.vb(T, mk, charBase + ((en & 0x3FF) << 6) + (ty << 3) + tx);
        if (ci) c = (ext >= 0 ? vh[(ext >> 1) + ((en >> 12) << 8) + ci] : pal[pb + ci]) & 0x7FFF;
      }
      out[x] = c;
    }
  }
  renderObj(e, y, dc) {
    const oam = this.oam.h, ob = e << 9, T = e ? this.tObjB : this.tObjA, mk = e ? 7 : 15, pal = this.pal.h, pb = (e << 9) + 256, vh = this.vram.h;
    const objLine = this.objLine, objPri = this.objPri, objSemi = this.objSemi, objWin = this.objWin;
    objPri.fill(4); objSemi.fill(0); objWin.fill(0);
    const map1D = dc & 0x10, bshift = map1D ? 5 + ((dc >>> 20) & 3) : 5, ext = (dc & 0x80000000) ? this.objExt[e] : -1; let anySemi = false;
    for (let i = 0; i < 128; i++) {
      const a0 = oam[ob + i * 4], aff = a0 & 0x100;
      if (!aff && (a0 & 0x200)) continue;
      const gfx = (a0 >> 10) & 3;
      const a1 = oam[ob + i * 4 + 1], a2 = oam[ob + i * 4 + 2];
      const w = N_OBJ_W[a0 >> 14][a1 >> 14], h = N_OBJ_H[a0 >> 14][a1 >> 14], dbl = aff && (a0 & 0x200), bw = dbl ? w * 2 : w, bh = dbl ? h * 2 : h;
      let sy = a0 & 0xFF; if (sy + bh > 256) sy -= 256;
      if (y < sy || y >= sy + bh) continue;
      let sx = a1 & 0x1FF; if (sx >= 256) sx -= 512;
      if (sx + bw <= 0) continue;
      const tbase = (a2 & 0x3FF) << bshift, prio = (a2 >> 10) & 3, is8 = a0 & 0x2000, pbank = a2 >> 12, line = y - sy;
      let pa = 0x100, pbm = 0, pc = 0, pd = 0x100, hflip = 0, vflip = 0;
      if (aff) { const p = ob + ((a1 >> 9) & 0x1F) * 16; pa = (oam[p + 3] << 16) >> 16; pbm = (oam[p + 7] << 16) >> 16; pc = (oam[p + 11] << 16) >> 16; pd = (oam[p + 15] << 16) >> 16; }
      else { hflip = a1 & 0x1000; vflip = a1 & 0x2000; }
      const hw = bw >> 1, iy = line - (bh >> 1);
      for (let k = 0; k < bw; k++) {
        const x = sx + k; if (x < 0 || x >= 256) continue;
        let tx, ty;
        if (aff) { const ix = k - hw; tx = ((pa * ix + pbm * iy) >> 8) + (w >> 1); ty = ((pc * ix + pd * iy) >> 8) + (h >> 1); if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue; }
        else { tx = hflip ? w - 1 - k : k; ty = vflip ? h - 1 - line : line; }
        let ci, addr;
        if (gfx === 3) {
          const tn = a2 & 0x3FF; let ba;
          if (dc & 0x40) ba = (tn << (7 + ((dc >>> 22) & 1))) + (ty * w + tx) * 2;
          else { const mx = (dc & 0x20) ? 0x1F : 0x0F; ba = ((tn & mx) * 8 + tx + ((tn & ~mx) >> ((dc & 0x20) ? 5 : 4)) * 8 * ((dc & 0x20) ? 256 : 128) + ty * ((dc & 0x20) ? 256 : 128)) * 2; }
          const cv = this.vh(T, mk, ba);
          if ((cv & 0x8000) && prio < objPri[x]) { objLine[x] = cv & 0x7FFF; objPri[x] = prio; objSemi[x] = 0; }
          continue;
        }
        if (is8) { addr = tbase + (map1D ? ((ty >> 3) * (w >> 3) + (tx >> 3)) << 6 : ((ty >> 3) * 32 + ((tx >> 3) << 1)) << 5) + ((ty & 7) << 3) + (tx & 7); ci = this.vb(T, mk, addr); }
        else { addr = tbase + (map1D ? ((ty >> 3) * (w >> 3) + (tx >> 3)) << 5 : ((ty >> 3) * 32 + (tx >> 3)) << 5) + ((ty & 7) << 2) + ((tx & 7) >> 1); const v = this.vb(T, mk, addr); ci = (tx & 1) ? v >> 4 : v & 15; }
        if (!ci) continue;
        if (gfx === 2) { objWin[x] = 1; continue; }
        if (prio < objPri[x]) {
          objLine[x] = (is8 ? (ext >= 0 ? vh[(ext >> 1) + (pbank << 8) + ci] : pal[pb + ci]) : pal[pb + (pbank << 4) + ci]) & 0x7FFF;
          objPri[x] = prio; objSemi[x] = gfx === 1 ? 1 : 0; if (gfx === 1) anySemi = true;
        }
      }
    }
    this.anySemi = anySemi;
  }

  // ================= BIOS (emulação de alto nível) =================
  swi(c, cpu, n) {
    const r = cpu.r; cpu.cycles += 20; this.dSwi[c].add(n);
    switch (n) {
      case 0x03: cpu.cycles += Math.min((r[0] >>> 0) * 4, 2000000); return;
      case 0x05: r[0] = 1; r[1] = 1;
      // falls through
      case 0x04: {
        const fa = c === 0 ? (this.dtcmBase + 0x3FF8) >>> 0 : 0x0380FFF8, flags = r[1], cur = cpu.read32(fa);
        if (!cpu.intrWaiting) {
          cpu.intrWaiting = true; this.ime[c] = 1; this.updIrq(c);
          if (r[0] & 1) { cpu.write32(fa, cur & ~flags); this.waitAgain(c, cpu); return; }
        }
        if (cur & flags) { cpu.write32(fa, cur & ~flags); cpu.intrWaiting = false; return; }
        this.waitAgain(c, cpu); return;
      }
      case 0x06: case 0x07: this.halt(c); return;
      case 0x09: {
        const num = r[0], den = r[1];
        if (den === 0) { r[0] = num < 0 ? -1 : 1; r[1] = num; r[3] = 1; return; }
        const q = (num / den) | 0; r[0] = q; r[1] = (num - Math.imul(q, den)) | 0; r[3] = q < 0 ? -q : q; return;
      }
      case 0x0B: {
        let src = r[0], dst = r[1]; const cnt = r[2] & 0x1FFFFF, fill = r[2] & 0x01000000;
        if (r[2] & 0x04000000) { if (fill) { const v = cpu.read32(src); for (let i = 0; i < cnt; i++) cpu.write32(dst + i * 4, v); } else for (let i = 0; i < cnt; i++) cpu.write32(dst + i * 4, cpu.read32(src + i * 4)); }
        else { if (fill) { const v = cpu.read16(src); for (let i = 0; i < cnt; i++) cpu.write16(dst + i * 2, v); } else for (let i = 0; i < cnt; i++) cpu.write16(dst + i * 2, cpu.read16(src + i * 2)); }
        cpu.cycles += cnt * 4; return;
      }
      case 0x0C: {
        const src = r[0], dst = r[1], cnt = r[2] & 0x1FFFFF;
        if (r[2] & 0x01000000) { const v = cpu.read32(src); for (let i = 0; i < cnt; i++) cpu.write32(dst + i * 4, v); } else for (let i = 0; i < cnt; i++) cpu.write32(dst + i * 4, cpu.read32(src + i * 4));
        cpu.cycles += cnt * 2; return;
      }
      case 0x0D: r[0] = Math.floor(Math.sqrt(r[0] >>> 0)); return;
      case 0x0E: { let crc = r[0] & 0xFFFF; const a = r[1], len = r[2] >>> 0; for (let i = 0; i < len; i++) { crc ^= cpu.read8(a + i); for (let k = 0; k < 8; k++) crc = (crc & 1) ? (crc >>> 1) ^ 0xA001 : crc >>> 1; } r[0] = crc; return; }
      case 0x0F: r[0] = 0; return;
      case 0x1A: { const i = r[0] & 63; r[0] = Math.min(0x7FFF, Math.round(Math.sin(i * Math.PI / 128) * 0x8000)); return; }
      case 0x1B: { const i = Math.min(767, r[0] >>> 0); r[0] = Math.round((Math.pow(2, i / 768) - 1) * 0x10000) & 0xFFFF; return; }
      case 0x1C: { const i = Math.min(723, r[0] >>> 0), dB = i - 723, div = dB < -240 ? 16 : dB < -120 ? 4 : dB < -60 ? 2 : 1; r[0] = Math.min(127, Math.round(127 * Math.pow(10, dB / 200) * div)); return; }
      case 0x10: {
        let src = r[0], dst = r[1]; const info = r[2];
        const len = cpu.read16(info), sw = cpu.read8(info + 2), dw = cpu.read8(info + 3), ofsRaw = cpu.read32(info + 4), ofs = ofsRaw & 0x7FFFFFFF, zero = ofsRaw < 0;
        let outv = 0, outBits = 0;
        for (let i = 0; i < len; i++) {
          const byte = cpu.read8(src++);
          for (let k = 0; k < 8; k += sw) { let v = (byte >> k) & ((1 << sw) - 1); if (v || zero) v += ofs; outv |= v << outBits; outBits += dw; if (outBits >= 32) { cpu.write32(dst, outv); dst += 4; outv = 0; outBits = 0; } }
        }
        return;
      }
      case 0x11: case 0x12: {
        let src = r[0]; const hdr = cpu.read32(src); src += 4;
        const total = hdr >>> 8, o = new Uint8Array(total); let p = 0;
        while (p < total) {
          let flags = cpu.read8(src++);
          for (let i = 0; i < 8 && p < total; i++, flags <<= 1) {
            if (flags & 0x80) { const b1 = cpu.read8(src++), b2 = cpu.read8(src++); let len = (b1 >> 4) + 3; const disp = (((b1 & 0xF) << 8) | b2) + 1; while (len-- > 0 && p < total) { o[p] = p >= disp ? o[p - disp] : 0; p++; } }
            else o[p++] = cpu.read8(src++);
          }
        }
        this.biosOut(cpu, r[1], o, n === 0x12); return;
      }
      case 0x13: {
        let src = r[0]; const hdr = cpu.read32(src); let remaining = hdr >>> 8; const bits = (hdr & 0xF) || 8;
        const o = new Uint8Array((remaining + 3) & ~3); let p = 0;
        const treeBase = src + 5; src += 5 + ((cpu.read8(src + 4) << 1) + 1);
        let np = treeBase, node = cpu.read8(np), block = 0, seen = 0;
        while (remaining > 0) {
          let stream = cpu.read32(src); src += 4;
          for (let k = 32; k > 0 && remaining > 0; k--, stream <<= 1) {
            const next = (np & ~1) + ((node & 0x3F) << 1) + 2; let leaf;
            if (stream < 0) { if (node & 0x40) leaf = cpu.read8(next + 1); else { np = next + 1; node = cpu.read8(np); continue; } }
            else { if (node & 0x80) leaf = cpu.read8(next); else { np = next; node = cpu.read8(np); continue; } }
            block |= (leaf & ((1 << bits) - 1)) << seen; seen += bits; np = treeBase; node = cpu.read8(np);
            if (seen === 32) { o[p++] = block & 0xFF; o[p++] = (block >>> 8) & 0xFF; o[p++] = (block >>> 16) & 0xFF; o[p++] = block >>> 24; seen = 0; block = 0; remaining -= 4; }
          }
        }
        this.biosOut(cpu, r[1], o, true); return;
      }
      case 0x14: case 0x15: {
        let src = r[0]; const hdr = cpu.read32(src); src += 4;
        const total = hdr >>> 8, o = new Uint8Array(total); let p = 0;
        while (p < total) {
          const f = cpu.read8(src++);
          if (f & 0x80) { let len = (f & 0x7F) + 3; const b = cpu.read8(src++); while (len-- > 0 && p < total) o[p++] = b; }
          else { let len = (f & 0x7F) + 1; while (len-- > 0 && p < total) o[p++] = cpu.read8(src++); }
        }
        this.biosOut(cpu, r[1], o, n === 0x15); return;
      }
      case 0x16: case 0x18: {
        let src = r[0]; const hdr = cpu.read32(src); src += 4;
        const total = hdr >>> 8, o = new Uint8Array(total);
        if (n === 0x18) { let acc = 0; for (let p = 0; p + 1 < total; p += 2) { acc = (acc + cpu.read16(src + p)) & 0xFFFF; o[p] = acc & 0xFF; o[p + 1] = acc >> 8; } }
        else { let acc = 0; for (let p = 0; p < total; p++) { acc = (acc + cpu.read8(src + p)) & 0xFF; o[p] = acc; } }
        this.biosOut(cpu, r[1], o, n === 0x18); return;
      }
    }
  }
  waitAgain(c, cpu) { cpu.r[15] -= cpu.cT ? 2 : 4; this.halt(c); }
  biosOut(cpu, dst, o, wide) {
    if (wide) { for (let p = 0; p + 1 < o.length; p += 2) cpu.write16(dst + p, o[p] | (o[p + 1] << 8)); if (o.length & 1) cpu.write16(dst + o.length - 1, o[o.length - 1]); }
    else for (let p = 0; p < o.length; p++) cpu.write8(dst + p, o[p]);
    cpu.cycles += o.length * 4;
  }
}
NDS.NO_STATE = new Set(['rom', 'dv', 'cpu', 'fb', 'out', 'lut', 'bios9', 'bios7', 'fw', 'userSettings', 'bgLine', 'objLine', 'objPri', 'objSemi', 'objWin', 'winMask',
  'order', 'bgPrio', 'lineBuf', 'audioBuf', 'mm', 'mo', 'd3', 'd3s', 'dIrq', 'dPc', 'dSwi', 'dSv', 'skipDraw', 'romLen', 'romMask', 'title', 'irCart']);
NDS.CPU_STATE = ['r', 'bank13', 'bank14', 'spsr', 'fiqHi', 'usrHi', 'mode', 'cN', 'cZ', 'cC', 'cV', 'cI', 'cF', 'cT', 'cQ', 'sc', 'cycles', 'tgt', 'halted', 'irqLine', 'ime', 'intrWaiting', 'mlo', 'mhi'];
if (typeof module !== 'undefined') { require('./nds3d.js')(NDS); require('./ndssnd.js')(NDS); module.exports = { NDS }; }
