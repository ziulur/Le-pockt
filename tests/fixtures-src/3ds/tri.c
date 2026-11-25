// Programa de teste próprio: desenha um triângulo colorido com a GPU PICA200 (lista de comandos,
// shader de vértice, rasterização, combinador), copia com DisplayTransfer e apresenta pelo GSP.
#include "common.h"
static void initAll(void) {
  SVC(0x2D, 0, (u32)"srv:", 0, 0, &srv);
  { u32 *c = TLS() + 0x20; c[0] = 0x00010002; c[1] = 0x20; ipc(srv); }
  gsp = getService("gsp::Gpu");
  SVC(0x17, 0, 0, 0, 0, &gspEv);
  { u32 *c = TLS() + 0x20; c[0] = 0x00130042; c[1] = 1; c[2] = 0; c[3] = gspEv; ipc(gsp); gspMemH = c[4]; }
  SVC(0x1F, gspMemH, 0x10002000, 3, 0x10000000, 0);
}
static u32 f24(float f) { union { float f; u32 u; } x = { f }; u32 u = x.u; if (!(u & 0x7FFFFFFF)) return 0; u32 s = u >> 31, e = ((u >> 23) & 0xFF) - 127 + 63, m = (u >> 7) & 0xFFFF; return (s << 23) | (e << 16) | m; }
static u32 *cl; static u32 nCl;
static void W(u32 reg, u32 v) { cl[nCl++] = v; cl[nCl++] = reg | (0xF << 16); }
static u32 phys(void *p) { return (u32)p - 0x30000000 + 0x20000000; }
static void gx(u32 *cmd) {
  volatile u32 *q = (volatile u32*)((u8*)gspMem + 0x800); u32 h = q[0], idx = h & 0xFF, tot = (h >> 8) & 0xFF, n = (idx + tot) % 15;
  for (int i = 0; i < 8; i++) q[8 * (1 + n) + i] = cmd[i];
  q[0] = idx | ((tot + 1) << 8);
  u32 *c = TLS() + 0x20; c[0] = 0x000C0000; ipc(gsp);
}
static void present(int scr, u8 *fb) {
  volatile u32 *h = (volatile u32*)((u8*)gspMem + 0x200 + scr * 0x40); u32 idx = ((*h & 0xFF) + 1) & 1;
  volatile u32 *fi = h + 1 + idx * 7; fi[0] = idx; fi[1] = (u32)fb; fi[2] = (u32)fb; fi[3] = 240 * 3; fi[4] = 1; fi[5] = idx; fi[6] = 0;
  *h = idx | 0x100;
}
int main(void) {
  status[0] = 1; initAll();
  u32 lin = 0; SVC(0x01, 0x10003, 0, 0, 0x100000, &lin);
  u8 *colorBuf = (u8*)lin, *depthBuf = colorBuf + 240 * 400 * 4, *fb = depthBuf + 240 * 400 * 4;
  float *vb = (float*)(fb + 240 * 400 * 3); cl = (u32*)(vb + 64);
  float verts[] = { 0.0f, 0.6f, -0.5f, 1.0f, 1, 0, 0, 1,   -0.6f, -0.6f, -0.5f, 1.0f, 0, 1, 0, 1,   0.6f, -0.6f, -0.5f, 1.0f, 0, 0, 1, 1 };
  for (int i = 0; i < 24; i++) vb[i] = verts[i];
  for (u32 i = 0; i < 240 * 400; i++) ((u32*)colorBuf)[i] = 0x203040FF; // fundo
  W(0x40, 0); W(0x41, f24(120.0f)); W(0x43, f24(200.0f)); W(0x68, 0); W(0x4D, f24(-1.0f)); W(0x4E, 0);
  W(0x116, 3); W(0x117, 0); W(0x11C, phys(depthBuf) >> 3); W(0x11D, phys(colorBuf) >> 3); W(0x11E, 240 | ((400 - 1) << 12));
  W(0x107, 0x0F00); W(0x100, 0); W(0x104, 0); W(0x80, 0); W(0xE0, 0);
  W(0xC0, 0); W(0xC1, 0); W(0xC2, 0); W(0xC3, 0); W(0xC4, 0);
  u32 st[] = { 0xC8, 0xD0, 0xD8, 0xF0, 0xF8 }; for (int i = 0; i < 5; i++) { W(st[i], 0x000F000F); W(st[i] + 1, 0); W(st[i] + 2, 0); W(st[i] + 4, 0); }
  W(0x2CB, 0); W(0x2CC, 0x4C000000); W(0x2CC, 0x4C201000); W(0x2CC, 0x88000000);
  W(0x2D5, 0); W(0x2D6, 0x0D86C36F);
  W(0x2BA, 0x7FFF0000); W(0x2B9, 1); W(0x2BB, 0x10); W(0x4F, 2); W(0x50, 0x03020100); W(0x51, 0x0B0A0908);
  W(0x200, phys(vb) >> 3); W(0x201, 0xFF); W(0x202, 0x10000000);
  W(0x203, 0); W(0x204, 0x10); W(0x205, 0x20200000);
  W(0x25E, 0); W(0x22A, 0); W(0x228, 3); W(0x22E, 1); W(0x111, 1);
  if (nCl & 1) W(0x10, 0);
  u32 c1[8] = { 1, (u32)cl, nCl * 4, 0, 0, 0, 1, 0 }; gx(c1);
  u32 c3[8] = { 3, (u32)colorBuf, (u32)fb, (400 << 16) | 240, (400 << 16) | 240, (0 << 8) | (1 << 12), 0, 0 }; gx(c3);
  present(0, fb); status[1] = 1;
  for (;;) { SVC(0x24, gspEv, 0, 0xFFFFFFFF, 0x7FFFFFFF, 0); SVC(0x19, gspEv, 0, 0, 0, 0); status[2]++; }
}
void __attribute__((naked, section(".text.start"))) _start(void) { __asm__ volatile("ldr sp, =0x0FFFFF00\n bl main\n svc 0x03"); }
