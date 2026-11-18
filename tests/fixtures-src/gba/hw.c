typedef unsigned int u32; typedef int s32; typedef unsigned short u16; typedef short s16; typedef unsigned char u8; typedef signed char s8;
#define REG16(a) (*(volatile u16 *)(0x04000000 + (a)))
#define REG32(a) (*(volatile u32 *)(0x04000000 + (a)))
#define OUT ((volatile u32 *)0x02000000)
void edge_tests(u32 *out); s32 swi_div(s32, s32); u32 swi_sqrt(u32); void swi_vblank(void); void swi_cpuset(const void *, void *, u32); void swi_lz77(const void *, void *);
volatile u32 vbl, tmr;
void isr(void) {
  u16 f = REG16(0x202);
  if (f & 1) vbl++;
  if (f & 0x10) tmr++;
  REG16(0x202) = f;
  *(volatile u16 *)0x03007FF8 |= f;
}
static const u8 lz[] = { 0x10, 12, 0, 0, 0x08, 'A', 'B', 'C', 'D', 0x50, 0x03, 0, 0, 0, 0, 0 };
static u32 srcbuf[16], dstbuf[16]; static u8 lzout[16];
int main(void) {
  u32 i, n = 32;
  edge_tests((u32 *)(0x02000000 + 0x400));
  *(volatile u32 *)0x03007FFC = (u32)isr;
  REG16(0x004) = 8; REG16(0x200) = 1 | 0x10; REG16(0x208) = 1;
  OUT[n++] = (u32)swi_div(100, 7); OUT[n++] = (u32)swi_div(-100, 7); OUT[n++] = swi_sqrt(1000000);
  for (i = 0; i < 16; i++) srcbuf[i] = i * 0x01010101u;
  swi_cpuset(srcbuf, dstbuf, 16 | (1 << 26)); OUT[n++] = dstbuf[15] + dstbuf[1];
  swi_cpuset(&srcbuf[5], dstbuf, 8 | (1 << 26) | (1 << 24)); OUT[n++] = dstbuf[7] + dstbuf[8];
  swi_lz77(lz, lzout); OUT[n++] = lzout[0] | (lzout[5] << 8) | (lzout[10] << 16) | (lzout[11] << 24);
  for (i = 0; i < 5; i++) swi_vblank();
  OUT[n++] = vbl; OUT[n++] = REG16(0x006);
  REG16(0x100) = 0; REG16(0x102) = 0x81;           /* timer0 /64 */
  swi_vblank();
  OUT[n++] = REG16(0x100);
  REG16(0x102) = 0;
  REG16(0x104) = 0xFFFE; REG16(0x106) = 0xC4;       /* timer1 cascata + irq, estoura a cada 2 */
  REG16(0x100) = 0xFF00; REG16(0x102) = 0x80;       /* timer0 estoura a cada 256 ciclos */
  swi_vblank();
  REG16(0x102) = 0; REG16(0x106) = 0;
  OUT[n++] = tmr;
  for (i = 0; i < 16; i++) dstbuf[i] = 0;
  REG32(0xD4) = (u32)srcbuf; REG32(0xD8) = (u32)dstbuf; REG16(0xDC) = 16; REG16(0xDE) = 0x8400;
  OUT[n++] = dstbuf[9] + REG16(0xDE);
  REG32(0xD4) = (u32)&srcbuf[3]; REG32(0xD8) = (u32)dstbuf; REG16(0xDC) = 8; REG16(0xDE) = 0x8500;  /* fonte fixa */
  OUT[n++] = dstbuf[7] ^ dstbuf[8];
  *(volatile u8 *)0x0E000010 = 0x5A; OUT[n++] = *(volatile u8 *)0x0E000010;
  OUT[n++] = REG16(0x130);
  OUT[1] = 0xC0FFEE;
  for (;;) swi_vblank();
}
