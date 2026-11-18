// ===== Nintendo DS: gráficos 3D (etapa 2, versão básica) =====
function nds3dInstall(N) {
  const GX_N = new Uint8Array(256);
  [[0x10, 1], [0x12, 1], [0x13, 1], [0x14, 1], [0x16, 16], [0x17, 12], [0x18, 16], [0x19, 12], [0x1A, 9], [0x1B, 3], [0x1C, 3], [0x20, 1], [0x21, 1], [0x22, 1], [0x23, 2], [0x24, 1], [0x25, 1], [0x26, 1], [0x27, 1], [0x28, 1],
    [0x29, 1], [0x2A, 1], [0x2B, 1], [0x30, 1], [0x31, 1], [0x32, 1], [0x33, 1], [0x34, 32], [0x40, 1], [0x50, 1], [0x60, 1], [0x70, 3], [0x71, 2], [0x72, 1]].forEach(([c, n]) => { GX_N[c] = n; });
  const ident = () => { const m = new Float64Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; };
  const setId = (m) => { m.fill(0); m[0] = m[5] = m[10] = m[15] = 1; };
  const TMP = new Float64Array(16), PM = new Float64Array(16);
  const mulLeft = (c, p) => { // c = p * c
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) TMP[i * 4 + j] = p[i * 4] * c[j] + p[i * 4 + 1] * c[4 + j] + p[i * 4 + 2] * c[8 + j] + p[i * 4 + 3] * c[12 + j];
    c.set(TMP);
  };
  const rgb = (c) => [c & 31, (c >> 5) & 31, (c >> 10) & 31];
  const s10 = (v, sh) => ((v >> sh) << 22) >> 22;
  const P = N.prototype;

  P.gxInit = function () {
    this.g = {
      proj: ident(), pos: ident(), vec: ident(), tex: ident(), clip: ident(), clipDirty: true,
      projStack: ident(), texStack: ident(), posStack: Array.from({ length: 32 }, ident), vecStack: Array.from({ length: 32 }, ident), sp: 0, mode: 0,
      params: new Int32Array(32), pack: 0, left: 0, n: 0, cmd: 0, dn: 0,
      col: [31, 31, 31], rs: 0, rt: 0, s: 0, t: 0, vx: 0, vy: 0, vz: 0,
      attrNext: 0, attr: 0, texParam: 0, texPal: 0, dif: [0, 0, 0], amb: [0, 0, 0], emi: [0, 0, 0], spe: [0, 0, 0], shinyTab: false, shiny: new Uint8Array(128),
      lightDir: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]], lightCol: [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]],
      prim: -1, verts: [], strip: 0, polys: [], nverts: 0, swap: false, vp: [0, 0, 255, 191], irq: 0,
      color: new Uint16Array(256 * 192), alpha: new Uint8Array(256 * 192), depth: new Float32Array(256 * 192), posRes: new Int32Array(4), texCache: new Map(),
    };
  };
  P.gxRead = function (o) {
    const g = this.g;
    if (o === 0x600) return (0x06000002 | ((g.sp & 31) << 8) | (g.irq << 30)) >>> 0;
    if (o === 0x604) return (g.polys.length & 0xFFFF) | ((g.nverts & 0xFFFF) << 16);
    if (o >= 0x620 && o < 0x630) return g.posRes[(o - 0x620) >> 2] >>> 0;
    if (o >= 0x640 && o < 0x680) { this.gxClip(); return Math.round(g.clip[(o - 0x640) >> 2] * 4096) >>> 0; }
    if (o >= 0x680 && o < 0x6A4) { const i = (o - 0x680) >> 2; return Math.round(g.vec[((i / 3) | 0) * 4 + (i % 3)] * 4096) >>> 0; }
    return 0;
  };
  P.gxClip = function () { const g = this.g; if (g.clipDirty) { g.clip.set(g.proj); mulLeft(g.clip, g.pos); g.clipDirty = false; } };
  P.gxPort = function (o, v) {
    const g = this.g;
    if (o === 0x400) {
      if (g.left === 0 && g.pack === 0) { g.pack = v >>> 0; this.gxNext(); }
      else { g.params[g.n++] = v; if (--g.left === 0) { this.gxExec(g.cmd); g.pack >>>= 8; this.gxNext(); } }
      return;
    }
    const c = (o & 0x1FF) >> 2, n = GX_N[c];
    if (n === 0) { this.gxExec(c); return; }
    g.params[g.dn++] = v;
    if (g.dn >= n) { g.dn = 0; this.gxExec(c); }
  };
  P.gxNext = function () {
    const g = this.g;
    while (g.pack) {
      const c = g.pack & 0xFF, n = GX_N[c];
      if (c === 0 || n === 0) { if (c) this.gxExec(c); g.pack >>>= 8; continue; }
      g.cmd = c; g.left = n; g.n = 0; return;
    }
  };
  P.gxMats = function () { const g = this.g; return g.mode === 0 ? [g.proj] : g.mode === 1 ? [g.pos] : g.mode === 2 ? [g.pos, g.vec] : [g.tex]; };
  P.gxExec = function (c) {
    const g = this.g, p = g.params; this.d3.cmd++;
    switch (c) {
      case 0x10: g.mode = p[0] & 3; return;
      case 0x11:
        if (g.mode === 0) g.projStack.set(g.proj); else if (g.mode === 3) g.texStack.set(g.tex);
        else { g.posStack[g.sp & 31].set(g.pos); g.vecStack[g.sp & 31].set(g.vec); g.sp = (g.sp + 1) & 63; }
        return;
      case 0x12:
        if (g.mode === 0) g.proj.set(g.projStack); else if (g.mode === 3) g.tex.set(g.texStack);
        else { g.sp = (g.sp - ((p[0] << 26) >> 26)) & 63; g.pos.set(g.posStack[g.sp & 31]); g.vec.set(g.vecStack[g.sp & 31]); }
        g.clipDirty = true; return;
      case 0x13:
        if (g.mode === 0) g.projStack.set(g.proj); else if (g.mode === 3) g.texStack.set(g.tex);
        else { g.posStack[p[0] & 31].set(g.pos); g.vecStack[p[0] & 31].set(g.vec); }
        return;
      case 0x14:
        if (g.mode === 0) g.proj.set(g.projStack); else if (g.mode === 3) g.tex.set(g.texStack);
        else { g.pos.set(g.posStack[p[0] & 31]); g.vec.set(g.vecStack[p[0] & 31]); }
        g.clipDirty = true; return;
      case 0x15: for (const m of this.gxMats()) setId(m); g.clipDirty = true; return;
      case 0x16: case 0x18: case 0x17: case 0x19: case 0x1A: {
        const w = c === 0x1A ? 3 : (c === 0x17 || c === 0x19) ? 3 : 4, rows = c === 0x1A ? 3 : 4;
        setId(PM);
        for (let i = 0; i < rows; i++) for (let j = 0; j < w; j++) PM[i * 4 + j] = p[i * w + j] / 4096;
        for (const m of this.gxMats()) { if (c === 0x16 || c === 0x17) m.set(PM); else mulLeft(m, PM); }
        g.clipDirty = true; return;
      }
      case 0x1B: {
        const sx = p[0] / 4096, sy = p[1] / 4096, sz = p[2] / 4096;
        for (const m of (g.mode === 2 ? [g.pos] : this.gxMats())) for (let j = 0; j < 4; j++) { m[j] *= sx; m[4 + j] *= sy; m[8 + j] *= sz; }
        g.clipDirty = true; return;
      }
      case 0x1C: {
        const x = p[0] / 4096, y = p[1] / 4096, z = p[2] / 4096;
        for (const m of this.gxMats()) for (let j = 0; j < 4; j++) m[12 + j] += x * m[j] + y * m[4 + j] + z * m[8 + j];
        g.clipDirty = true; return;
      }
      case 0x20: g.col = rgb(p[0]); return;
      case 0x21: {
        const nx = s10(p[0], 0) / 512, ny = s10(p[0], 10) / 512, nz = s10(p[0], 20) / 512, v = g.vec;
        const x = nx * v[0] + ny * v[4] + nz * v[8], y = nx * v[1] + ny * v[5] + nz * v[9], z = nx * v[2] + ny * v[6] + nz * v[10];
        if (((g.texParam >>> 30) & 3) === 2) { const t = g.tex; g.s = g.rs + (nx * t[0] + ny * t[4] + nz * t[8]) / 16; g.t = g.rt + (nx * t[1] + ny * t[5] + nz * t[9]) / 16; }
        const col = [g.emi[0], g.emi[1], g.emi[2]];
        for (let i = 0; i < 4; i++) {
          if (!(g.attr & (1 << i))) continue;
          const L = g.lightDir[i], lc = g.lightCol[i]; let d = -(L[0] * x + L[1] * y + L[2] * z); if (d < 0) d = 0; if (d > 1) d = 1;
          // brilho: vetor do meio entre a luz e a visão (0,0,-1)
          let hx = L[0], hy = L[1], hz = L[2] - 1; const hl = Math.hypot(hx, hy, hz) || 1; hx /= hl; hy /= hl; hz /= hl;
          let s = -(hx * x + hy * y + hz * z); if (s < 0) s = 0; if (s > 1) s = 1; s *= s;
          if (g.shinyTab) { const t = g.shiny[Math.min(127, (s * 127) | 0)]; s = t / 255; }
          for (let k = 0; k < 3; k++) col[k] += (g.dif[k] * lc[k] * d + g.amb[k] * lc[k] + g.spe[k] * lc[k] * s) / 31;
        }
        g.col = col.map(v2 => v2 > 31 ? 31 : v2); return;
      }
      case 0x22: {
        g.rs = ((p[0] << 16) >> 16) / 16; g.rt = (p[0] >> 16) / 16;
        if (((g.texParam >>> 30) & 3) === 1) { const t = g.tex; g.s = g.rs * t[0] + g.rt * t[4] + (t[8] + t[12]) / 16; g.t = g.rs * t[1] + g.rt * t[5] + (t[9] + t[13]) / 16; }
        else { g.s = g.rs; g.t = g.rt; }
        return;
      }
      case 0x23: this.gxVertex(((p[0] << 16) >> 16) / 4096, (p[0] >> 16) / 4096, ((p[1] << 16) >> 16) / 4096); return;
      case 0x24: this.gxVertex(s10(p[0], 0) / 64, s10(p[0], 10) / 64, s10(p[0], 20) / 64); return;
      case 0x25: this.gxVertex(((p[0] << 16) >> 16) / 4096, (p[0] >> 16) / 4096, g.vz); return;
      case 0x26: this.gxVertex(((p[0] << 16) >> 16) / 4096, g.vy, (p[0] >> 16) / 4096); return;
      case 0x27: this.gxVertex(g.vx, ((p[0] << 16) >> 16) / 4096, (p[0] >> 16) / 4096); return;
      case 0x28: this.gxVertex(g.vx + s10(p[0], 0) / 4096, g.vy + s10(p[0], 10) / 4096, g.vz + s10(p[0], 20) / 4096); return;
      case 0x29: g.attrNext = p[0]; return;
      case 0x2A: g.texParam = p[0]; return;
      case 0x2B: g.texPal = p[0] & 0x1FFF; return;
      case 0x30: g.dif = rgb(p[0]); g.amb = rgb(p[0] >>> 16); if (p[0] & 0x8000) g.col = g.dif.slice(); return;
      case 0x31: g.spe = rgb(p[0]); g.shinyTab = (p[0] & 0x8000) !== 0; g.emi = rgb(p[0] >>> 16); if (p[0] & 0x8000) { } return;
      case 0x34: for (let i = 0; i < 32; i++) { const w = p[i]; g.shiny[i * 4] = w & 0xFF; g.shiny[i * 4 + 1] = (w >>> 8) & 0xFF; g.shiny[i * 4 + 2] = (w >>> 16) & 0xFF; g.shiny[i * 4 + 3] = w >>> 24; } return;
      case 0x32: {
        const nx = s10(p[0], 0) / 512, ny = s10(p[0], 10) / 512, nz = s10(p[0], 20) / 512, v = g.vec;
        g.lightDir[p[0] >>> 30] = [nx * v[0] + ny * v[4] + nz * v[8], nx * v[1] + ny * v[5] + nz * v[9], nx * v[2] + ny * v[6] + nz * v[10]]; return;
      }
      case 0x33: g.lightCol[p[0] >>> 30] = rgb(p[0]); return;
      case 0x40: this.d3.beg++; g.prim = p[0] & 3; g.verts.length = 0; g.strip = 0; g.attr = g.attrNext; return;
      case 0x41: return;
      case 0x50: g.swap = true; return;
      case 0x60: g.vp = [p[0] & 0xFF, (p[0] >> 8) & 0xFF, (p[0] >> 16) & 0xFF, p[0] >>> 24]; return;
      case 0x71: {
        this.gxClip(); const x = ((p[0] << 16) >> 16) / 4096, y = (p[0] >> 16) / 4096, z = ((p[1] << 16) >> 16) / 4096, m = g.clip;
        g.vx = x; g.vy = y; g.vz = z;
        for (let j = 0; j < 4; j++) g.posRes[j] = Math.round((x * m[j] + y * m[4 + j] + z * m[8 + j] + m[12 + j]) * 4096);
        return;
      }
    }
  };
  P.gxVertex = function (x, y, z) {
    const g = this.g; g.vx = x; g.vy = y; g.vz = z;
    if (g.prim < 0) return;
    this.gxClip(); const m = g.clip;
    let s = g.s, t = g.t;
    if (((g.texParam >>> 30) & 3) === 3) { const tm = g.tex; s = g.rs + (x * tm[0] + y * tm[4] + z * tm[8]) / 16; t = g.rt + (x * tm[1] + y * tm[5] + z * tm[9]) / 16; }
    const v = { x: x * m[0] + y * m[4] + z * m[8] + m[12], y: x * m[1] + y * m[5] + z * m[9] + m[13], z: x * m[2] + y * m[6] + z * m[10] + m[14], w: x * m[3] + y * m[7] + z * m[11] + m[15], r: g.col[0], g: g.col[1], b: g.col[2], s, t };
    const vs = g.verts; vs.push(v); g.nverts++; this.d3.vtx++;
    switch (g.prim) {
      case 0: if (vs.length === 3) { this.gxPoly([vs[0], vs[1], vs[2]]); vs.length = 0; } break;
      case 1: if (vs.length === 4) { this.gxPoly([vs[0], vs[1], vs[2], vs[3]]); vs.length = 0; } break;
      case 2: if (vs.length === 3) { this.gxPoly(g.strip & 1 ? [vs[1], vs[0], vs[2]] : [vs[0], vs[1], vs[2]]); g.strip++; vs.shift(); } break;
      case 3: if (vs.length === 4) { this.gxPoly([vs[0], vs[1], vs[3], vs[2]]); vs.splice(0, 2); } break;
    }
  };
  const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, w: a.w + (b.w - a.w) * t, r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t, s: a.s + (b.s - a.s) * t, t: a.t + (b.t - a.t) * t });
  const DIST = [(v) => v.w + v.x, (v) => v.w - v.x, (v) => v.w + v.y, (v) => v.w - v.y, (v) => v.w + v.z, (v) => v.w - v.z];
  P.gxPoly = function (list) {
    const g = this.g, first = list[0], fmt = (v) => [v.x, v.y, v.z, v.w].map((x) => x.toFixed(2)).join(' ');
    if (g.polys.length >= 6144 || ((g.attr >> 4) & 3) === 3) return;
    for (let pl = 0; pl < 6 && list.length >= 3; pl++) {
      const d = DIST[pl]; let inside = true;
      for (const v of list) if (d(v) < 0) { inside = false; break; }
      if (inside) continue;
      const out = [];
      for (let i = 0; i < list.length; i++) {
        const a = list[i], b = list[(i + 1) % list.length], da = d(a), db = d(b);
        if (da >= 0) out.push(a);
        if ((da >= 0) !== (db >= 0)) out.push(lerp(a, b, da / (da - db)));
      }
      list = out;
    }
    const mx = (m) => [m[0], m[5], m[10], m[11], m[12], m[13], m[14], m[15]].map((x) => x.toFixed(2)).join(' ');
    if (list.length < 3) { this.d3.clip++; if (!this.d3.out) { this.d3.out = fmt(first); this.d3.outP = Array.from(g.proj, (x) => x.toFixed(3)).join(' '); this.d3.outM = mx(g.pos) + ' sp ' + g.sp + ' modo ' + g.mode; } return; }
    if (!this.d3.inn) { this.d3.inn = fmt(first); const h = (v, n) => (v >>> 0).toString(16).toUpperCase().padStart(n, '0'); const TP = this.tTexPal, vh = this.vram.h, pb = g.texPal << ((((g.texParam >>> 26) & 7) === 2) ? 3 : 4);
      const pc = []; for (let i = 0; i < 8; i++) { const a = pb + i * 2, o = TP[(a >>> 14) & 7]; pc.push(o < 0 ? '----' : h(vh[(o + (a & 0x3FFE)) >> 1], 4)); }
      let nz = 0; for (let i = 0x80000 >> 1; i < 0x90000 >> 1; i++) if (vh[i]) nz++;
      this.d3.pal = `end ${h(pb, 5)} cores ${pc.join(' ')} | E com dados ${nz} | slots ${Array.from(TP, (x) => x < 0 ? '-' : (x >> 14).toString(16)).join('')}`;
      this.d3.poly = `attr ${h(g.attr, 8)} tex ${h(g.texParam, 8)} pal ${h(g.texPal, 4)} cor ${[first.r, first.g, first.b].map((x) => Math.round(x)).join(',')} dif ${g.dif.join(',')} amb ${g.amb.join(',')} emi ${g.emi.join(',')}`; }
    const vp = g.vp, vw = (vp[2] - vp[0] + 1) * 0.5, vh = (vp[3] - vp[1] + 1) * 0.5, oy = 191 - vp[3];
    const vs = list.map(v => { const iw = 1 / (v.w || 1e-9); return { x: (v.x * iw + 1) * vw + vp[0], y: (1 - v.y * iw) * vh + oy, z: v.z * iw, iw, r: v.r * iw, g: v.g * iw, b: v.b * iw, s: v.s * iw, t: v.t * iw }; });
    let area = 0;
    for (let i = 0; i < vs.length; i++) { const a = vs[i], b = vs[(i + 1) % vs.length]; area += a.x * b.y - b.x * a.y; }
    if (area === 0) return;
    if (area < 0 ? !(g.attr & 0x80) : !(g.attr & 0x40)) { this.d3.cull++; return; }
    g.polys.push({ v: vs, attr: g.attr, tp: g.texParam, pal: g.texPal });
  };
  P.gxVblank = function () {
    const g = this.g;
    if (g.irq) this.raise(0, 1 << 21);
    if (!g.swap) return;
    g.swap = false;
    const polys = g.polys; g.polys = []; g.nverts = 0;
    this.dPolys = polys.length; this.dSwaps++; this.d3s = this.d3; this.d3 = { cmd: 0, vtx: 0, beg: 0, cull: 0, clip: 0 };
    if (!this.skipDraw || this.capOn) this.gxRender(polys);
  };
  P.gxTexture = function (tp, palBase) {
    const g = this.g, key = tp * 8192 + palBase; let tx = g.texCache.get(key);
    if (tx) return tx;
    const fmt = (tp >>> 26) & 7, w = 8 << ((tp >>> 20) & 7), h = 8 << ((tp >>> 23) & 7), addr = (tp & 0xFFFF) << 3;
    const pix = new Uint16Array(w * h), al = new Uint8Array(w * h), T = this.tTex, TP = this.tTexPal, vram = this.vram.b, vh = this.vram.h;
    const t8 = (a) => { const o = T[(a >>> 14) & 31]; return o < 0 ? 0 : vram[o + (a & 0x3FFF)]; };
    const pl = (a) => { const o = TP[(a >>> 14) & 7]; return o < 0 ? 0 : vh[(o + (a & 0x3FFE)) >> 1] & 0x7FFF; };
    const c0t = (tp >>> 29) & 1, n = w * h;
    if (fmt === 1 || fmt === 6) {
      const pb = palBase << 4;
      for (let i = 0; i < n; i++) { const b = t8(addr + i); if (fmt === 1) { pix[i] = pl(pb + (b & 31) * 2); const a3 = b >> 5; al[i] = (a3 << 2) | (a3 >> 1); } else { pix[i] = pl(pb + (b & 7) * 2); al[i] = b >> 3; } }
    } else if (fmt === 2) {
      const pb = palBase << 3;
      for (let i = 0; i < n; i++) { const ci = (t8(addr + (i >> 2)) >> ((i & 3) << 1)) & 3; pix[i] = pl(pb + ci * 2); al[i] = (ci === 0 && c0t) ? 0 : 31; }
    } else if (fmt === 3) {
      const pb = palBase << 4;
      for (let i = 0; i < n; i++) { const ci = (t8(addr + (i >> 1)) >> ((i & 1) << 2)) & 15; pix[i] = pl(pb + ci * 2); al[i] = (ci === 0 && c0t) ? 0 : 31; }
    } else if (fmt === 4) {
      const pb = palBase << 4;
      for (let i = 0; i < n; i++) { const ci = t8(addr + i); pix[i] = pl(pb + ci * 2); al[i] = (ci === 0 && c0t) ? 0 : 31; }
    } else if (fmt === 5) {
      const pb = palBase << 4, ex = 0x20000 + ((addr & 0x1FFFF) >> 1) + (addr >= 0x40000 ? 0x10000 : 0);
      const mix = (a, b, ka, kb, sh) => (((a & 31) * ka + (b & 31) * kb) >> sh) | (((((a >> 5) & 31) * ka + ((b >> 5) & 31) * kb) >> sh) << 5) | (((((a >> 10) & 31) * ka + ((b >> 10) & 31) * kb) >> sh) << 10);
      for (let by = 0; by < h; by += 4) for (let bx = 0; bx < w; bx += 4) {
        const bi = (by >> 2) * (w >> 2) + (bx >> 2), da = addr + bi * 4, e = t8(ex + bi * 2) | (t8(ex + bi * 2 + 1) << 8), po = pb + ((e & 0x3FFF) << 2), mode = e >> 14;
        const c = [pl(po), pl(po + 2), 0, 0], a = [31, 31, 31, 31];
        if (mode === 0) { c[2] = pl(po + 4); a[3] = 0; } else if (mode === 1) { c[2] = mix(c[0], c[1], 1, 1, 1); a[3] = 0; }
        else if (mode === 2) { c[2] = pl(po + 4); c[3] = pl(po + 6); } else { c[2] = mix(c[0], c[1], 5, 3, 3); c[3] = mix(c[0], c[1], 3, 5, 3); }
        for (let y = 0; y < 4; y++) { const row = t8(da + y); for (let x = 0; x < 4; x++) { const ci = (row >> (x << 1)) & 3, i = (by + y) * w + bx + x; pix[i] = c[ci]; al[i] = a[ci]; } }
      }
    } else if (fmt === 7) {
      for (let i = 0; i < n; i++) { const v = t8(addr + i * 2) | (t8(addr + i * 2 + 1) << 8); pix[i] = v & 0x7FFF; al[i] = v & 0x8000 ? 31 : 0; }
    }
    tx = { w, h, pix, al }; g.texCache.set(key, tx); return tx;
  };
  P.gxRender = function (polys) {
    const g = this.g, io = this.io[0], color = g.color, alpha = g.alpha, depth = g.depth;
    const cc = io[0x350 >> 2], d3 = io[0x60 >> 2], texOn = d3 & 1, blendOn = d3 & 8, toonT = new Uint16Array(io.buffer, 0x380, 32);
    color.fill(cc & 0x7FFF); alpha.fill((cc >> 16) & 31); depth.fill(2);
    const order = polys.filter(p => ((p.attr >> 16) & 31) === 31 || ((p.attr >> 16) & 31) === 0).concat(polys.filter(p => { const a = (p.attr >> 16) & 31; return a > 0 && a < 31; }));
    for (const p of order) {
      const fmt = (p.tp >>> 26) & 7, tex = (texOn && fmt) ? this.gxTexture(p.tp, p.pal) : null;
      let pa = (p.attr >> 16) & 31; if (pa === 0) pa = 31;
      const pmode = (p.attr >> 4) & 3, decal = pmode === 1, toon = pmode === 2, hilite = toon && (d3 & 2), eq = p.attr & 0x4000, zw = pa === 31 || (p.attr & 0x800);
      const repS = p.tp & 0x10000, repT = p.tp & 0x20000, flS = p.tp & 0x40000, flT = p.tp & 0x80000;
      const vs = p.v, a = vs[0];
      for (let i = 1; i + 1 < vs.length; i++) {
        const b = vs[i], c = vs[i + 1];
        const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x); if (area === 0) continue;
        const inv = 1 / area;
        let x0 = Math.floor(Math.min(a.x, b.x, c.x)), x1 = Math.ceil(Math.max(a.x, b.x, c.x)), y0 = Math.floor(Math.min(a.y, b.y, c.y)), y1 = Math.ceil(Math.max(a.y, b.y, c.y));
        if (x0 < 0) x0 = 0; if (y0 < 0) y0 = 0; if (x1 > 255) x1 = 255; if (y1 > 191) y1 = 191;
        const d0 = (b.y - c.y) * inv, d1 = (c.y - a.y) * inv, dzx = d0 * (a.z - c.z) + d1 * (b.z - c.z), px0 = x0 + 0.5;
        for (let y = y0; y <= y1; y++) {
          const py = y + 0.5, row = y * 256;
          let w0 = ((b.x - px0) * (c.y - py) - (b.y - py) * (c.x - px0)) * inv, w1 = ((c.x - px0) * (a.y - py) - (c.y - py) * (a.x - px0)) * inv;
          let z = w0 * a.z + w1 * b.z + (1 - w0 - w1) * c.z, started = false;
          for (let x = x0; x <= x1; x++, w0 += d0, w1 += d1, z += dzx) {
            if (w0 < -1e-7 || w1 < -1e-7) { if (started) break; continue; }
            const w2 = 1 - w0 - w1; if (w2 < -1e-7) { if (started) break; continue; }
            started = true;
            const idx = row + x, dz = depth[idx];
            if (eq ? Math.abs(z - dz) > 0.002 : z >= dz) continue;
            const k = 1 / (w0 * a.iw + w1 * b.iw + w2 * c.iw);
            let r = (w0 * a.r + w1 * b.r + w2 * c.r) * k, gg = (w0 * a.g + w1 * b.g + w2 * c.g) * k, bb = (w0 * a.b + w1 * b.b + w2 * c.b) * k, al = pa, hr = 0, hg = 0, hb = 0;
            if (toon) {
              const tt = toonT[r < 0 ? 0 : r > 31 ? 31 : r | 0];
              if (hilite) { hr = tt & 31; hg = (tt >> 5) & 31; hb = (tt >> 10) & 31; gg = r; bb = r; }
              else { r = tt & 31; gg = (tt >> 5) & 31; bb = (tt >> 10) & 31; }
            }
            if (tex) {
              let s = Math.floor((w0 * a.s + w1 * b.s + w2 * c.s) * k), t = Math.floor((w0 * a.t + w1 * b.t + w2 * c.t) * k);
              const tw = tex.w, th = tex.h;
              if (repS) { if (flS && (s & tw)) s = tw - 1 - (s & (tw - 1)); else s &= tw - 1; } else if (s < 0) s = 0; else if (s >= tw) s = tw - 1;
              if (repT) { if (flT && (t & th)) t = th - 1 - (t & (th - 1)); else t &= th - 1; } else if (t < 0) t = 0; else if (t >= th) t = th - 1;
              const ti = t * tw + s, tc = tex.pix[ti], ta = tex.al[ti];
              if (decal) { const f = ta / 31; r += ((tc & 31) - r) * f; gg += (((tc >> 5) & 31) - gg) * f; bb += (((tc >> 10) & 31) - bb) * f; }
              else { r = ((tc & 31) + 1) * (r + 1) / 32 - 1; gg = (((tc >> 5) & 31) + 1) * (gg + 1) / 32 - 1; bb = (((tc >> 10) & 31) + 1) * (bb + 1) / 32 - 1; al = ((ta + 1) * (pa + 1) - 1) >> 5; }
            }
            if (hilite) { r += hr; gg += hg; bb += hb; }
            if (al <= 0) continue;
            let ri = r < 0 ? 0 : r > 31 ? 31 : r | 0, gi = gg < 0 ? 0 : gg > 31 ? 31 : gg | 0, bi = bb < 0 ? 0 : bb > 31 ? 31 : bb | 0;
            if (al < 31 && blendOn && alpha[idx]) {
              const old = color[idx], fa = al + 1, fb = 31 - al;
              ri = (ri * fa + (old & 31) * fb) >> 5; gi = (gi * fa + ((old >> 5) & 31) * fb) >> 5; bi = (bi * fa + ((old >> 10) & 31) * fb) >> 5;
              if (alpha[idx] < al) alpha[idx] = al;
              color[idx] = ri | (gi << 5) | (bi << 10);
              if (zw) depth[idx] = z;
            } else { color[idx] = ri | (gi << 5) | (bi << 10); alpha[idx] = al; if (zw || al === 31) depth[idx] = z; }
          }
        }
      }
    }
  };
  P.gxLine = function (y, out) {
    const g = this.g, color = g.color, alpha = g.alpha, row = y * 256;
    for (let x = 0; x < 256; x++) out[x] = alpha[row + x] ? color[row + x] : 0x8000;
  };
}
if (typeof module !== 'undefined') module.exports = nds3dInstall; else nds3dInstall(NDS);
