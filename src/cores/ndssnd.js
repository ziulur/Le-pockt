// ===== Nintendo DS: som (16 canais: PCM8, PCM16, IMA-ADPCM, PSG e ruído) =====
function ndsSndInstall(N) {
  const IDX = [-1, -1, -1, -1, 2, 4, 6, 8];
  const STEP = [7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66, 73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449, 494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272, 2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493, 10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767];
  const SAMPLE = 33513982 / 32768; // ciclos do sistema por amostra de saída
  const DIV = [0, 1, 2, 4];
  const P = N.prototype;

  P.sndInit = function () {
    this.snd = Array.from({ length: 16 }, () => ({ on: false, pos: 0, frac: 0, cur: 0, total: 0, loop: 0, fmt: 0, rep: 0, sad: 0, pcm: 0, idx: 0, lPcm: 0, lIdx: 0, nib: -1, lfsr: 0x7FFF }));
    this.sndT = 0; this.audioBuf = new Float32Array(4096); this.audioLen = 0; this.audioRate = 32768;
    this.sHpXl = this.sHpXr = this.sHpYl = this.sHpYr = 0;
  };
  P.sndStart = function (ch) {
    const io = this.io[1], b = (0x400 + ch * 16) >> 2, cnt = io[b], s = this.snd[ch];
    s.on = true; s.fmt = (cnt >>> 29) & 3; s.rep = (cnt >>> 27) & 3; s.sad = io[b + 1] & 0x07FFFFFC; s.frac = 0; s.pos = 0;
    const pnt = io[b + 2] >>> 16, len = io[b + 3] & 0x3FFFFF, bytes = (pnt + len) * 4;
    if (s.fmt === 0) { s.total = bytes; s.loop = pnt * 4; }
    else if (s.fmt === 1) { s.total = bytes >> 1; s.loop = pnt * 2; }
    else if (s.fmt === 2) {
      const h = this.r32(1, s.sad); s.pcm = (h << 16) >> 16; s.idx = Math.min(88, (h >>> 16) & 0x7F);
      s.total = Math.max(0, (bytes - 4) * 2); s.loop = Math.max(0, (pnt * 4 - 4) * 2); s.nib = -1; s.lPcm = s.pcm; s.lIdx = s.idx;
    } else { s.total = Infinity; s.loop = 0; s.lfsr = 0x7FFF; }
    s.cur = this.sndFetch(ch, s, 0);
  };
  P.sndFetch = function (ch, s, pos) {
    switch (s.fmt) {
      case 0: return ((this.r8(1, s.sad + pos) << 24) >> 24) / 128;
      case 1: return ((this.r16(1, s.sad + pos * 2) << 16) >> 16) / 32768;
      case 2: {
        if (pos < s.nib) { s.pcm = s.lPcm; s.idx = s.lIdx; s.nib = s.loop - 1; } // voltou para o ponto de repetição
        while (s.nib < pos) {
          s.nib++;
          if (s.nib === s.loop) { s.lPcm = s.pcm; s.lIdx = s.idx; }
          const byte = this.r8(1, s.sad + 4 + (s.nib >> 1)), n = (s.nib & 1) ? byte >> 4 : byte & 15, st = STEP[s.idx];
          let d = st >> 3; if (n & 1) d += st >> 2; if (n & 2) d += st >> 1; if (n & 4) d += st;
          s.pcm += (n & 8) ? -d : d; if (s.pcm > 32767) s.pcm = 32767; else if (s.pcm < -32767) s.pcm = -32767;
          s.idx += IDX[n & 7]; if (s.idx < 0) s.idx = 0; else if (s.idx > 88) s.idx = 88;
        }
        return s.pcm / 32768;
      }
      default: {
        if (ch >= 14) return (s.lfsr & 1) ? -1 : 1;
        if (ch < 8) return 0;
        const duty = (this.io[1][(0x400 + ch * 16) >> 2] >>> 24) & 7;
        return duty === 7 ? -1 : ((pos & 7) <= duty ? 1 : -1) * 0.5;
      }
    }
  };
  P.sndRun = function (now) {
    const io = this.io[1], buf = this.audioBuf, snd = this.snd;
    while (this.sndT + SAMPLE <= now) {
      this.sndT += SAMPLE;
      const sc = io[0x500 >> 2], master = (sc & 0x8000) ? (sc & 0x7F) / 127 : 0;
      let L = 0, R = 0;
      for (let ch = 0; ch < 16; ch++) {
        const s = snd[ch]; if (!s.on) continue;
        const b = (0x400 + ch * 16) >> 2, cnt = io[b];
        if (!(cnt >>> 31)) { s.on = false; continue; }
        const tmr = io[b + 2] & 0xFFFF, period = 0x10000 - tmr;
        s.frac += (SAMPLE * 0.5) / period;
        if (s.frac >= 1) {
          const adv = s.frac | 0; s.frac -= adv;
          if (s.fmt === 3) {
            if (ch >= 14) for (let k = 0; k < adv; k++) { const c = s.lfsr & 1; s.lfsr >>= 1; if (c) s.lfsr ^= 0x6000; }
            s.pos += adv;
          } else {
            s.pos += adv;
            if (s.pos >= s.total) {
              if (s.rep === 2 || s.total <= s.loop) { s.on = false; io[b] = cnt & 0x7FFFFFFF; continue; }
              s.pos = s.loop + ((s.pos - s.loop) % (s.total - s.loop));
            }
          }
          s.cur = this.sndFetch(ch, s, s.pos);
        }
        let v = s.cur * (cnt & 0x7F) / 128;
        v /= [1, 2, 4, 16][(cnt >>> 8) & 3];
        const pan = (cnt >>> 16) & 0x7F;
        L += v * (128 - pan) / 128; R += v * pan / 128;
      }
      L *= master * 0.5; R *= master * 0.5;
      const yl = L - this.sHpXl + 0.999 * this.sHpYl, yr = R - this.sHpXr + 0.999 * this.sHpYr;
      this.sHpXl = L; this.sHpXr = R; this.sHpYl = yl; this.sHpYr = yr;
      if (this.audioLen < buf.length - 1) { buf[this.audioLen++] = yl > 0.98 ? 0.98 : yl < -0.98 ? -0.98 : yl; buf[this.audioLen++] = yr > 0.98 ? 0.98 : yr < -0.98 ? -0.98 : yr; }
    }
  };
  // escrita nos registradores de som do ARM7 (já gravada em io[1])
  P.sndWrite = function (o, old, nv) {
    if (o >= 0x400 && o < 0x500) {
      const ch = (o - 0x400) >> 4;
      if ((o & 0xF) !== 0) return;
      const was = old >>> 31, is = nv >>> 31;
      if (is && !was) this.sndStart(ch); else if (!is) this.snd[ch].on = false;
    } else if (o === 0x508) {
      // captura de som: termina na hora quando é de uma vez só (o jogo pode esperar o fim)
      let v = nv;
      if ((v & 0x80) && (v & 0x04)) v &= ~0x80;
      if ((v & 0x8000) && (v & 0x0400)) v &= ~0x8000;
      this.io[1][0x508 >> 2] = v >>> 0;
    }
  };
}
if (typeof module !== 'undefined') module.exports = ndsSndInstall; else ndsSndInstall(NDS);
