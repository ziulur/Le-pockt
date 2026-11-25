// Programa de teste próprio do LE Pocket 3DS (homebrew .3dsx, sem libctru).
// Faz o caminho que os programas de 3DS fazem: srv -> gsp::Gpu e hid:USER, memória linear,
// thread extra com arbitragem de endereço, conta em ponto flutuante (VFP), desenha nas duas telas
// e apresenta pelo GSP, esperando o VBlank pela fila de interrupções.
#include "common.h"
static void worker(u32 arg) {
  for (int i = 0; i < 5; i++) { counter += arg; SVC(0x0A, 1000000, 0, 0, 0, 0); }
  SVC(0x22, 0, (u32)&counter, 0, (u32)-1, 0); // acorda quem espera
  SVC(0x09, 0, 0, 0, 0, 0);
}
static u32 stack2[1024];
static int popIrq(void) {
  volatile u8 *q = (volatile u8*)gspMem; u8 cur = q[0], cnt = q[1]; if (!cnt) return -1;
  int e = q[0xC + cur]; cur++; if (cur >= 0x34) cur -= 0x34; q[0] = cur; q[1] = cnt - 1; return e;
}
static void waitVblank(void) {
  for (;;) { SVC(0x24, gspEv, 0, 0xFFFFFFFF, 0x7FFFFFFF, 0); SVC(0x19, gspEv, 0, 0, 0, 0); int e, got = 0; while ((e = popIrq()) >= 0) if (e == 2) got = 1; if (got) return; }
}
static void present(int scr, u8 *fb) {
  volatile u32 *h = (volatile u32*)((u8*)gspMem + 0x200 + scr * 0x40); u32 idx = ((*h & 0xFF) + 1) & 1;
  volatile u32 *fi = h + 1 + idx * 7; fi[0] = idx; fi[1] = (u32)fb; fi[2] = (u32)fb; fi[3] = 240 * 3; fi[4] = 1; fi[5] = idx; fi[6] = 0;
  *h = idx | 0x100;
}
int main(void) {
  status[0] = 1;
  SVC(0x2D, 0, (u32)"srv:", 0, 0, &srv);
  { u32 *c = TLS() + 0x20; c[0] = 0x00010002; c[1] = 0x20; ipc(srv); }
  gsp = getService("gsp::Gpu"); hid = getService("hid:USER"); status[1] = gsp && hid;
  SVC(0x17, 0, 0, 0, 0, &gspEv);
  { u32 *c = TLS() + 0x20; c[0] = 0x00130042; c[1] = 1; c[2] = 0; c[3] = gspEv; ipc(gsp); gspMemH = c[4]; }
  SVC(0x1F, gspMemH, 0x10002000, 3, 0x10000000, 0);
  { u32 *c = TLS() + 0x20; c[0] = 0x000A0000; ipc(hid); hidMemH = c[3]; }
  SVC(0x1F, hidMemH, 0x10000000, 1, 0x10000000, 0);
  u32 lin = 0; SVC(0x01, 0x10003, 0, 0, 400 * 240 * 3 + 320 * 240 * 3, &lin); status[2] = lin;
  u8 *top = (u8*)lin, *bot = top + 400 * 240 * 3;
  u32 th = 0; { register u32 r4 __asm__("r4") = 0; (void)r4; SVC(0x08, 0x30, (u32)worker, 3, (u32)&stack2[1024], &th); }
  // ponto flutuante
  float f = 0.0f; for (int i = 1; i <= 10; i++) f += 1.0f / (float)i; status[3] = (u32)(f * 1000.0f); // 2928
  double dd = 1.5; dd = dd * dd + 0.25; status[4] = (u32)(dd * 100.0); // 250
  for (u32 frame = 0;; frame++) {
    for (u32 x = 0; x < 400; x++) for (u32 y = 0; y < 240; y++) { u8 *p = top + (x * 240 + (239 - y)) * 3; float t = (float)x / 400.0f; p[2] = (u8)(t * 255.0f); p[1] = (u8)(y); p[0] = 64; }
    u32 keys = hidMem[14]; u32 touch = hidMem[52], tdown = hidMem[53];
    u8 r = (keys & 1) ? 255 : 0, g = tdown ? (u8)(touch & 0xFF) : 0, b = 200;
    for (u32 i = 0; i < 320 * 240; i++) { bot[i * 3] = b; bot[i * 3 + 1] = g; bot[i * 3 + 2] = r; }
    present(0, top); present(1, bot);
    status[5] = frame; status[6] = keys; status[7] = counter;
    waitVblank();
  }
}
void __attribute__((naked, section(".text.start"))) _start(void) { __asm__ volatile("ldr sp, =0x0FFFFF00\n bl main\n svc 0x03"); }
