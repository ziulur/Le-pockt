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
    const unit = () => ({ code: new Uint32Array(512), swz: new Uint32Array(128), C: new Float32Array(96 * 4), B: 0, I: new Int32Array(16), codeIdx: 0, swzIdx: 0, unifIdx: 0, unifBuf: [], unifF32: false });
    this.vs = unit(); this.gs = unit(); this.gsIn = []; this.gsStats = 0;
    this.vsCode = this.vs.code; this.vsSwz = this.vs.swz; this.vsC = this.vs.C; this.vsI = this.vs.I; this.vsB = 0;
    this.fixed = new Float32Array(16 * 4); this.fixedIdx = 0; this.fixedBuf = []; this.immVerts = [];
    this.gpuStats = { lists: 0, draws: 0, tris: 0, px: 0, unknownOp: 0 }; this.gsIn = [];
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
    if (id >= 0x280 && id < 0x2E0) { this.shReg(id >= 0x2B0 ? this.vs : this.gs, id >= 0x2B0 ? id - 0x2B0 : id - 0x280, v); if (id === 0x2B0) this.vsB = v & 0xFFFF; return; }
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
      case 0x110: case 0x111: this.texCache.clear(); break;
      case 0xE6: this.fogIdx = v & 0x7F; break;
      case 0xE8: case 0xE9: case 0xEA: case 0xEB: case 0xEC: case 0xED: case 0xEE: case 0xEF: if (!this.fogLut) this.fogLut = new Uint32Array(128); this.fogLut[(this.fogIdx || 0) & 127] = v; this.fogIdx = ((this.fogIdx || 0) + 1) & 127; break;
      case 0x1C5: this.lutSel = (v >>> 8) & 0x1F; this.lutIdx = v & 0xFF; break;
      case 0x1C8: case 0x1C9: case 0x1CA: case 0x1CB: case 0x1CC: case 0x1CD: case 0x1CE: case 0x1CF:
        if (!this.luts) this.luts = new Uint32Array(24 * 256);
        this.luts[((this.lutSel || 0) % 24) * 256 + (this.lutIdx & 0xFF)] = v; this.lutIdx = (this.lutIdx + 1) & 0xFF; break;
    }
  };
  P.shReg = function (U, o, v) { // registros de uma unidade de shader (o = deslocamento a partir de 0x280/0x2B0)
    switch (o) {
      case 0x00: U.B = v & 0xFFFF; break;
      case 0x01: case 0x02: case 0x03: case 0x04: { const k = (o - 1) * 4; U.I[k] = v & 0xFF; U.I[k + 1] = (v >>> 8) & 0xFF; U.I[k + 2] = (v << 8) >> 24; break; }
      case 0x10: U.unifIdx = v & 0xFF; U.unifF32 = (v >>> 31) !== 0; U.unifBuf = []; break;
      case 0x11: case 0x12: case 0x13: case 0x14: case 0x15: case 0x16: case 0x17: case 0x18: {
        U.unifBuf.push(v); const b = U.unifBuf, C = U.C;
        if (U.unifF32 && b.length === 4) { const i = (U.unifIdx++ & 0x7F) * 4; if (i < 384) { C[i] = F32(b[3]); C[i + 1] = F32(b[2]); C[i + 2] = F32(b[1]); C[i + 3] = F32(b[0]); } U.unifBuf = []; }
        else if (!U.unifF32 && b.length === 3) { const i = (U.unifIdx++ & 0x7F) * 4; if (i < 384) { C[i] = F24(b[2] & 0xFFFFFF); C[i + 1] = F24(((b[1] & 0xFFFF) << 8) | (b[2] >>> 24)); C[i + 2] = F24(((b[0] & 0xFF) << 16) | (b[1] >>> 16)); C[i + 3] = F24(b[0] >>> 8); } U.unifBuf = []; }
        break;
      }
      case 0x1B: U.codeIdx = v & 0x1FF; break;
      case 0x1C: case 0x1D: case 0x1E: case 0x1F: case 0x20: case 0x21: case 0x22: case 0x23: U.code[U.codeIdx++ & 511] = v; break;
      case 0x25: U.swzIdx = v & 0x7F; break;
      case 0x26: case 0x27: case 0x28: case 0x29: case 0x2A: case 0x2B: case 0x2C: case 0x2D: U.swz[U.swzIdx++ & 127] = v; break;
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
  P.vsRun = function (inp, U, emit) {
    U = U || this.vs; const code = U.code, swz = U.swz, C = U.C, R = this.pr, B = U.B, IU = U.I, entryReg = U === this.vs ? 0x2BA : 0x28A;
    let emV = 0, emPrim = 0, emWind = 0;
    const tmp = new Float32Array(64), out = new Float32Array(64), a0 = [0, 0]; let aL = 0, cx = false, cy = false;
    const calls = []; let pc = R[entryReg] & 0x1FF, steps = 0;
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
          case 0x26: if ((B >>> ((ins >>> 22) & 15)) & 1) { calls.push({ end: dest + num, ret: pc }); pc = dest; } continue;
          case 0x27: case 0x28: {
            const ok = op === 0x27 ? ((B >>> ((ins >>> 22) & 15)) & 1) === 1 : cond(ins);
            if (ok) calls.push({ end: dest, ret: dest + num }); else if (num) { calls.push({ end: dest + num, ret: dest + num }); pc = dest; } else pc = dest;
            continue;
          }
          case 0x29: { const k = ((ins >>> 22) & 3) * 4; aL = IU[k + 1]; calls.push({ loop: true, start: pc, end: dest + 1, ret: dest + 1, left: IU[k], inc: IU[k + 2] }); continue; }
          case 0x2C: if (cond(ins)) pc = dest; continue;
          case 0x2D: if ((((B >>> ((ins >>> 22) & 15)) & 1) === 1) !== ((num & 1) === 1)) pc = dest; continue;
          case 0x2B: emV = (ins >>> 24) & 3; emPrim = (ins >>> 22) & 1; emWind = (ins >>> 23) & 1; continue; // SETEMIT
          case 0x2A: if (emit) emit(emV, out.slice(), emPrim, emWind); continue; // EMIT
          default: continue;
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
    const R = this.pr, n = Math.min(7, R[0x4F] & 7), v = { pos: [0, 0, 0, 1], col: [1, 1, 1, 1], tc0: [0, 0], tc1: [0, 0], tc2: [0, 0], quat: [0, 0, 0, 1], view: [0, 0, 1] };
    for (let o = 0; o < n; o++) {
      const map = R[0x50 + o];
      for (let c = 0; c < 4; c++) {
        const sem = (map >>> (c * 8)) & 0x1F, val = out[o * 4 + c];
        if (sem < 4) v.pos[sem] = val; else if (sem >= 8 && sem < 12) v.col[sem - 8] = Math.max(0, Math.min(1, val));
        else if (sem === 12 || sem === 13) v.tc0[sem - 12] = val; else if (sem === 14 || sem === 15) v.tc1[sem - 14] = val; else if (sem === 22 || sem === 23) v.tc2[sem - 22] = val;
        else if (sem >= 4 && sem < 8) v.quat[sem - 4] = val; else if (sem >= 0x12 && sem <= 0x14) v.view[sem - 0x12] = val;
      }
    }
    return v;
  };
  P.gpuVertex = function (out, already) {
    const R = this.pr;
    if ((R[0x229] & 3) === 2) { // shader de geometria: as saídas do vértice viram entradas do GS
      const o = already ? out : this.vsRun(out), mask = R[0x2BD] & 0xFFFF;
      for (let i = 0; i < 16; i++) if (mask & (1 << i)) this.gsIn.push(o.subarray(i * 4, i * 4 + 4));
      const need = (R[0x289] & 15) + 1;
      while (this.gsIn.length >= need) {
        const inp = new Float32Array(64); for (let i = 0; i < need; i++) inp.set(this.gsIn[i], i * 4); this.gsIn.splice(0, need);
        const buf = []; this.gsStats++;
        this.vsRun(inp, this.gs, (vid, o2, prim, wind) => { buf[vid] = this.vsSemantics(o2); if (prim && buf[0] && buf[1] && buf[2]) { if (wind) this.gpuTri(buf[2], buf[1], buf[0]); else this.gpuTri(buf[0], buf[1], buf[2]); } });
      }
      return;
    }
    const v = this.vsSemantics(already ? out : this.vsRun(out)), mode = (R[0x25E] >>> 8) & 3, s = this.strip;
    s.push(v);
    if (mode === 0 || mode === 3) { if (s.length === 3) { this.gpuTri(s[0], s[1], s[2]); s.length = 0; } }
    else if (mode === 1) { if (s.length === 3) { if (s.odd) this.gpuTri(s[1], s[0], s[2]); else this.gpuTri(s[0], s[1], s[2]); s.odd = !s.odd; s.shift(); } }
    else { if (s.length === 3) { this.gpuTri(s[0], s[1], s[2]); s.splice(1, 1); } }
  };
  // ----- recorte e rasterização -----
  const PLANES = [(p) => p[3] - 1e-5, (p) => p[3] - p[0], (p) => p[3] + p[0], (p) => p[3] - p[1], (p) => p[3] + p[1], (p) => -p[2], (p) => p[3] + p[2]];
  const lerpV = (a, b, t) => ({ quat: a.quat.map((x, i) => x + (b.quat[i] - x) * t), view: a.view.map((x, i) => x + (b.view[i] - x) * t), pos: a.pos.map((x, i) => x + (b.pos[i] - x) * t), col: a.col.map((x, i) => x + (b.col[i] - x) * t), tc0: a.tc0.map((x, i) => x + (b.tc0[i] - x) * t), tc1: a.tc1.map((x, i) => x + (b.tc1[i] - x) * t), tc2: a.tc2.map((x, i) => x + (b.tc2[i] - x) * t) });
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
    const V = [A, B, Cv], X = [0, 0, 0], Y = [0, 0, 0], Z = [0, 0, 0], IW = [0, 0, 0];
    for (let i = 0; i < 3; i++) { const p = V[i].pos, iw = 1 / p[3]; X[i] = (p[0] * iw + 1) * hw + vx; Y[i] = (p[1] * iw + 1) * hh + vy; Z[i] = p[2] * iw * zs + zo; IW[i] = iw; }
    const area = (X[1] - X[0]) * (Y[2] - Y[0]) - (Y[1] - Y[0]) * (X[2] - X[0]);
    if (area === 0 || area !== area) return;
    const cull = R[0x40] & 3; if ((cull === 1 && area < 0) || (cull === 2 && area > 0)) return;
    this.gpuStats.tris++;
    let x0 = Math.max(0, Math.floor(Math.min(X[0], X[1], X[2]))), x1 = Math.min(T.w - 1, Math.ceil(Math.max(X[0], X[1], X[2])));
    let y0 = Math.max(0, Math.floor(Math.min(Y[0], Y[1], Y[2]))), y1 = Math.min(T.h - 1, Math.ceil(Math.max(Y[0], Y[1], Y[2])));
    if (R[0x65] & 3) { x0 = Math.max(x0, R[0x66] & 0x3FF); y0 = Math.max(y0, (R[0x66] >>> 16) & 0x3FF); x1 = Math.min(x1, R[0x67] & 0x3FF); y1 = Math.min(y1, (R[0x67] >>> 16) & 0x3FF); }
    if (x0 > x1 || y0 > y1) return;
    const inv = 1 / area;
    // funções de borda lineares: w = A*x + B*y + C
    const A0 = (Y[1] - Y[2]) * inv, B0 = (X[2] - X[1]) * inv, C0 = (X[1] * Y[2] - Y[1] * X[2]) * inv;
    const A1 = (Y[2] - Y[0]) * inv, B1 = (X[0] - X[2]) * inv, C1 = (X[2] * Y[0] - Y[2] * X[0]) * inv;
    // atributos pré-multiplicados por 1/w (perspectiva)
    const texOn = R[0x80] & 7, lightOn = R[0x8F] & 1, tc2src = (R[0x80] >>> 13) & 1;
    const NV = 17, va = new Float64Array(NV * 3);
    for (let i = 0; i < 3; i++) { const v = V[i], o = i * NV, iw = IW[i];
      va[o] = v.col[0] * iw; va[o + 1] = v.col[1] * iw; va[o + 2] = v.col[2] * iw; va[o + 3] = v.col[3] * iw;
      va[o + 4] = v.tc0[0] * iw; va[o + 5] = v.tc0[1] * iw; va[o + 6] = v.tc1[0] * iw; va[o + 7] = v.tc1[1] * iw;
      const t2 = tc2src ? v.tc1 : v.tc2; va[o + 8] = t2[0] * iw; va[o + 9] = t2[1] * iw;
      if (lightOn) { va[o + 10] = v.quat[0] * iw; va[o + 11] = v.quat[1] * iw; va[o + 12] = v.quat[2] * iw; va[o + 13] = v.quat[3] * iw; va[o + 14] = v.view[0] * iw; va[o + 15] = v.view[1] * iw; va[o + 16] = v.view[2] * iw; } }
    const nv = lightOn ? 17 : 10, f = new Float64Array(17);
    // memória do alvo
    const cbpp = [4, 3, 2, 2, 2][T.cfmt] || 4, dbpp = [2, 2, 3, 4][T.dfmt], m = this.mem;
    const cv = m.view(T.color, T.w * T.h * cbpp), dv = T.depth ? m.view(T.depth, T.w * T.h * dbpp) : null;
    const rd8 = cv ? (a) => cv[a - T.color] : (a) => m.r8(a), wr8 = cv ? (a, v) => { cv[a - T.color] = v; } : (a, v) => m.w8(a, v);
    const dr8 = dv ? (a) => dv[a - T.depth] : (a) => m.r8(a), dw8 = dv ? (a, v) => { dv[a - T.depth] = v; } : (a, v) => m.w8(a, v);
    // estado de saída
    const dm = R[0x107], dtest = dm & 1, dfunc = (dm >>> 4) & 7, cmask = (dm >>> 8) & 15, dwrite = (dm >>> 12) & 1;
    const at = R[0x104], aOn = at & 1, aFunc = (at >>> 4) & 7, aRef = (at >>> 8) & 0xFF;
    const st = R[0x105], sOn = (st & 1) && T.dfmt === 3, sFunc = (st >>> 4) & 7, sWm = (st >>> 8) & 0xFF, sRef = (st >>> 16) & 0xFF, sIm = (st >>> 24) & 0xFF, so = R[0x106], sFail = so & 7, sZf = (so >>> 4) & 7, sZp = (so >>> 8) & 7;
    const blendOn = (R[0x100] >>> 8) & 1, bf = R[0x101], bc = R[0x103], cc = [(bc & 0xFF) / 255, ((bc >>> 8) & 0xFF) / 255, ((bc >>> 16) & 0xFF) / 255, (bc >>> 24) / 255];
    const fogOn = (R[0xE0] & 7) === 5, fogFlip = (R[0xE0] >>> 16) & 1, fc = R[0xE1], fogC = [(fc & 0xFF) / 255, ((fc >>> 8) & 0xFF) / 255, ((fc >>> 16) & 0xFF) / 255];
    const tex = [texOn & 1 ? this.gpuTex(0) : null, texOn & 2 ? this.gpuTex(1) : null, texOn & 4 ? this.gpuTex(2) : null];
    const dmax = T.dfmt === 0 ? 65535 : 16777215;
    const cmpf = (fn, a, b) => fn === 0 ? false : fn === 1 ? true : fn === 2 ? a === b : fn === 3 ? a !== b : fn === 4 ? a < b : fn === 5 ? a <= b : fn === 6 ? a > b : a >= b;
    const sop = (op, v) => { switch (op) { case 0: return v; case 1: return 0; case 2: return sRef; case 3: return v < 255 ? v + 1 : 255; case 4: return v > 0 ? v - 1 : 0; case 5: return ~v & 255; case 6: return (v + 1) & 255; default: return (v - 1) & 255; } };
    const tev = this.gpuTevSetup(), col = new Float64Array(4), tx = [new Float64Array([0, 0, 0, 1]), new Float64Array([0, 0, 0, 1]), new Float64Array([0, 0, 0, 1])], dst = new Float64Array(4);
    let px = 0;
    for (let y = y0; y <= y1; y++) {
      const py = y + 0.5, fy = T.h - 1 - y;
      let w0 = A0 * (x0 + 0.5) + B0 * py + C0, w1 = A1 * (x0 + 0.5) + B1 * py + C1;
      for (let x = x0; x <= x1; x++, w0 += A0, w1 += A1) {
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const off = morton[((fy & 7) << 3) | (x & 7)] + (x >> 3) * 64 + (fy >> 3) * T.w * 8;
        const z = w0 * Z[0] + w1 * Z[1] + w2 * Z[2], zi = z <= 0 ? 0 : z >= 1 ? dmax : Math.round(z * dmax);
        const da = T.depth + off * dbpp;
        let stv = 0;
        if (sOn) stv = dr8(da + 3);
        if (sOn && !cmpf(sFunc, sRef & sIm, stv & sIm)) { const nv2 = sop(sFail, stv); dw8(da + 3, (stv & ~sWm) | (nv2 & sWm)); continue; }
        if (dtest && T.depth) {
          const old = dbpp === 2 ? (dr8(da) | (dr8(da + 1) << 8)) : (dr8(da) | (dr8(da + 1) << 8) | (dr8(da + 2) << 16));
          if (!cmpf(dfunc, zi, old)) { if (sOn) { const nv2 = sop(sZf, stv); dw8(da + 3, (stv & ~sWm) | (nv2 & sWm)); } continue; }
        }
        // atributos com perspectiva
        const q = 1 / (w0 * IW[0] + w1 * IW[1] + w2 * IW[2]);
        for (let k = 0; k < nv; k++) f[k] = (w0 * va[k] + w1 * va[NV + k] + w2 * va[2 * NV + k]) * q;
        col[0] = f[0]; col[1] = f[1]; col[2] = f[2]; col[3] = f[3];
        for (let u = 0; u < 3; u++) if (tex[u]) this.gpuSampleInto(tex[u], f[4 + u * 2], f[5 + u * 2], tx[u]);
        const lit = lightOn ? this.gpuLight([f[10], f[11], f[12], f[13]], [f[14], f[15], f[16]]) : null;
        const fr = this.gpuTevRun(tev, col, tx, lit);
        if (fogOn && this.fogLut) { const d = fogFlip ? 1 - z : z, fi = Math.max(0, Math.min(127.999, d * 128)), k = fi | 0, e = this.fogLut[k], val = ((e >>> 13) & 0x7FF) / 2048, dif = ((e & 0x1FFF) << 19 >> 19) / 2048, fac = Math.max(0, Math.min(1, val + dif * (fi - k))); for (let c = 0; c < 3; c++) fr[c] = fr[c] * fac + fogC[c] * (1 - fac); }
        if (aOn && !cmpf(aFunc, Math.round(fr[3] * 255), aRef)) continue;
        if (sOn) { const nv2 = sop(sZp, stv); dw8(da + 3, (stv & ~sWm) | (nv2 & sWm)); }
        const ca = T.color + off * cbpp;
        if (blendOn || cmask !== 15) {
          if (T.cfmt === 0) { dst[3] = rd8(ca) / 255; dst[2] = rd8(ca + 1) / 255; dst[1] = rd8(ca + 2) / 255; dst[0] = rd8(ca + 3) / 255; }
          else { const o = this.readPx(ca, T.cfmt); dst[0] = o[0] / 255; dst[1] = o[1] / 255; dst[2] = o[2] / 255; dst[3] = o[3] / 255; }
        }
        if (blendOn) {
          const fac = (fn, i) => { switch (fn) { case 0: return 0; case 1: return 1; case 2: return fr[i]; case 3: return 1 - fr[i]; case 4: return dst[i]; case 5: return 1 - dst[i]; case 6: return fr[3]; case 7: return 1 - fr[3]; case 8: return dst[3]; case 9: return 1 - dst[3]; case 10: return cc[i]; case 11: return 1 - cc[i]; case 12: return cc[3]; case 13: return 1 - cc[3]; default: return i === 3 ? 1 : Math.min(fr[3], 1 - dst[3]); } };
          for (let i = 0; i < 4; i++) {
            const rgb = i < 3, s = fr[i] * fac(rgb ? (bf >>> 16) & 15 : (bf >>> 24) & 15, i), d = dst[i] * fac(rgb ? (bf >>> 20) & 15 : (bf >>> 28) & 15, i), e = rgb ? bf & 7 : (bf >>> 8) & 7;
            const r = e === 0 ? s + d : e === 1 ? s - d : e === 2 ? d - s : e === 3 ? Math.min(fr[i], dst[i]) : Math.max(fr[i], dst[i]);
            fr[i] = r < 0 ? 0 : r > 1 ? 1 : r;
          }
        }
        if (cmask !== 15) for (let i = 0; i < 4; i++) if (!(cmask & (1 << i))) fr[i] = dst[i];
        if (cmask) {
          if (T.cfmt === 0) { wr8(ca, Math.round(fr[3] * 255)); wr8(ca + 1, Math.round(fr[2] * 255)); wr8(ca + 2, Math.round(fr[1] * 255)); wr8(ca + 3, Math.round(fr[0] * 255)); }
          else if (T.cfmt === 1) { wr8(ca, Math.round(fr[2] * 255)); wr8(ca + 1, Math.round(fr[1] * 255)); wr8(ca + 2, Math.round(fr[0] * 255)); }
          else this.writePx(ca, T.cfmt, [Math.round(fr[0] * 255), Math.round(fr[1] * 255), Math.round(fr[2] * 255), Math.round(fr[3] * 255)]);
        }
        if (dwrite && T.depth) { dw8(da, zi & 255); dw8(da + 1, (zi >>> 8) & 255); if (dbpp > 2) dw8(da + 2, (zi >>> 16) & 255); }
        px++;
      }
    }
    this.gpuStats.px += px;
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
  // ----- combinadores (TEV), versão rápida: configuração decodificada uma vez por triângulo -----
  P.gpuTevSetup = function () {
    const R = this.pr, base = [0xC0, 0xC8, 0xD0, 0xD8, 0xF0, 0xF8], st = [];
    for (let i = 0; i < 6; i++) {
      const b = base[i], src = R[b], op = R[b + 1], cmb = R[b + 2], k = R[b + 3], sc = R[b + 4];
      const pass = (src & 0xF) === 15 && ((src >>> 16) & 15) === 15 && (op & 0xF) === 0 && ((op >>> 12) & 7) === 0 && (cmb & 0xF000F) === 0 && (sc & 0x30003) === 0;
      st.push({ pass, s: [src & 15, (src >>> 4) & 15, (src >>> 8) & 15, (src >>> 16) & 15, (src >>> 20) & 15, (src >>> 24) & 15], o: [op & 15, (op >>> 4) & 15, (op >>> 8) & 15, (op >>> 12) & 7, (op >>> 16) & 7, (op >>> 20) & 7],
        cm: cmb & 15, am: (cmb >>> 16) & 15, rs: [1, 2, 4, 1][sc & 3], as: [1, 2, 4, 1][(sc >>> 16) & 3], k: [(k & 0xFF) / 255, ((k >>> 8) & 0xFF) / 255, ((k >>> 16) & 0xFF) / 255, (k >>> 24) / 255] });
    }
    const fb = R[0xFD];
    return { st, cfg: R[0xE0], buf0: [(fb & 0xFF) / 255, ((fb >>> 8) & 0xFF) / 255, ((fb >>> 16) & 0xFF) / 255, (fb >>> 24) / 255], prev: new Float64Array(4), buf: new Float64Array(4), nb: new Float64Array(4), a: new Float64Array(9), aa: new Float64Array(3), out: new Float64Array(4), zero: [0, 0, 0, 0] };
  };
  P.gpuTevRun = function (t, prim, tex, lit) {
    const prev = t.prev, buf = t.buf, a = t.a, aa = t.aa, out = t.out, fp = lit ? lit[0] : t.zero, fs = lit ? lit[1] : t.zero;
    prev[0] = prim[0]; prev[1] = prim[1]; prev[2] = prim[2]; prev[3] = prim[3];
    buf[0] = t.buf0[0]; buf[1] = t.buf0[1]; buf[2] = t.buf0[2]; buf[3] = t.buf0[3];
    for (let i = 0; i < 6; i++) {
      const S = t.st[i];
      if (i >= 1 && i <= 4) { if (t.cfg & (0x100 << (i - 1))) { buf[0] = t.nb[0]; buf[1] = t.nb[1]; buf[2] = t.nb[2]; } if (t.cfg & (0x1000 << (i - 1))) buf[3] = t.nb[3]; }
      if (S.pass) { t.nb[0] = prev[0]; t.nb[1] = prev[1]; t.nb[2] = prev[2]; t.nb[3] = prev[3]; continue; }
      for (let j = 0; j < 3; j++) {
        const sid = S.s[j], c = sid === 0 ? prim : sid === 1 ? fp : sid === 2 ? fs : sid === 3 ? tex[0] : sid === 4 ? tex[1] : sid === 5 || sid === 6 ? tex[2] : sid === 13 ? buf : sid === 14 ? S.k : prev;
        let r, g, b; switch (S.o[j]) { case 1: r = 1 - c[0]; g = 1 - c[1]; b = 1 - c[2]; break; case 2: r = g = b = c[3]; break; case 3: r = g = b = 1 - c[3]; break; case 4: r = g = b = c[0]; break; case 5: r = g = b = 1 - c[0]; break; case 8: r = g = b = c[1]; break; case 9: r = g = b = 1 - c[1]; break; case 12: r = g = b = c[2]; break; case 13: r = g = b = 1 - c[2]; break; default: r = c[0]; g = c[1]; b = c[2]; }
        a[j * 3] = r; a[j * 3 + 1] = g; a[j * 3 + 2] = b;
        const sa = S.s[3 + j], ca = sa === 0 ? prim : sa === 1 ? fp : sa === 2 ? fs : sa === 3 ? tex[0] : sa === 4 ? tex[1] : sa === 5 || sa === 6 ? tex[2] : sa === 13 ? buf : sa === 14 ? S.k : prev, ao = S.o[3 + j];
        aa[j] = ao === 0 ? ca[3] : ao === 1 ? 1 - ca[3] : ao === 2 ? ca[0] : ao === 3 ? 1 - ca[0] : ao === 4 ? ca[1] : ao === 5 ? 1 - ca[1] : ao === 6 ? ca[2] : 1 - ca[2];
      }
      const cm = S.cm;
      for (let k = 0; k < 3; k++) {
        const x = a[k], y = a[3 + k], z = a[6 + k];
        let v; switch (cm) { case 1: v = x * y; break; case 2: v = x + y; break; case 3: v = x + y - 0.5; break; case 4: v = x * z + y * (1 - z); break; case 5: v = x - y; break; case 6: case 7: v = 4 * ((a[0] - 0.5) * (a[3] - 0.5) + (a[1] - 0.5) * (a[4] - 0.5) + (a[2] - 0.5) * (a[5] - 0.5)); break; case 8: v = x * y + z; break; case 9: v = (x + y) * z; break; default: v = x; }
        v *= S.rs; out[k] = v < 0 ? 0 : v > 1 ? 1 : v;
      }
      let av; const x = aa[0], y = aa[1], z = aa[2];
      if (cm === 7) av = out[0]; else switch (S.am) { case 1: av = x * y; break; case 2: av = x + y; break; case 3: av = x + y - 0.5; break; case 4: av = x * z + y * (1 - z); break; case 5: av = x - y; break; case 8: av = x * y + z; break; case 9: av = (x + y) * z; break; default: av = x; }
      av *= S.as; out[3] = av < 0 ? 0 : av > 1 ? 1 : av;
      t.nb[0] = out[0]; t.nb[1] = out[1]; t.nb[2] = out[2]; t.nb[3] = out[3];
      prev[0] = out[0]; prev[1] = out[1]; prev[2] = out[2]; prev[3] = out[3];
    }
    return prev;
  };
  P.gpuSampleInto = function (t, s, tt, o) {
    let x = Math.floor(s * t.w), y = Math.floor((1 - tt) * t.h);
    const wrap = (v, n, mode) => { if (mode === 2 || mode === 3) { const k = Math.floor(v / n); v -= k * n; return mode === 3 && (k & 1) ? n - 1 - v : v; } if (mode === 1) return v < 0 || v >= n ? -1 : v; return v < 0 ? 0 : v >= n ? n - 1 : v; };
    if (x < 0 || x >= t.w || t.ws) x = wrap(x, t.w, t.ws); if (y < 0 || y >= t.h || t.wt) y = wrap(y, t.h, t.wt);
    const c = x < 0 || y < 0 ? t.border : t.px[y * t.w + x];
    o[0] = (c & 0xFF) / 255; o[1] = ((c >>> 8) & 0xFF) / 255; o[2] = ((c >>> 16) & 0xFF) / 255; o[3] = (c >>> 24) / 255;
  };
  // ----- iluminação por fragmento -----
  const F16 = (v) => { v &= 0xFFFF; const s = v >> 15, e = (v >> 10) & 31, m = v & 1023; let f = e === 0 ? m / 1024 * Math.pow(2, -14) : (1 + m / 1024) * Math.pow(2, e - 15); return s ? -f : f; };
  const C10 = (v) => [((v >>> 20) & 0xFF) / 255, ((v >>> 10) & 0xFF) / 255, (v & 0xFF) / 255];
  const norm = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  P.gpuLut = function (lut, x, absOn) {
    if (!this.luts) return 1;
    let idx, frac;
    if (absOn) { x = Math.min(1, Math.abs(x)); const f = x * 255; idx = Math.min(255, Math.floor(f)); frac = f - idx; }
    else { x = Math.max(-1, Math.min(1, x)); const f = x * 127; idx = Math.floor(f) & 0xFF; frac = f - Math.floor(f); }
    const e = this.luts[lut * 256 + idx], val = (e & 0xFFF) / 4096, delta = (((e >>> 12) & 0xFFF) << 20 >> 20) / 2048;
    return val + delta * frac;
  };
  P.gpuLight = function (q, view) {
    const R = this.pr, n = (R[0x1C2] & 7) + 1, cfg1 = R[0x1C4], absCfg = R[0x1D0], inSel = R[0x1D1], scaleCfg = R[0x1D2];
    const ql = Math.hypot(q[0], q[1], q[2], q[3]) || 1, qq = q.map((x) => x / ql), qv = [qq[0], qq[1], qq[2]], z = [0, 0, 1];
    const t = cross(qv, z).map((x, i) => x + qq[3] * z[i]), N = norm(cross(qv, t).map((x, i) => z[i] + 2 * x));
    const V = norm(view), amb = C10(R[0x1C0]);
    const prim = amb.slice(), sec = [0, 0, 0];
    const scl = (k) => [1, 2, 4, 8, 1, 1, 0.25, 0.5][(scaleCfg >>> (k * 4)) & 7];
    const lutIn = (k, L, H) => { const s = (inSel >>> (k * 4)) & 7; return s === 0 ? dot(N, H) : s === 1 ? dot(V, H) : s === 2 ? dot(N, V) : s === 3 ? dot(L, N) : 1; };
    for (let i = 0; i < n; i++) {
      const id = (R[0x1D9] >>> (i * 4)) & 7, b = 0x140 + id * 0x10;
      const pos = [F16(R[b + 4]), F16(R[b + 4] >>> 16), F16(R[b + 5])], dir = (R[b + 9] & 1) !== 0;
      const L = norm(dir ? pos : [pos[0] + view[0], pos[1] + view[1], pos[2] + view[2]]), H = norm([L[0] + V[0], L[1] + V[1], L[2] + V[2]]);
      const dl = Math.max(0, dot(L, N)), la = C10(R[b + 3]), ld = C10(R[b + 2]), s0 = C10(R[b]), s1 = C10(R[b + 1]);
      const d0 = cfg1 & 0x10000 ? 1 : this.gpuLut(0, lutIn(0, L, H), !(absCfg & 2)) * scl(0);
      const d1 = cfg1 & 0x20000 ? 1 : this.gpuLut(1, lutIn(1, L, H), !(absCfg & 0x20)) * scl(1);
      for (let c = 0; c < 3; c++) { prim[c] += la[c] + ld[c] * dl; sec[c] += (s0[c] * d0 + s1[c] * d1) * (dl > 0 ? 1 : 0); }
    }
    const cl = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
    return [[cl(prim[0]), cl(prim[1]), cl(prim[2]), 1], [cl(sec[0]), cl(sec[1]), cl(sec[2]), 1]];
  };
  // ----- combinadores de textura (TEV) -----
  P.gpuTev = function (prim, tex, lit) {
    const R = this.pr, base = [0xC0, 0xC8, 0xD0, 0xD8, 0xF0, 0xF8], bufCfg = R[0xE0];
    let prev = prim.slice(), buf = [(R[0xFD] & 0xFF) / 255, ((R[0xFD] >>> 8) & 0xFF) / 255, ((R[0xFD] >>> 16) & 0xFF) / 255, (R[0xFD] >>> 24) / 255];
    const fragPrim = lit ? lit[0] : [0, 0, 0, 0], fragSec = lit ? lit[1] : [0, 0, 0, 0];
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
