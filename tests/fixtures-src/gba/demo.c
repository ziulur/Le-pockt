typedef unsigned int u32; typedef int s32; typedef unsigned short u16; typedef short s16; typedef unsigned char u8; typedef signed char s8;
#define REG16(a) (*(volatile u16 *)(0x04000000 + (a)))
#define REG32(a) (*(volatile u32 *)(0x04000000 + (a)))
#define VRAM ((volatile u16 *)0x06000000)
#define PAL ((volatile u16 *)0x05000000)
#define OAM ((volatile u16 *)0x07000000)
#define RGB(r, g, b) ((r) | ((g) << 5) | ((b) << 10))
void swi_vblank(void); void swi_objaff(const void *, void *, u32, u32); void swi_bgaff(const void *, void *, u32);
volatile u32 frames;
void isr(void) { u16 f = REG16(0x202); if (f & 1) frames++; REG16(0x202) = f; *(volatile u16 *)0x03007FF8 |= f; }
static s8 *const wave = (s8 *)0x02010000;
static void tile4(u32 base, u32 n, u32 (*px)(u32, u32)) {
  volatile u32 *t = (volatile u32 *)(base + n * 32); u32 y, x;
  for (y = 0; y < 8; y++) { u32 row = 0; for (x = 0; x < 8; x++) row |= (px(x, y) & 15) << (x * 4); t[y] = row; }
}
static u32 p_check(u32 x, u32 y) { return ((x >> 2) ^ (y >> 2)) & 1 ? 1 : 2; }
static u32 p_solid(u32 x, u32 y) { return 3; }
static u32 p_stripe(u32 x, u32 y) { return y < 2 ? 4 : (x == 0 ? 4 : 0); }
static u32 p_dots(u32 x, u32 y) { return ((x & 3) == 1 && (y & 3) == 1) ? 5 : 0; }
static void scene0(void) {
  u32 i, x, y;
  REG16(0x000) = 0x0000 | 0x0100 | 0x0200 | 0x1000 | 0x0040 | 0x2000; /* modo 0, BG0, BG1, OBJ, 1D, WIN0 */
  PAL[0] = RGB(2, 3, 8); PAL[1] = RGB(6, 10, 20); PAL[2] = RGB(4, 7, 15); PAL[3] = RGB(31, 20, 4); PAL[4] = RGB(31, 31, 31); PAL[5] = RGB(31, 8, 16);
  PAL[17] = RGB(4, 16, 10); PAL[18] = RGB(3, 12, 8);
  tile4(0x06000000, 1, p_check); tile4(0x06000000, 2, p_solid); tile4(0x06000000, 3, p_stripe); tile4(0x06000000, 4, p_dots);
  for (y = 0; y < 32; y++) for (x = 0; x < 32; x++) VRAM[0x4000 / 2 * 2 / 2 + 0 + (0x4000 >> 1) - (0x4000 >> 1) + ((0x4000 + (y * 32 + x) * 2) >> 1) - (0x4000 >> 1)] = 0; /* limpa */
  for (y = 0; y < 32; y++) for (x = 0; x < 32; x++) VRAM[(0x4000 >> 1) + y * 32 + x] = 1 | ((((x >> 2) + (y >> 2)) & 1) << 12);
  for (y = 0; y < 32; y++) for (x = 0; x < 32; x++) VRAM[(0x4800 >> 1) + y * 32 + x] = y < 2 ? 2 : (y == 2 ? 3 : (y > 16 ? 4 : 0));
  REG16(0x008) = 1 | (8 << 8);            /* BG0: prio 1, mapa em 0x4000 */
  REG16(0x00A) = 0 | (9 << 8);            /* BG1: prio 0, mapa em 0x4800 */
  /* sprites: paleta 0 = bola, paleta 1 = quadrado */
  PAL[256 + 1] = RGB(31, 28, 6); PAL[256 + 2] = RGB(28, 14, 2); PAL[256 + 17] = RGB(8, 30, 28); PAL[256 + 33] = RGB(31, 6, 12); PAL[256 + 34] = RGB(31, 31, 31);
  { volatile u8 *o = (volatile u8 *)0x06010000;
    for (i = 0; i < 4; i++) for (y = 0; y < 8; y++) for (x = 0; x < 8; x += 2) {
      u32 gx = (i & 1) * 8 + x, gy = (i >> 1) * 8 + y, c0, c1; s32 dx, dy;
      dx = (s32)gx * 2 - 15; dy = (s32)gy * 2 - 15; c0 = dx * dx + dy * dy < 225 ? (dx * dx + dy * dy < 80 ? 1 : 2) : 0;
      dx += 2; c1 = dx * dx + dy * dy < 225 ? (dx * dx + dy * dy < 80 ? 1 : 2) : 0;
      o[i * 32 + y * 4 + x / 2] = c0 | (c1 << 4);
    }
    for (i = 0; i < 16 * 32; i++) o[4 * 32 + i] = 0x11;                  /* 32x32 cheio */
    for (i = 0; i < 16; i++) for (y = 0; y < 8; y++) for (x = 0; x < 4; x++) { u32 ty = (i >> 2) * 8 + y, tx = (i & 3) * 8 + x * 2; o[20 * 32 + i * 32 + y * 4 + x] = (ty < 4 || ty > 27 || tx < 4 || tx > 27) ? 0x22 : (((tx + ty) >> 3) & 1 ? 0x11 : 0); }
  }
  for (i = 0; i < 128; i++) OAM[i * 4] = 0x0200;
  OAM[4] = 40 | 0x0400; OAM[5] = 150 | 0x8000; OAM[6] = 4 | (1 << 12);           /* semi-transparente 32x32 */
  OAM[8] = 90 | 0x0100; OAM[9] = 30 | 0x8000; OAM[10] = 20 | (2 << 12);          /* afim 32x32 */
  REG16(0x050) = 0x0081 | 0x0100; REG16(0x052) = 8 | (8 << 8); REG16(0x054) = 10; /* brilho no BG0; alvo 2 = BG0 */
  REG16(0x040) = (180 << 8) | 232; REG16(0x044) = (100 << 8) | 152; REG16(0x048) = 0x3F; REG16(0x04A) = 0x1F;
}
static void scene1(void) { u32 x, y; REG16(0x000) = 3 | 0x0400; for (y = 0; y < 160; y++) for (x = 0; x < 240; x++) VRAM[y * 240 + x] = RGB(x >> 3, y >> 3, (x + y) >> 4); }
static void scene2(void) {
  u32 x, y; volatile u8 *v = (volatile u8 *)0x06000000;
  REG16(0x000) = 4 | 0x0400;
  for (x = 0; x < 256; x++) PAL[x] = RGB(x & 31, (x >> 3) & 31, 31 - (x & 31));
  for (y = 0; y < 160; y++) for (x = 0; x < 240; x += 2) *(volatile u16 *)(0x06000000 + y * 240 + x) = ((x ^ y) & 0xFF) | ((((x + 1) ^ y) & 0xFF) << 8);
  (void)v;
}
static void scene3(void) {
  u32 x, y;
  REG16(0x000) = 1 | 0x0400;
  PAL[0] = RGB(1, 1, 4); PAL[1] = RGB(30, 30, 30); PAL[2] = RGB(30, 10, 4); PAL[3] = RGB(4, 20, 30);
  for (y = 0; y < 8; y++) for (x = 0; x < 8; x += 2) {
    *(volatile u16 *)(0x06000000 + 64 + y * 8 + x) = (x == 0 || y == 0) ? 0x0101 : 0x0202;
    *(volatile u16 *)(0x06000000 + 128 + y * 8 + x) = 0x0303;
  }
  for (y = 0; y < 16; y++) for (x = 0; x < 16; x += 2) *(volatile u16 *)(0x06004000 + y * 16 + x) = ((x ^ y) & 2) ? 0x0101 : 0x0201;
  REG16(0x00C) = (8 << 8) | 0x2000;       /* BG2 afim 128x128 com repetição */
}
int main(void) {
  u32 scene = 0, last = 0, bd = 0; s32 bx = 112, by = 72; u32 i;
  *(volatile u32 *)0x03007FFC = (u32)isr;
  REG16(0x004) = 8; REG16(0x200) = 1; REG16(0x208) = 1;
  for (i = 0; i < 16384; i++) { s32 p = (s32)(i & 63) - 32; s32 v = (p * (32 - (p < 0 ? -p : p))) >> 1; wave[i] = (s8)(v > 127 ? 127 : v < -127 ? -127 : v); }
  REG16(0x084) = 0x80; REG16(0x080) = 0xFF77; REG16(0x082) = 0x0B0E;
  scene0();
  for (;;) {
    u32 keys, pressed;
    swi_vblank();
    keys = ~REG16(0x130) & 0x3FF; pressed = keys & ~last; last = keys;
    if (pressed & 8) { scene = (scene + 1) & 3; if (scene == 0) scene0(); else if (scene == 1) scene1(); else if (scene == 2) scene2(); else scene3(); }
    if (pressed & 1) { REG16(0x062) = 0xF780; REG16(0x064) = 0x8000 | 1750; }                 /* A: bipe */
    if (pressed & 2) { REG16(0x0C6) = 0; REG16(0x102) = 0; REG32(0xBC) = (u32)wave; REG32(0xC0) = 0x040000A0; REG16(0x0C6) = 0xB640; REG16(0x100) = 65536 - 1024; REG16(0x102) = 0x80; } /* B: som direto */
    if (pressed & 0x200) { bd = (bd + 5) & 31; PAL[0] = RGB(bd, 3, 8); }
    if (pressed & 0x100) { bd = (bd + 27) & 31; PAL[0] = RGB(2, bd, 8); }
    if (scene == 0) {
      if (keys & 0x10) bx += 2; if (keys & 0x20) bx -= 2; if (keys & 0x40) by -= 2; if (keys & 0x80) by += 2;
      OAM[0] = (by & 0xFF); OAM[1] = (bx & 0x1FF) | 0x4000; OAM[2] = 0;
      REG16(0x010) = frames >> 1; REG16(0x012) = frames >> 2;
      { s16 src[4]; src[0] = 0x100; src[1] = 0x100; src[2] = (u16)(frames << 9); src[3] = 0; swi_objaff(src, (void *)0x07000006, 1, 8); }
    } else if (scene == 3) {
      struct { s32 cx, cy; s16 dx, dy, sx, sy; u16 th; u16 pad; } s; struct { s16 pa, pb, pc, pd; s32 x, y; } d;
      s.cx = 64 << 8; s.cy = 64 << 8; s.dx = 120; s.dy = 80; s.sx = 0x100 + ((frames & 127) << 1); s.sy = s.sx; s.th = (u16)(frames << 8); s.pad = 0;
      swi_bgaff(&s, &d, 1);
      REG16(0x020) = d.pa; REG16(0x022) = d.pb; REG16(0x024) = d.pc; REG16(0x026) = d.pd; REG32(0x028) = d.x; REG32(0x02C) = d.y;
    } else if (scene == 2) REG16(0x000) = 4 | 0x0400;
  }
}
