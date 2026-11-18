// Teste diferencial: o mesmo código roda nativo (x86) e no emulador; os hashes devem ser iguais.
typedef unsigned int u32; typedef int s32; typedef unsigned short u16; typedef short s16; typedef unsigned char u8; typedef signed char s8;
typedef unsigned long long u64; typedef long long s64;
static u32 seed = 0x12345678;
static u32 rnd(void) { seed ^= seed << 13; seed ^= seed >> 17; seed ^= seed << 5; return seed; }
static u32 h;
static void mix(u32 v) { h = (h ^ v) * 16777619u; h = (h << 7) | (h >> 25); }
static u32 rotr(u32 v, u32 n) { n &= 31; return n ? (v >> n) | (v << (32 - n)) : v; }
static s32 fib(s32 n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); }
static u8 buf8[256]; static u16 buf16[128]; static s16 sbuf[64]; static s8 sb8[64]; static u32 arr[64];
struct P { u8 a; u16 b; u32 c; s8 d; s16 e; };
static u32 op_add(u32 a, u32 b) { return a + b; }
static u32 op_xor(u32 a, u32 b) { return a ^ (b >> 3); }
static u32 op_mul(u32 a, u32 b) { return a * b + 7; }
static u32 op_sel(u32 a, u32 b) { return (s32)a < (s32)b ? a - b : b - a; }
typedef u32 (*fn2)(u32, u32);
static fn2 table[4] = { op_add, op_xor, op_mul, op_sel };
static u32 crc_table[256];
#ifndef NO64
static u32 t64(u32 a, u32 b, u32 c) {
  u64 x = (u64)a * b; s64 y = (s64)(s32)a * (s32)c;
  x += ((u64)c << 32) | a; y -= (s64)x >> 3;
  u64 z = x + (u64)y; z ^= z >> 29; z += (u64)b << 17; z = z * 0x9E3779B1u;
  if (x > (u64)y) z += 3; if ((s64)x < y) z -= 5;
  return (u32)z ^ (u32)(z >> 32) ^ (u32)(y >> 40);
}
#endif
u32 run_tests(void) {
  u32 i, j;
  h = 2166136261u;
  for (i = 0; i < 256; i++) { u32 c = i; for (j = 0; j < 8; j++) c = (c & 1) ? 0xEDB88320u ^ (c >> 1) : c >> 1; crc_table[i] = c; }
  for (i = 0; i < 6000; i++) {
    u32 a = rnd(), b = rnd(), c = rnd(); u32 s = b & 31;
    mix(a + b); mix(a - b); mix(a * b); mix(a & b); mix(a | ~b); mix(a ^ (b << 3));
    mix(a << s); mix(a >> s); mix((u32)((s32)a >> s)); mix(rotr(a, c));
    mix((s32)a < (s32)b); mix(a < b); mix((s32)a >= (s32)b ? a : b); mix(a > b ? a - b : b - a);
    mix((u32)(-(s32)a)); mix(~a + (b >> 31)); mix((a >> 1) + (b >> 1) + (a & b & 1));
    mix((u32)(s32)(s16)a); mix((u32)(s32)(s8)b); mix((u16)c * (u16)a); mix((u32)((s32)(s16)a * (s32)(s16)b));
    buf8[a & 255] = (u8)b; buf16[b & 127] = (u16)c; sbuf[c & 63] = (s16)a; sb8[a & 63] = (s8)c; arr[b & 63] += a;
    mix(buf8[b & 255]); mix(buf16[a & 127]); mix((u32)(s32)sbuf[a & 63]); mix((u32)(s32)sb8[b & 63]); mix(arr[c & 63]);
    mix(table[c & 3](a, b));
    { struct P p; p.a = (u8)a; p.b = (u16)b; p.c = c; p.d = (s8)(a >> 8); p.e = (s16)(b >> 4); struct P q = p; q.c += q.a + q.b; mix(q.c + (u32)(s32)q.d * (u32)(s32)q.e); }
    switch (a & 7) { case 0: mix(1); break; case 1: mix(b); break; case 2: mix(c + 1); break; case 3: mix(a >> 3); break; case 4: mix(b * 3); break; case 5: mix(c ^ a); break; case 6: mix(99); break; default: mix(a + b + c); }
    { u32 crc = ~0u; crc = crc_table[(crc ^ a) & 255] ^ (crc >> 8); crc = crc_table[(crc ^ (b >> 8)) & 255] ^ (crc >> 8); mix(crc); }
    { u32 x = a | 1, n = 0; while (!(x & 0x80000000u)) { x <<= 1; n++; } mix(n); }
    { u32 x = a, cnt = 0; while (x) { x &= x - 1; cnt++; } mix(cnt); }
    { u32 carry = (a + b) < a; u32 hi = c + c + carry; mix(hi); mix((a - b) > a); }
#ifndef NO64
    mix(t64(a, b, c));
#endif
  }
  for (i = 0; i < 64; i++) arr[i] = rnd() & 0xFFFF;
  for (i = 1; i < 64; i++) { u32 v = arr[i]; s32 k = (s32)i - 1; while (k >= 0 && arr[k] > v) { arr[k + 1] = arr[k]; k--; } arr[k + 1] = v; }
  for (i = 0; i < 64; i++) mix(arr[i]);
  mix((u32)fib(18));
  { u8 tmp[40]; u32 w; for (i = 0; i < 40; i++) tmp[i] = (u8)(i * 7 + 1);
    for (i = 0; i < 20; i++) { u8 *p = tmp + i; w = p[0] | (p[1] << 8) | (p[2] << 16) | ((u32)p[3] << 24); mix(w); } }
  return h;
}
#ifdef NATIVE
#include <stdio.h>
int main(void) { printf("%08x\n", run_tests()); return 0; }
#endif
