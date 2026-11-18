typedef unsigned int u32; typedef unsigned short u16; typedef unsigned char u8;
#define R32(a) (*(volatile u32 *)(a))
#define R16(a) (*(volatile u16 *)(a))
void swi_vbl(void);
void isr(void) { u32 f = R32(0x04000214); R32(0x04000214) = f; R32(0x0380FFF8) |= f; }
static u32 spi(u32 dev, u32 v, u32 hold) { R16(0x040001C0) = 0x8000 | (dev << 8) | (hold ? 0x800 : 0); R16(0x040001C2) = v; return R16(0x040001C2) & 0xFF; }
static u32 tsc(u32 cmd) { u32 hi, lo; spi(2, cmd, 1); hi = spi(2, 0, 1); lo = spi(2, 0, 0); return (hi << 5) | (lo >> 3); }
int main(void) {
  u32 a, b;
  R32(0x0380FFFC) = (u32)isr; R16(0x04000004) = 8; R32(0x04000210) = 1; R32(0x04000208) = 1;
  R16(0x04000184) = 0x8008;
  spi(1, 3, 1); spi(1, 0x03, 1); spi(1, 0xFE, 1); spi(1, 0x58, 1); a = spi(1, 0, 1); b = spi(1, 0, 0);
  R32(0x04000188) = 0x80000000 | a | (b << 8);
  for (;;) {
    u32 pen = !(R16(0x04000136) & 0x40), x = tsc(0xD0), y = tsc(0x90);
    swi_vbl();
    R32(0x04000188) = (x >> 4) | ((y >> 4) << 8) | (pen << 16);
  }
}
