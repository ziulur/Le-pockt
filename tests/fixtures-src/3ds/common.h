// Funções comuns dos programas de teste do LE Pocket 3DS (sem libctru).
// Faz o caminho que os programas de 3DS fazem: srv -> gsp::Gpu e hid:USER, memória linear,
// thread extra com arbitragem de endereço, conta em ponto flutuante (VFP), desenha nas duas telas
// e apresenta pelo GSP, esperando o VBlank pela fila de interrupções.
typedef unsigned int u32; typedef int s32; typedef unsigned char u8; typedef unsigned long long u64;
#define TLS() ({ u32 *t; __asm__ volatile("mrc p15, 0, %0, c13, c0, 3" : "=r"(t)); t; })
static inline s32 svc_r1(u32 n, u32 a0, u32 a1, u32 a2, u32 a3, u32 *o1);
#define SVC(num, r0v, r1v, r2v, r3v, out1) ({ register u32 r0 __asm__("r0") = (r0v); register u32 r1 __asm__("r1") = (r1v); register u32 r2 __asm__("r2") = (r2v); register u32 r3 __asm__("r3") = (r3v); \
  __asm__ volatile("svc " #num : "+r"(r0), "+r"(r1), "+r"(r2), "+r"(r3) :: "memory", "r12", "lr"); if (out1) *(u32*)(out1) = r1; (s32)r0; })
volatile u32 status[16] __attribute__((section(".data")));
static u32 srv, gsp, hid, gspEv, gspMemH, hidMemH;
static volatile u32 *gspMem = (u32*)0x10002000, *hidMem = (u32*)0x10000000;
static volatile s32 counter;
static s32 ipc(u32 h) { return SVC(0x32, h, 0, 0, 0, 0); }
static u32 getService(const char *name) {
  u32 *c = TLS() + 0x20; c[0] = 0x00050100; u32 n = 0; while (name[n]) n++;
  char *d = (char*)&c[1]; for (u32 i = 0; i < 8; i++) d[i] = i < n ? name[i] : 0;
  c[3] = n; c[4] = 0; ipc(srv); return c[3];
}
