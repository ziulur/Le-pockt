    .arm
    .section .init,"ax"
    .global _start
_start:
    b start
    .fill 156,1,0
    .ascii "LETEST      "
    .ascii "LETE"
    .ascii "LE"
    .byte 0x96,0,0
    .fill 7,1,0
    .byte 0,0,0,0
    .balign 4
start:
    ldr sp,=0x03007F00
    ldr r0,=__data_lma
    ldr r1,=__data_start
    ldr r2,=__data_end
1:  cmp r1,r2
    ldrlo r3,[r0],#4
    strlo r3,[r1],#4
    blo 1b
    ldr r1,=__bss_start
    ldr r2,=__bss_end
    mov r3,#0
2:  cmp r1,r2
    strlo r3,[r1],#4
    blo 2b
    ldr r0,=main
    mov lr,pc
    bx r0
3:  b 3b
    .global call_fn
call_fn:            @ call_fn(fn, a, b): chama fn(a,b) com interworking
    push {r4,lr}
    mov r4,r0
    mov r0,r1
    mov r1,r2
    mov lr,pc
    bx r4
    pop {r4,lr}
    bx lr
    .global swi_div
swi_div:  swi 0x060000
    bx lr
    .global swi_sqrt
swi_sqrt: swi 0x080000
    bx lr
    .global swi_vblank
swi_vblank: swi 0x050000
    bx lr
    .global swi_cpuset
swi_cpuset: swi 0x0B0000
    bx lr
    .global swi_lz77
swi_lz77: swi 0x110000
    bx lr
    .pool
    .text
    .arm
    .global swi_objaff
swi_objaff: swi 0x0F0000
    bx lr
    .global swi_bgaff
swi_bgaff: swi 0x0E0000
    bx lr
