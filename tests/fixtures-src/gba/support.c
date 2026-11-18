typedef unsigned int u32; typedef unsigned char u8;
void *memcpy(void *d, const void *s, u32 n) { u8 *a = d; const u8 *b = s; while (n--) *a++ = *b++; return d; }
void *memset(void *d, int c, u32 n) { u8 *a = d; while (n--) *a++ = (u8)c; return d; }
void *memmove(void *d, const void *s, u32 n) { u8 *a = d; const u8 *b = s; if (a < b) while (n--) *a++ = *b++; else { a += n; b += n; while (n--) *--a = *--b; } return d; }
void __aeabi_memcpy(void *d, const void *s, u32 n) { memcpy(d, s, n); }
void __aeabi_memcpy4(void *d, const void *s, u32 n) { memcpy(d, s, n); }
void __aeabi_memcpy8(void *d, const void *s, u32 n) { memcpy(d, s, n); }
void __aeabi_memset(void *d, u32 n, int c) { memset(d, c, n); }
void __aeabi_memset4(void *d, u32 n, int c) { memset(d, c, n); }
void __aeabi_memclr(void *d, u32 n) { memset(d, 0, n); }
void __aeabi_memclr4(void *d, u32 n) { memset(d, 0, n); }
void __aeabi_memclr8(void *d, u32 n) { memset(d, 0, n); }
void __aeabi_memmove(void *d, const void *s, u32 n) { memmove(d, s, n); }
void __aeabi_memmove4(void *d, const void *s, u32 n) { memmove(d, s, n); }
