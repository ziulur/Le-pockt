// ===== 3DS: GPU PICA200 (parte 1) =====
// Lista de comandos, carregamento de vértices (arrays, índices, modo imediato, atributos fixos),
// shader de vértice (interpretador da ISA do PICA), montagem de primitivas, recorte, rasterização
// com interpolação em perspectiva, texturas (todos os formatos, incluindo ETC1), combinadores (TEV),
// teste de alfa, profundidade, mistura de cores e máscaras de escrita.
// Ainda não: iluminação por fragmento, shader de geometria, estêncil, névoa, mapas cúbicos.
function n3dsGpuInstall(N3DS) {
  const P = N3DS.prototype;
  const F24 = (v) => { v &= 0xFFFFFF; if (!(v & 0x7FFFFF)) return 0; const s = v >>> 23, e = (v >>> 16) & 0x7F, m = v & 0xFFFF; const f = (1 + m / 65536) * Math.pow(2, e - 63); return s ? -f : f; };
  const F31 = (v) => { v &= 0x7FFFFFFF; if (!(v & 0x7FFFFF)) return 0; const s = v >>> 30, e = (v >>> 23) & 0x7F, m = v & 0x7FFFFF; const f = (1 + m / 8388608) * Math.pow(2, e - 63); return s ? -f : f; };
  const f32buf = new DataView(new ArrayBuffer(4)), F32 = (v) => { f32buf.setUint32(0, v >>> 0, true); return f32buf.getFloat32(0, true); };
  const morton = new Uint8Array(64); for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) { let m = 0; for (let b = 0; b < 3; b++) m |= (((x >> b) & 1) << (2 * b)) | (((y >> b) & 1) << (2 * b + 1)); morton[y * 8 + x] = m; }
  const tiled = (x, y, w) => (morton[((y & 7) << 3) | (x & 7)] + (x >> 3) * 64 + (y >> 3) * w * 8);

  P.gpuInit = function () {
    this.pr = new Uint32Array(0x300); // registros do PICA
    this.vsCode = new Uint32Array(512); this.vsSwz = new Uint32Array(128); this.vsC = new Float32Array(96 * 4); this.vsB = 0; this.vsI = new Int32Array(16);
    this.vsCodeIdx = 0; this.vsSwzIdx = 0; this.unifIdx = 0; this.unifBuf = []; this.unifF32 = false;
    this.fixed = new Float32Array(16 * 4); this.fixedIdx = 0; this.fixedBuf = []; this.immVerts = [];
    this.gpuStats = { lists: 0, draws: 0, tris: 0, px: 0, unknownOp: 0 };
    this.strip = []; this.texCache = new Map();
  };
  // ----- lista de comandos -----
  P.gpuRunList = function (addr, size) {
    if (!this.pr) this.gpuInit();
    const m = this.mem; let a = this.v(addr) >>> 0; const end = a + size;
    this.gpuStats.lists++;
    let guard = 0;
    while (a < end && guard++ < 1 << 20) {
      const param = m.r32(a) >>> 0, hdr = m.r32(a + 4) >>> 0; a += 8;
      let id = hdr & 0xFFFF; const mask = (hdr >>> 16) & 15, extra = (hdr >>> 20) & 0xFF, seq = hdr >>> 31;
      this.gpuWrite(id, param, mask);
      for (let i = 0; i < extra; i++) { if (seq) id++; this.gpuWrite(id, m.r32(a) >>> 0, mask); a += 4; }
      if (extra & 1) a += 4; // alinhamento de 8 bytes
    }
  };
  P.gpuWrite = function (id, v, mask) {
    if (id >= 0x300) return;
    const R = this.pr;
    if (mask !== 15) { let bm = 0; for (let i = 0; i < 4; i++) if (mask & (1 << i)) bm |= 0xFF << (i * 8); v = ((R[id] & ~bm) | (v & bm)) >>> 0; }
    R[id] = v;
    switch (id) {
      case 0x22E: this.gpuDraw(false); break;
      case 0x22F: this.gpuDraw(true); break;
      case 0x232: this.fixedIdx = v & 0xF; this.fixedBuf = []; if (this.fixedIdx === 0xF) this.immVerts = []; break;
      case 0x233: case 0x234: case 0x235: {
        this.fixedBuf.push(v);
        if (this.fixedBuf.length === 3) {
          const b = this.fixedBuf, vec = [F24(b[2] & 0xFFFFFF), F24(((b[1] & 0xFFFF) << 8) | (b[2] >>> 24)), F24(((b[0] & 0xFF) << 16) | (b[1] >>> 16)), F24(b[0] >>> 8)];
          this.fixedBuf = [];
          if (this.fixedIdx === 0xF) { // modo imediato
            this.immVerts.push(vec); const n = (R[0x2B9] & 15) + 1;
            if (this.immVerts.length === n) { const inp = this.immVerts; this.immVerts = []; this.gpuVertex(this.vsInputs(inp)); }
          } else { this.fixed.set(vec, this.fixedIdx * 4); this.fixedIdx++; }
        }
        break;
      }
      case 0x25F: this.strip = []; break; // reinicia primitiva
      case 0x2C0: this.unifIdx = v & 0xFF; this.unifF32 = (v >>> 31) !== 0; this.unifBuf = []; break;
      case 0x2C1: case 0x2C2: case 0x2C3: case 0x2C4: case 0x2C5: case 0x2C6: case 0x2C7: case 0x2C8: {
        this.unifBuf.push(v); const b = this.unifBuf;
        if (this.unifF32 && b.length === 4) { const i = (this.unifIdx++ & 0x7F) * 4; if (i < 384) { this.vsC[i] = F32(b[3]); this.vsC[i + 1] = F32(b[2]); this.vsC[i + 2] = F32(b[1]); this.vsC[i + 3] = F32(b[0]); } this.unifBuf = []; }
        else if (!this.unifF32 && b.length === 3) { const i = (this.unifIdx++ & 0x7F) * 4; if (i < 384) { this.vsC[i] = F24(b[2] & 0xFFFFFF); this.vsC[i + 1] = F24(((b[1] & 0xFFFF) << 8) | (b[2] >>> 24)); this.vsC[i + 2] = F24(((b[0] & 0xFF) << 16) | (b[1] >>> 16)); this.vsC[i + 3] = F24(b[0] >>> 8); } this.unifBuf = []; }
        break;
      }
      case 0x2B0: this.vsB = v & 0xFFFF; break;
      case 0x2B1: case 0x2B2: case 0x2B3: case 0x2B4: { const k = (id - 0x2B1) * 4; this.vsI[k] = v & 0xFF; this.vsI[k + 1] = (v >>> 8) & 0xFF; this.vsI[k + 2] = (v << 8) >> 24; break; }
      case 0x2CB: this.vsCodeIdx = v & 0x1FF; break;
      case 0x2CC: case 0x2CD: case 0x2CE: case 0x2CF: case 0x2D0: case 0x2D1: case 0x2D2: case 0x2D3: this.vsCode[this.vsCodeIdx++ & 511] = v; break;
      case 0x2D5: this.vsSwzIdx = v & 0x7F; break;
      case 0x2D6: case 0x2D7: case 0x2D8: case 0x2D9: case 0x2DA: case 0x2DB: case 0x2DC: case 0x2DD: this.vsSwz[this.vsSwzIdx++ & 127] = v; break;
      case 0x110: case 0x111: this.texCache.clear(); break;
    }
  };
  // ----- vértices -----
  P.vsInputs = function (attrs) { // atributos -> registradores de entrada do shader
    const R = this.pr, map = R[0x2BB] | 0, map2 = R[0x2BC] | 0, inp = new Float32Array(64);
    for (let i = 0; i < attrs.length && i < 16; i++) { const reg = (i < 8 ? map >>> (i * 4) : map2 >>> ((i - 8) * 4)) & 15; inp.set(attrs[i], reg * 4); }
    return inp;
  };
  P.gpuDraw = function (indexed) {
    const R = this.pr, m = this.mem, n = R[0x228], base = (R[0x200] & 0x1FFFFFFF) << 3;
    const fmtLo = R[0x201], fmtHi = R[0x202], fixedMask = (fmtHi >>> 16) & 0xFFF, nAttr = ((fmtHi >>> 28) & 15) + 1;
    const fmt = (i) => (i < 8 ? fmtLo >>> (i * 4) : fmtHi >>> ((i - 8) * 4)) & 15;
    this.gpuStats.draws++; this.strip = [];
    const loaders = [];
    for (let j = 0; j < 12; j++) {
      const r0 = R[0x203 + j * 3], r1 = R[0x204 + j * 3], r2 = R[0x205 + j * 3], cnt = r2 >>> 28;
      if (!cnt) continue;
      const comps = []; for (let k = 0; k < cnt; k++) comps.push((k < 8 ? r1 >>> (k * 4) : r2 >>> ((k - 8) * 4)) & 15);
      loaders.push({ addr: this.v(base + (r0 & 0x0FFFFFFF)), stride: (r2 >>> 16) & 0xFF, comps });
    }
    const idxCfg = R[0x227], idxAddr = this.v(base + (idxCfg & 0x0FFFFFFF)), idx16 = idxCfg >>> 31, first = R[0x22A];
    const cache = new Map();
    for (let k = 0; k < n; k++) {
      const vi = indexed ? (idx16 ? m.r16(idxAddr + k * 2) : m.r8(idxAddr + k)) : first + k;
      let out = cache.get(vi);
      if (!out) {
        const attrs = [];
        for (let i = 0; i < nAttr; i++) attrs.push(fixedMask & (1 << i) ? this.fixed.subarray(i * 4, i * 4 + 4) : [0, 0, 0, 1]);
        for (const L of loaders) {
          let a = L.addr + vi * L.stride;
          for (const c of L.comps) {
            if (c >= 12) { a += (c - 11) * 4; continue; }
            const f = fmt(c), type = f & 3, cnt = (f >>> 2) + 1, sz = [1, 1, 2, 4][type];
            a = (a + sz - 1) & ~(sz - 1);
            const val = [0, 0, 0, 1];
            for (let e = 0; e < cnt; e++) {
              val[e] = type === 0 ? (m.r8(a) << 24) >> 24 : type === 1 ? m.r8(a) : type === 2 ? (m.r16(a) << 16) >> 16 : F32(m.r32(a));
              a += sz;
            }
            if (!(fixedMask & (1 << c))) attrs[c] = val;
          }
        }
        out = this.vsRun(this.vsInputs(attrs)); cache.set(vi, out);
      }
      this.gpuVertex(out, true);
    }
  };
  // ----- shader de vértice -----
  P.vsRun = function (inp) {
    const code = this.vsCode, swz = this.vsSwz, C = this.vsC, R = this.pr;
    const tmp = new Float32Array(64), out = new Float32Array(64), a0 = [0, 0]; let aL = 0, cx = false, cy = false;
    const calls = []; let pc = R[0x2BA] & 0x1FF, steps = 0;
    const src = (reg, rel) => {
      if (reg < 0x10) return inp.subarray(reg * 4, reg * 4 + 4);
      if (reg < 0x20) return tmp.subarray((reg - 0x10) * 4, (reg - 0x10) * 4 + 4);
      let u = reg - 0x20; if (rel === 1) u += a0[0]; else if (rel === 2) u += a0[1]; else if (rel === 3) u += aL;
      if (u < 0 || u >= 96) return [0, 0, 0, 1];
      return C.subarray(u * 4, u * 4 + 4);
    };
    const sel = (v, s, neg) => { const r = [v[(s >>> 6) & 3], v[(s >>> 4) & 3], v[(s >>> 2) & 3], v[s & 3]]; if (neg) for (let i = 0; i < 4; i++) r[i] = -r[i]; return r; };
    const dst = (d) => (d < 0x10 ? out.subarray(d * 4, d * 4 + 4) : tmp.subarray((d - 0x10) * 4, (d - 0x10) * 4 + 4));
    const cond = (ins) => { const rx = (ins >>> 25) & 1, ry = (ins >>> 24) & 1, op = (ins >>> 22) & 3, ex = cx === !!rx, ey = cy === !!ry; return op === 0 ? ex || ey : op === 1 ? ex && ey : op === 2 ? ex : ey; };
    const mul = (a, b) => (a === 0 || b === 0 ? 0 : a * b); // 0 * inf = 0 no PICA
    while (steps++ < 20000) {
      while (calls.length && pc === calls[calls.length - 1].end) {
        const c = calls[calls.length - 1];
        if (c.loop && c.left > 0) { c.left--; aL += c.inc; pc = c.start; break; }
        calls.pop(); pc = c.ret;
      }
      const ins = code[pc & 511] >>> 0, op = ins >>> 26; pc++;
      if (op >= 0x30) { // MAD / MADI
        const d = swz[ins & 0x1F], inv = op < 0x38, rel = (ins >>> 22) & 3;
        const s1 = sel(src((ins >>> 17) & 0x1F, 0), (d >>> 5) & 0xFF, d & 0x10);
        const s2 = sel(inv ? src((ins >>> 12) & 0x1F, 0) : src((ins >>> 10) & 0x7F, rel), (d >>> 14) & 0xFF, d & 0x2000);
        const s3 = sel(inv ? src((ins >>> 5) & 0x7F, rel) : src((ins >>> 5) & 0x1F, 0), (d >>> 23) & 0xFF, d & 0x400000);
        const D = dst((ins >>> 24) & 0x1F); for (let i = 0; i < 4; i++) if (d & (8 >> i)) D[i] = mul(s1[i], s2[i]) + s3[i];
        continue;
      }
      if (op === 0x2E || op === 0x2F) {
        const d = swz[ins & 0x7F], s1 = sel(src((ins >>> 12) & 0x7F, (ins >>> 19) & 3), (d >>> 5) & 0xFF, d & 0x10), s2 = sel(src((ins >>> 7) & 0x1F, 0), (d >>> 14) & 0xFF, d & 0x2000);
        const cmp = (a, b, o) => o === 0 ? a === b : o === 1 ? a !== b : o === 2 ? a < b : o === 3 ? a <= b : o === 4 ? a > b : a >= b;
        cx = cmp(s1[0], s2[0], (ins >>> 24) & 7); cy = cmp(s1[1], s2[1], (ins >>> 21) & 7); continue;
      }
      if (op >= 0x20) {
        const dest = (ins >>> 10) & 0xFFF, num = ins & 0xFF;
        switch (op) {
          case 0x21: continue;
          case 0x22: return out;
          case 0x20: case 0x23: { if (op === 0x20 || cond(ins)) { while (calls.length && !calls[calls.length - 1].loop) calls.pop(); const c = calls.pop(); if (c) pc = c.ret; } continue; }
          case 0x24: calls.push({ end: dest + num, ret: pc }); pc = dest; continue;
          case 0x25: if (cond(ins)) { calls.push({ end: dest + num, ret: pc }); pc = dest; } continue;
          case 0x26: if ((this.vsB >>> ((ins >>> 22) & 15)) & 1) { calls.push({ end: dest + num, ret: pc }); pc = dest; } continue;
          case 0x27: case 0x28: {
            const ok = op === 0x27 ? ((this.vsB >>> ((ins >>> 22) & 15)) & 1) === 1 : cond(ins);
            if (ok) calls.push({ end: dest, ret: dest + num }); else if (num) { calls.push({ end: dest + num, ret: dest + num }); pc = dest; } else pc = dest;
            continue;
          }
          case 0x29: { const k = ((ins >>> 22) & 3) * 4; aL = this.vsI[k + 1]; calls.push({ loop: true, start: pc, end: dest + 1, ret: dest + 1, left: this.vsI[k], inc: this.vsI[k + 2] }); continue; }
          case 0x2C: if (cond(ins)) pc = dest; continue;
          case 0x2D: if ((((this.vsB >>> ((ins >>> 22) & 15)) & 1) === 1) !== ((num & 1) === 1)) pc = dest; continue;
          default: continue; // EMIT/SETEMIT: shader de geometria (próxima parte)
        }
      }
      // formato 1 / 1i
      const d = swz[ins & 0x7F], inv = op === 0x18 || op === 0x19 || op === 0x1A || op === 0x1B, rel = (ins >>> 19) & 3;
      const r1 = inv ? src((ins >>> 14) & 0x1F, 0) : src((ins >>> 12) & 0x7F, rel), r2 = inv ? src((ins >>> 7) & 0x7F, rel) : src((ins >>> 7) & 0x1F, 0);
      const s1 = sel(r1, (d >>> 5) & 0xFF, d & 0x10), s2 = sel(r2, (d >>> 14) & 0xFF, d & 0x2000);
      const dreg = (ins >>> 21) & 0x1F, res = [0, 0, 0, 0];
      switch (op) {
        case 0x00: for (let i = 0; i < 4; i++) res[i] = s1[i] + s2[i]; break;
        case 0x01: { const v = mul(s1[0], s2[0]) + mul(s1[1], s2[1]) + mul(s1[2], s2[2]); res.fill(v); break; }
        case 0x02: { const v = mul(s1[0], s2[0]) + mul(s1[1], s2[1]) + mul(s1[2], s2[2]) + mul(s1[3], s2[3]); res.fill(v); break; }
        case 0x03: case 0x18: { const v = mul(s1[0], s2[0]) + mul(s1[1], s2[1]) + mul(s1[2], s2[2]) + s2[3]; res.fill(v); break; }
        case 0x04: case 0x19: res[0] = 1; res[1] = mul(s1[1], s2[1]); res[2] = s1[2]; res[3] = s2[3]; break;
        case 0x05: res.fill(Math.pow(2, s1[0])); break;
        case 0x06: res.fill(Math.log2(s1[0])); break;
        case 0x08: for (let i = 0; i < 4; i++) res[i] = mul(s1[i], s2[i]); break;
        case 0x09: case 0x1A: for (let i = 0; i < 4; i++) res[i] = s1[i] >= s2[i] ? 1 : 0; break;
        case 0x0A: case 0x1B: for (let i = 0; i < 4; i++) res[i] = s1[i] < s2[i] ? 1 : 0; break;
        case 0x0B: for (let i = 0; i < 4; i++) res[i] = Math.floor(s1[i]); break;
        case 0x0C: for (let i = 0; i < 4; i++) res[i] = s1[i] > s2[i] ? s1[i] : s2[i]; break;
        case 0x0D: for (let i = 0; i < 4; i++) res[i] = s1[i] < s2[i] ? s1[i] : s2[i]; break;
        case 0x0E: res.fill(1 / s1[0]); break;
        case 0x0F: res.fill(1 / Math.sqrt(s1[0])); break;
        case 0x12: if (d & 8) a0[0] = Math.trunc(s1[0]) | 0; if (d & 4) a0[1] = Math.trunc(s1[1]) | 0; continue;
        case 0x13: for (let i = 0; i < 4; i++) res[i] = s1[i]; break;
        default: this.gpuStats.unknownOp = op; continue;
      }
      const D = dst(dreg); for (let i = 0; i < 4; i++) if (d & (8 >> i)) D[i] = res[i];
    }
    return out;
  };
  // saídas do shader -> atributos do vértice (posição, cor, coordenadas de textura)
  P.vsSemantics = function (out) {
    const R = this.pr, n = Math.min(7, R[0x4F] & 7), v = { pos: [0, 0, 0, 1], col: [1, 1, 1, 1], tc0: [0, 0], tc1: [0, 0], tc2: [0, 0] };
    for (let o = 0; o < n; o++) {
      const map = R[0x50 + o];
      for (let c = 0; c < 4; c++) {
        const sem = (map >>> (c * 8)) & 0x1F, val = out[o * 4 + c];
        if (sem < 4) v.pos[sem] = val; else if (sem >= 8 && sem < 12) v.col[sem - 8] = Math.max(0, Math.min(1, val));
        else if (sem === 12 || sem === 13) v.tc0[sem - 12] = val; else if (sem === 14 || sem === 15) v.tc1[sem - 14] = val; else if (sem === 22 || sem === 23) v.tc2[sem - 22] = val;
      }
    }
    return v;
  };
  P.gpuVertex = function (out, already) {
    const v = this.vsSemantics(already ? out : this.vsRun(out)), R = this.pr, mode = (R[0x25E] >>> 8) & 3, s = this.strip;
    s.push(v);
    if (mode === 0 || mode === 3) { if (s.length === 3) { this.gpuTri(s[0], s[1], s[2]); s.length = 0; } }
    else if (mode === 1) { if (s.length === 3) { if (s.odd) this.gpuTri(s[1], s[0], s[2]); else this.gpuTri(s[0], s[1], s[2]); s.odd = !s.odd; s.shift(); } }
    else { if (s.length === 3) { this.gpuTri(s[0], s[1], s[2]); s.splice(1, 1); } }
  };
  // ----- recorte e rasterização -----
  const PLANES = [(p) => p[3] - 1e-5, (p) => p[3] - p[0], (p) => p[3] + p[0], (p) => p[3] - p[1], (p) => p[3] + p[1], (p) => -p[2], (p) => p[3] + p[2]];
  const lerpV = (a, b, t) => ({ pos: a.pos.map((x, i) => x + (b.pos[i] - x) * t), col: a.col.map((x, i) => x + (b.col[i] - x) * t), tc0: a.tc0.map((x, i) => x + (b.tc0[i] - x) * t), tc1: a.tc1.map((x, i) => x + (b.tc1[i] - x) * t), tc2: a.tc2.map((x, i) => x + (b.tc2[i] - x) * t) });
  P.gpuTri = function (a, b, c) {
    let poly = [a, b, c];
    for (const pl of PLANES) {
      if (poly.length < 3) return;
      const o = [];
      for (let i = 0; i < poly.length; i++) { const p = poly[i], q = poly[(i + 1) % poly.length], dp = pl(p.pos), dq = pl(q.pos); if (dp >= 0) o.push(p); if ((dp >= 0) !== (dq >= 0)) o.push(lerpV(p, q, dp / (dp - dq))); }
      poly = o;
    }
    if (poly.length < 3) return;
    for (let i = 1; i + 1 < poly.length; i++) this.gpuRaster(poly[0], poly[i], poly[i + 1]);
  };
  P.gpuTarget = function () {
    const R = this.pr, dim = R[0x11E], w = dim & 0x7FF, h = ((dim >>> 12) & 0x3FF) + 1;
    return { w, h, color: this.v((R[0x11D] & 0x0FFFFFFF) << 3), depth: this.v((R[0x11C] & 0x0FFFFFFF) << 3), cfmt: (R[0x117] >>> 16) & 7, dfmt: R[0x116] & 3 };
  };
  P.gpuRaster = function (A, B, Cv) {
    const R = this.pr, T = this.gpuTarget(); if (!T.w || !T.h || !T.color) return;
    const hw = F24(R[0x41]), hh = F24(R[0x43]), vx = R[0x68] & 0x3FF, vy = (R[0x68] >>> 16) & 0x3FF, zs = F24(R[0x4D]), zo = F24(R[0x4E]);
    const proj = (v) => { const iw = 1 / v.pos[3]; return { x: (v.pos[0] * iw + 1) * hw + vx, y: (v.pos[1] * iw + 1) * hh + vy, z: v.pos[2] * iw * zs + zo, iw, v }; };
    const p = [proj(A), proj(B), proj(Cv)];
    let area = (p[1].x - p[0].x) * (p[2].y - p[0].y) - (p[1].y - p[0].y) * (p[2].x - p[0].x);
    if (area === 0) return;
    const cull = R[0x40] & 3; if ((cull === 1 && area < 0) || (cull === 2 && area > 0)) return;
    this.gpuStats.tris++;
    const x0 = Math.max(0, Math.floor(Math.min(p[0].x, p[1].x, p[2].x))), x1 = Math.min(T.w - 1, Math.ceil(Math.max(p[0].x, p[1].x, p[2].x)));
    const y0 = Math.max(0, Math.floor(Math.min(p[0].y, p[1].y, p[2].y))), y1 = Math.min(T.h - 1, Math.ceil(Math.max(p[0].y, p[1].y, p[2].y)));
    const inv = 1 / area, m = this.mem, cbpp = [4, 3, 2, 2, 2][T.cfmt] || 4, dbpp = [2, 2, 3, 4][T.dfmt];
    const dmask = R[0x107], dtest = dmask & 1, dfunc = (dmask >>> 4) & 7, cmask = (dmask >>> 8) & 15, dwrite = (dmask >>> 12) & 1;
    const at = R[0x104], aOn = at & 1, aFunc = (at >>> 4) & 7, aRef = (at >>> 8) & 0xFF;
    const blendOn = (R[0x100] >>> 8) & 1, bf = R[0x101], bc = R[0x103];
    const texOn = R[0x80] & 7, tex = [texOn & 1 ? this.gpuTex(0) : null, texOn & 2 ? this.gpuTex(1) : null, texOn & 4 ? this.gpuTex(2) : null];
    const tc2src = (R[0x80] >>> 13) & 1;
    const cmpf = (f, a, b) => f === 0 ? false : f === 1 ? true : f === 2 ? a === b : f === 3 ? a !== b : f === 4 ? a < b : f === 5 ? a <= b : f === 6 ? a > b : a >= b;
    const dmax = T.dfmt === 0 ? 65535 : 16777215;
    const scBox = R[0x65] & 3 ? { x0: R[0x66] & 0x3FF, y0: (R[0x66] >>> 16) & 0x3FF, x1: R[0x67] & 0x3FF, y1: (R[0x67] >>> 16) & 0x3FF } : null;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5;
        let w0 = ((p[1].x - px) * (p[2].y - py) - (p[1].y - py) * (p[2].x - px)) * inv, w1 = ((p[2].x - px) * (p[0].y - py) - (p[2].y - py) * (p[0].x - px)) * inv, w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        if (scBox && (x < scBox.x0 || x > scBox.x1 || y < scBox.y0 || y > scBox.y1)) continue;
        const fy = T.h - 1 - y, off = tiled(x, fy, T.w);
        const z = w0 * p[0].z + w1 * p[1].z + w2 * p[2].z, zi = Math.max(0, Math.min(dmax, Math.round(z * dmax)));
        const da = T.depth + off * dbpp;
        if (dtest && T.depth) { const old = dbpp === 2 ? m.r16(da) : (m.r8(da) | (m.r8(da + 1) << 8) | (m.r8(da + 2) << 16)); if (!cmpf(dfunc, zi, old)) continue; }
        // interpolação em perspectiva
        const q0 = w0 * p[0].iw, q1 = w1 * p[1].iw, q2 = w2 * p[2].iw, qs = 1 / (q0 + q1 + q2);
        const I = (f, i) => (q0 * p[0].v[f][i] + q1 * p[1].v[f][i] + q2 * p[2].v[f][i]) * qs;
        const col = [I('col', 0), I('col', 1), I('col', 2), I('col', 3)];
        const tcs = [[I('tc0', 0), I('tc0', 1)], [I('tc1', 0), I('tc1', 1)], tc2src ? [I('tc1', 0), I('tc1', 1)] : [I('tc2', 0), I('tc2', 1)]];
        const texel = tex.map((t, i) => (t ? this.gpuSample(t, tcs[i][0], tcs[i][1]) : [0, 0, 0, 1]));
        const frag = this.gpuTev(col, texel);
        if (aOn && !cmpf(aFunc, Math.round(frag[3] * 255), aRef)) continue;
        const ca = T.color + off * cbpp;
        let outc = frag;
        if (blendOn) {
          const dst = this.readPx(ca, T.cfmt).map((x) => x / 255), cc = [(bc & 0xFF) / 255, ((bc >>> 8) & 0xFF) / 255, ((bc >>> 16) & 0xFF) / 255, (bc >>> 24) / 255];
          const fac = (f, i) => { switch (f) { case 0: return 0; case 1: return 1; case 2: return frag[i]; case 3: return 1 - frag[i]; case 4: return dst[i]; case 5: return 1 - dst[i]; case 6: return frag[3]; case 7: return 1 - frag[3]; case 8: return dst[3]; case 9: return 1 - dst[3]; case 10: return cc[i]; case 11: return 1 - cc[i]; case 12: return cc[3]; case 13: return 1 - cc[3]; default: return i === 3 ? 1 : Math.min(frag[3], 1 - dst[3]); } };
          const eq = (e, s, d) => e === 0 ? s + d : e === 1 ? s - d : e === 2 ? d - s : e === 3 ? Math.min(s, d) : Math.max(s, d);
          outc = [0, 1, 2, 3].map((i) => { const rgb = i < 3, sf = fac(rgb ? (bf >>> 16) & 15 : (bf >>> 24) & 15, i), df = fac(rgb ? (bf >>> 20) & 15 : (bf >>> 28) & 15, i); return Math.max(0, Math.min(1, eq(rgb ? bf & 7 : (bf >>> 8) & 7, frag[i] * sf, dst[i] * df))); });
        }
        if (cmask === 15) this.writePx(ca, T.cfmt, outc.map((x) => Math.round(x * 255)));
        else if (cmask) { const old = this.readPx(ca, T.cfmt); this.writePx(ca, T.cfmt, outc.map((x, i) => (cmask & (1 << i) ? Math.round(x * 255) : old[i]))); }
        if (dwrite && T.depth) { if (dbpp === 2) m.w16(da, zi); else { m.w8(da, zi); m.w8(da + 1, zi >>> 8); m.w8(da + 2, zi >>> 16); } }
        this.gpuStats.px++;
      }
    }
  };
  // ----- texturas -----
  P.gpuTex = function (u) {
    const R = this.pr, b = [0x81, 0x91, 0x99][u], fr = [0x8E, 0x96, 0x9E][u], ar = [0x85, 0x95, 0x9D][u];
    const dim = R[b + 1], h = dim & 0x7FF, w = (dim >>> 16) & 0x7FF, par = R[b + 2], fmt = R[fr] & 15, addr = this.v((R[ar] & 0x0FFFFFFF) << 3);
    if (!w || !h) return null;
    const key = addr + ':' + w + 'x' + h + ':' + fmt;
    let t = this.texCache.get(key);
    if (!t) { t = { w, h, px: this.gpuDecode(addr, w, h, fmt) }; this.texCache.set(key, t); }
    return { w, h, px: t.px, ws: (par >>> 12) & 7, wt: (par >>> 8) & 7, border: R[b], lin: (par >>> 1) & 1 };
  };
  P.gpuSample = function (t, s, tt) {
    const wrap = (v, n, mode) => { if (mode === 2 || mode === 3) { const k = Math.floor(v / n); v -= k * n; return mode === 3 && (k & 1) ? n - 1 - v : v; } if (mode === 1) return v < 0 || v >= n ? -1 : v; return v < 0 ? 0 : v >= n ? n - 1 : v; };
    let x = Math.floor(s * t.w), y = Math.floor((1 - tt) * t.h);
    x = wrap(x, t.w, t.ws); y = wrap(y, t.h, t.wt);
    if (x < 0 || y < 0) { const b = t.border; return [(b & 0xFF) / 255, ((b >>> 8) & 0xFF) / 255, ((b >>> 16) & 0xFF) / 255, (b >>> 24) / 255]; }
    const c = t.px[y * t.w + x]; return [(c & 0xFF) / 255, ((c >>> 8) & 0xFF) / 255, ((c >>> 16) & 0xFF) / 255, (c >>> 24) / 255];
  };
  const ETC = [[2, 8], [5, 17], [9, 29], [13, 42], [18, 60], [24, 80], [33, 106], [47, 183]];
  P.gpuDecode = function (addr, w, h, fmt) {
    const m = this.mem, out = new Uint32Array(w * h), pack = (r, g, b, a) => ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
    if (fmt === 12 || fmt === 13) {
      const blk = fmt === 13 ? 16 : 8; let a = addr;
      for (let ty = 0; ty < h; ty += 8) for (let tx = 0; tx < w; tx += 8) for (let sub = 0; sub < 4; sub++) {
        const bx = tx + (sub & 1) * 4, by = ty + (sub >> 1) * 4;
        let alpha = null; if (fmt === 13) { alpha = [m.r32(a) >>> 0, m.r32(a + 4) >>> 0]; a += 8; }
        const lo = m.r32(a) >>> 0, hi = m.r32(a + 4) >>> 0; a += 8;
        const diff = (hi >>> 1) & 1, flip = hi & 1, t1 = (hi >>> 5) & 7, t2 = (hi >>> 2) & 7;
        let c1, c2;
        if (diff) { const r = (hi >>> 27) & 31, g = (hi >>> 19) & 31, b = (hi >>> 11) & 31, dr = ((hi >>> 24) & 7) << 29 >> 29, dg = ((hi >>> 16) & 7) << 29 >> 29, db = ((hi >>> 8) & 7) << 29 >> 29, e = (v) => (v << 3) | (v >> 2);
          c1 = [e(r), e(g), e(b)]; c2 = [e((r + dr) & 31), e((g + dg) & 31), e((b + db) & 31)]; }
        else { const e = (v) => v * 17; c1 = [e((hi >>> 28) & 15), e((hi >>> 20) & 15), e((hi >>> 12) & 15)]; c2 = [e((hi >>> 24) & 15), e((hi >>> 16) & 15), e((hi >>> 8) & 15)]; }
        for (let i = 0; i < 16; i++) {
          const px = i >> 2, py = i & 3, second = flip ? py >= 2 : px >= 2, base = second ? c2 : c1, tbl = ETC[second ? t2 : t1];
          const msb = (lo >>> (16 + i)) & 1, lsb = (lo >>> i) & 1, d = lsb ? tbl[1] : tbl[0], dv = msb ? -d : d;
          const cl = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
          let al = 255; if (alpha) { const k = px * 4 + py, wv = k < 8 ? alpha[0] : alpha[1]; al = ((wv >>> ((k & 7) * 4)) & 15) * 17; }
          const X = bx + px, Y = by + py; if (X < w && Y < h) out[Y * w + X] = pack(cl(base[0] + dv), cl(base[1] + dv), cl(base[2] + dv), al);
        }
      }
      return out;
    }
    const bpp = [32, 24, 16, 16, 16, 16, 16, 8, 8, 8, 4, 4][fmt] || 32;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const t = tiled(x, y, w), o = addr + ((t * bpp) >> 3);
      let r = 0, g = 0, b = 0, a = 255;
      switch (fmt) {
        case 0: a = m.r8(o); b = m.r8(o + 1); g = m.r8(o + 2); r = m.r8(o + 3); break;
        case 1: b = m.r8(o); g = m.r8(o + 1); r = m.r8(o + 2); break;
        case 2: { const v = m.r16(o); r = ((v >> 11) & 31) * 255 / 31 | 0; g = ((v >> 6) & 31) * 255 / 31 | 0; b = ((v >> 1) & 31) * 255 / 31 | 0; a = v & 1 ? 255 : 0; break; }
        case 3: { const v = m.r16(o); r = ((v >> 11) & 31) * 255 / 31 | 0; g = ((v >> 5) & 63) * 255 / 63 | 0; b = (v & 31) * 255 / 31 | 0; break; }
        case 4: { const v = m.r16(o); r = ((v >> 12) & 15) * 17; g = ((v >> 8) & 15) * 17; b = ((v >> 4) & 15) * 17; a = (v & 15) * 17; break; }
        case 5: a = m.r8(o); r = g = b = m.r8(o + 1); break;
        case 6: r = m.r8(o); g = m.r8(o + 1); b = 0; break;
        case 7: r = g = b = m.r8(o); break;
        case 8: r = g = b = 0; a = m.r8(o); break;
        case 9: { const v = m.r8(o); a = (v & 15) * 17; r = g = b = (v >> 4) * 17; break; }
        case 10: { const v = (m.r8(o) >> ((t & 1) * 4)) & 15; r = g = b = v * 17; break; }
        case 11: { const v = (m.r8(o) >> ((t & 1) * 4)) & 15; r = g = b = 0; a = v * 17; break; }
      }
      out[(h - 1 - y) * w + x] = pack(r, g, b, a);
    }
    return out;
  };
  // ----- combinadores de textura (TEV) -----
  P.gpuTev = function (prim, tex) {
    const R = this.pr, base = [0xC0, 0xC8, 0xD0, 0xD8, 0xF0, 0xF8], bufCfg = R[0xE0];
    let prev = prim.slice(), buf = [(R[0xFD] & 0xFF) / 255, ((R[0xFD] >>> 8) & 0xFF) / 255, ((R[0xFD] >>> 16) & 0xFF) / 255, (R[0xFD] >>> 24) / 255];
    const fragPrim = [1, 1, 1, 1], fragSec = [0, 0, 0, 1];
    for (let st = 0; st < 6; st++) {
      const b = base[st], srcR = R[b], opR = R[b + 1], cmb = R[b + 2], k = R[b + 3], sc = R[b + 4];
      const konst = [(k & 0xFF) / 255, ((k >>> 8) & 0xFF) / 255, ((k >>> 16) & 0xFF) / 255, (k >>> 24) / 255];
      const source = (s) => { switch (s) { case 0: return prim; case 1: return fragPrim; case 2: return fragSec; case 3: return tex[0]; case 4: return tex[1]; case 5: return tex[2]; case 6: return tex[2]; case 13: return buf; case 14: return konst; default: return prev; } };
      const rgbOp = (c, o) => { switch (o) { case 0: return [c[0], c[1], c[2]]; case 1: return [1 - c[0], 1 - c[1], 1 - c[2]]; case 2: return [c[3], c[3], c[3]]; case 3: return [1 - c[3], 1 - c[3], 1 - c[3]]; case 4: return [c[0], c[0], c[0]]; case 5: return [1 - c[0], 1 - c[0], 1 - c[0]]; case 8: return [c[1], c[1], c[1]]; case 9: return [1 - c[1], 1 - c[1], 1 - c[1]]; case 12: return [c[2], c[2], c[2]]; case 13: return [1 - c[2], 1 - c[2], 1 - c[2]]; default: return [c[0], c[1], c[2]]; } };
      const aOp = (c, o) => { switch (o) { case 0: return c[3]; case 1: return 1 - c[3]; case 2: return c[0]; case 3: return 1 - c[0]; case 4: return c[1]; case 5: return 1 - c[1]; case 6: return c[2]; default: return 1 - c[2]; } };
      const comb = (mode, a, b, c) => { switch (mode) { case 0: return a; case 1: return a * b; case 2: return a + b; case 3: return a + b - 0.5; case 4: return a * c + b * (1 - c); case 5: return a - b; case 8: return a * b + c; case 9: return (a + b) * c; default: return a; } };
      const A = [0, 1, 2].map((i) => rgbOp(source((srcR >>> (i * 4)) & 15), (opR >>> (i * 4)) & 15));
      const Aa = [0, 1, 2].map((i) => aOp(source((srcR >>> (16 + i * 4)) & 15), (opR >>> (12 + i * 4)) & 7));
      const cm = cmb & 15, am = (cmb >>> 16) & 15, rs = [1, 2, 4][sc & 3] || 1, as = [1, 2, 4][(sc >>> 16) & 3] || 1;
      let rgb;
      if (cm === 6 || cm === 7) { const d = 4 * ((A[0][0] - 0.5) * (A[1][0] - 0.5) + (A[0][1] - 0.5) * (A[1][1] - 0.5) + (A[0][2] - 0.5) * (A[1][2] - 0.5)); rgb = [d, d, d]; }
      else rgb = [0, 1, 2].map((i) => comb(cm, A[0][i], A[1][i], A[2][i]));
      let al = cm === 7 ? rgb[0] : comb(am, Aa[0], Aa[1], Aa[2]);
      const cl = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
      const outc = [cl(rgb[0] * rs), cl(rgb[1] * rs), cl(rgb[2] * rs), cl(al * as)];
      // buffer de combinação: atualizado a partir do resultado da etapa anterior (etapas 1 a 4)
      if (st >= 1 && st <= 4) { const nb = buf.slice(); if (bufCfg & (0x100 << (st - 1))) { nb[0] = prev[0]; nb[1] = prev[1]; nb[2] = prev[2]; } if (bufCfg & (0x1000 << (st - 1))) nb[3] = prev[3]; buf = nb; }
      prev = outc;
    }
    return prev;
  };
}
if (typeof module !== 'undefined') module.exports = n3dsGpuInstall; else n3dsGpuInstall(N3DS);
