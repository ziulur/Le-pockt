typedef unsigned int u32;
__attribute__((noinline)) static u32 inner(u32 a) { return a * 3; }
u32 thumb_fn(u32 a, u32 b) { return inner(a + b); }
