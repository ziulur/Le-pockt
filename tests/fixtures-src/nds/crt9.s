    .arm
    .section .init,"ax"
    .global _start
_start:
    ldr r1,=__bss_start
    ldr r2,=__bss_end
    mov r3,#0
1:  cmp r1,r2
    strlo r3,[r1],#4
    blo 1b
    ldr r0,=main
    mov lr,pc
    bx r0
2:  b 2b
    .global swi_vbl
swi_vbl: swi 0x050000
    bx lr
    .global swi_div
swi_div: swi 0x090000
    bx lr
    .pool
