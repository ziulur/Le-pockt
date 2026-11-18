    .syntax unified
    .arm
    .text
    .global edge_tests
@ edge_tests(u32 *out): guarda resultados e flags (CPSR>>28) alternados
.macro SAVE
    str r1,[r4],#4
    mrs r1,cpsr
    mov r1,r1,lsr #28
    str r1,[r4],#4
.endm
edge_tests:
    push {r4-r11,lr}
    mov r4,r0
    mov r0,#0x80000000
    movs r1,r0,lsr #32
    SAVE                    @ 0: 0, flags ZC = 0110 -> 6
    movs r1,r0,asr #32
    SAVE                    @ 1: ffffffff, NC -> 1010 = a
    cmp r0,r0               @ C=1
    mov r2,#2
    movs r1,r2,rrx
    SAVE                    @ 2: 80000001, N -> 8
    mov r0,#1
    mov r3,#32
    movs r1,r0,lsl r3
    SAVE                    @ 3: 0, ZC -> 6
    mov r3,#33
    movs r1,r0,lsl r3
    SAVE                    @ 4: 0, Z -> 4
    mov r0,#0x80000000
    mov r3,#32
    movs r1,r0,ror r3
    SAVE                    @ 5: 80000000, NC -> a
    mov r3,#0
    cmp r3,#1               @ C=0
    movs r1,r0,lsr r3
    SAVE                    @ 6: 80000000, N (C intacto=0) -> 8
    mvn r0,#0
    adds r1,r0,#1
    SAVE                    @ 7: 0, ZC -> 6
    mov r0,#0x7fffffff
    adds r1,r0,#1
    SAVE                    @ 8: 80000000, NV -> 9
    mov r0,#5
    cmp r0,r0               @ C=1
    rscs r1,r0,#3
    SAVE                    @ 9: 3-5 = fffffffe, N -> 8
    mov r0,#0
    subs r1,r0,#0
    sbcs r1,r0,#0
    SAVE                    @ 10: 0-0-0 (C=1) = 0, ZC -> 6
    @ LDR desalinhado e cargas com sinal
    adr r0,bytes
    ldr r1,[r0,#1]
    SAVE                    @ 11: 03020100 ror 8 = 00030201
    ldrsb r1,[r0,#4]
    SAVE                    @ 12: ffffff80
    ldrsh r1,[r0,#6]
    SAVE                    @ 13: fffff00f  (bytes 0f f0)
    ldrh r1,[r0,#6]
    SAVE                    @ 14: 0000f00f
    @ STM/LDM variantes
    add r5,r4,#0x100        @ área de trabalho
    mov r1,#0x11
    mov r2,#0x22
    mov r3,#0x33
    mov r6,r5
    stmib r6!,{r1-r3}       @ [r5+4]=11 [r5+8]=22 [r5+12]=33 ; r6=r5+12
    sub r1,r6,r5
    SAVE                    @ 15: 12
    ldr r1,[r5,#8]
    SAVE                    @ 16: 22
    add r6,r5,#12
    ldmda r6!,{r7-r9}       @ r9=[r5+12]=33 r8=[r5+8]=22 r7=[r5+4]=11 ; r6=r5
    add r1,r7,r8,lsl #8
    add r1,r1,r9,lsl #16
    SAVE                    @ 17: 332211
    sub r1,r6,r5
    SAVE                    @ 18: 0
    mov r6,r5
    add r6,r6,#64
    stmdb r6!,{r7-r9}
    ldmia r6!,{r1-r3}
    add r1,r1,r2,lsl #8
    add r1,r1,r3,lsl #16
    SAVE                    @ 19: 332211
    @ SWP
    mov r1,#0x55
    str r1,[r5]
    mov r2,#0xAA
    swp r1,r2,[r5]
    ldr r3,[r5]
    add r1,r1,r3,lsl #8
    SAVE                    @ 20: aa55
    @ modos e registradores bancados
    mrs r7,cpsr
    mov r8,sp
    bic r0,r7,#0x1f
    orr r0,r0,#0x12         @ IRQ
    msr cpsr_c,r0
    mov r9,sp               @ sp_irq
    mov sp,#0x1000
    msr cpsr_c,r7
    sub r1,sp,r8
    SAVE                    @ 21: 0 (sp do modo SYS intacto)
    orr r0,r0,#0x12
    msr cpsr_c,r0
    mov r1,sp
    mov sp,r9
    msr cpsr_c,r7
    msr cpsr_f,#0
    SAVE                    @ 22: 1000, flags 0
    @ multiplicações longas
    mvn r0,#0
    mov r2,#3
    umull r1,r3,r0,r2       @ ffffffff*3 = 2_fffffffd
    add r1,r1,r3
    SAVE                    @ 23: fffffffd+2 = ffffffff
    smull r1,r3,r0,r2       @ -1*3 = -3
    eor r1,r1,r3,lsl #4
    SAVE                    @ 24: fffffffd ^ fffffff0 = 0000000d
    mov r1,#10
    mov r3,#1
    umlal r1,r3,r0,r2       @ 1_0000000a + 2_fffffffd = 4_00000007
    add r1,r1,r3,lsl #8
    SAVE                    @ 25: 7 + 400 = 407
    @ Thumb: ida e volta
    adr r0,th+1
    bx r0
    .thumb
th: movs r1,#200
    lsls r1,r1,#24
    asrs r1,r1,#28
    movs r2,#3
    muls r1,r2,r1
    rsbs r1,r1,#0
    adr r0,back
    bx r0
    .arm
    .balign 4
back:
    SAVE                    @ 26: c
    pop {r4-r11,lr}
    bx lr
bytes: .byte 0x00,0x01,0x02,0x03,0x80,0x00,0x0f,0xf0
