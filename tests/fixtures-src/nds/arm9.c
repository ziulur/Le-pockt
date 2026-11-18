typedef unsigned int u32; typedef int s32; typedef unsigned short u16; typedef unsigned char u8;
#define R32(a) (*(volatile u32 *)(a))
#define R16(a) (*(volatile u16 *)(a))
#define R8(a) (*(volatile u8 *)(a))
#define OUT ((volatile u32 *)0x02300000)
u32 run_tests(void); void swi_vbl(void); s32 swi_div(s32, s32); u32 thumb_fn(u32, u32);
volatile u32 vbl;
void isr(void) { u32 f = R32(0x04000214); if (f & 1) vbl++; R32(0x04000214) = f; R32(0x03003FF8) |= f; }
static void tile(u32 base, u32 n, u32 a, u32 b) { u32 y; for (y = 0; y < 8; y++) R32(base + n * 32 + y * 4) = (y & 4) ? a : b; }
int main(void) {
  u32 i, x, y, n = 2, last = 0;
  OUT[0] = run_tests();
  OUT[n++] = thumb_fn(40, 2);                                   /* 2: interworking -> 42*3 = 126 */
  R32(0x04000280) = 0; R32(0x04000290) = (u32)-100; R32(0x04000298) = 7; OUT[n++] = R32(0x040002A0); OUT[n++] = R32(0x040002A8); /* 3,4: -14, -2 */
  R32(0x040002B0) = 0; R32(0x040002B8) = 1000000; OUT[n++] = R32(0x040002B4);      /* 5: 1000 */
  OUT[n++] = (u32)swi_div(1000, 33);                                                /* 6: 30 */
  { u32 clz; __asm__("clz %0,%1" : "=r"(clz) : "r"(0x00010000)); OUT[n++] = clz; }     /* 7: 15 */
  R32(0x03003FFC) = (u32)isr; R16(0x04000004) = 8; R32(0x04000210) = 1; R32(0x04000208) = 1;
  for (i = 0; i < 3; i++) swi_vbl();
  OUT[n++] = vbl;                                                                   /* 8: 3 */
  /* cartucho: lê 0x200 bytes do endereço 0x8000 */
  R16(0x040001A0) = 0x8000; R32(0x040001A8) = 0x000000B7 | (0x80 << 24); R32(0x040001AC) = 0; R32(0x040001A4) = 0xA1000000;
  { u32 sum = 0, cnt = 0; while (R32(0x040001A4) & 0x80000000) { if (R32(0x040001A4) & 0x00800000) { sum += R32(0x04100010); cnt++; } } OUT[n++] = sum; OUT[n++] = cnt; } /* 9,10 */
  /* vídeo */
  R32(0x04000304) = 0x8203;
  R8(0x04000240) = 0x81; R8(0x04000241) = 0x82; R8(0x04000242) = 0x84;
  R16(0x05000000) = 0x4000 | (4 << 5); R16(0x05000002) = 0x7FFF; R16(0x05000004) = 0x03FF; R16(0x05000006) = 0x7C1F;
  tile(0x06000000, 1, 0x11111111, 0x22222222); tile(0x06000000, 2, 0x33333333, 0x30303030);
  for (y = 0; y < 32; y++) for (x = 0; x < 32; x++) R16(0x06000800 + (y * 32 + x) * 2) = ((x + y) & 3) == 0 ? 2 : (((x ^ y) & 1) ? 1 : 0);
  R16(0x04000008) = 1 << 8;
  R16(0x05000202) = 0x001F; R16(0x05000204) = 0x7FE0;
  for (i = 0; i < 8; i++) R32(0x06400000 + i * 4) = (i & 1) ? 0x12121212 : 0x21212121;
  for (i = 0; i < 128; i++) R16(0x07000000 + i * 8) = 0x0200;
  R16(0x07000000) = 60 | 0x0100 | 0x0200; R16(0x07000002) = 100; R16(0x07000004) = 0;       /* sprite afim 2x */
  R16(0x07000006) = 0x80; R16(0x0700000E) = 0; R16(0x07000016) = 0; R16(0x0700001E) = 0x80;
  R32(0x04000000) = 0x00011100;
  for (y = 0; y < 192; y++) for (x = 0; x < 256; x++) R16(0x06200000 + (y * 256 + x) * 2) = 0x8000 | (x >> 3) | ((y >> 3) << 5) | (((x + y) >> 4) << 10);
  R16(0x0400100C) = 0x4084; R16(0x04001020) = 0x100; R16(0x04001026) = 0x100;
  R32(0x04001000) = 0x00010405;
  R16(0x04000184) = 0x8008;
  OUT[1] = 0xC0FFEE;
  for (;;) {
    swi_vbl();
    while (!(R16(0x04000184) & 0x100)) { u32 v = R32(0x04100000); if (v >> 31) OUT[20] = v; else { last = v; OUT[21] = v; } }
    if (last & 0x10000) { x = last & 0xFF; y = (last >> 8) & 0xFF; for (i = 0; i < 9; i++) R16(0x06200000 + (((y + i / 3) % 192) * 256 + ((x + i % 3) & 255)) * 2) = 0xFFFF; }
    R16(0x04000010) = vbl >> 1;
    OUT[22] = R16(0x04000130) | (vbl << 16);
  }
}
