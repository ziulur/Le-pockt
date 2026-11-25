// Programa de teste próprio: lê os arquivos internos (romfs) pelo serviço fs:USER.
#include "common.h"
int main(void) {
  SVC(0x2D, 0, (u32)"srv:", 0, 0, &srv);
  { u32 *c = TLS() + 0x20; c[0] = 0x00010002; c[1] = 0x20; ipc(srv); }
  u32 fs = getService("fs:USER"); status[0] = fs != 0;
  static u32 zero[3]; static u8 buf[64];
  u32 *c = TLS() + 0x20;
  c[0] = 0x08030204; c[1] = 0; c[2] = 3; c[3] = 1; c[4] = 1; c[5] = 2; c[6] = 12; c[7] = 1; c[8] = 0;
  c[9] = (1 << 14) | 2; c[10] = (u32)""; c[11] = (12 << 14) | 2; c[12] = (u32)zero; ipc(fs);
  status[1] = c[1]; u32 fh = c[3];
  c[0] = 0x08040000; ipc(fh); status[2] = c[2];
  c[0] = 0x080200C2; c[1] = 0; c[2] = 0; c[3] = 16; c[4] = (16 << 4) | 0xC; c[5] = (u32)buf; ipc(fh);
  status[3] = c[2]; status[4] = buf[0] | (buf[1] << 8) | (buf[2] << 16) | (buf[3] << 24); status[5] = buf[4];
  for (;;) SVC(0x0A, 16000000, 0, 0, 0, 0);
}
void __attribute__((naked, section(".text.start"))) _start(void) { __asm__ volatile("ldr sp, =0x0FFFFF00\n bl main\n svc 0x03"); }
