typedef unsigned int u32;
u32 run_tests(void);
int main(void) { volatile u32 *out = (volatile u32 *)0x02000000; out[1] = 0; out[0] = run_tests(); out[1] = 0xC0FFEE; for (;;) {} }
