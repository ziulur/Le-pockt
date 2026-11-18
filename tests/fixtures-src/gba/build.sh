#!/bin/sh
# Monta os programas de teste próprios de GBA em tests/fixtures/. Precisa de clang, ld.lld e llvm-objcopy.
set -e
cd "$(dirname "$0")"
OUT=../../fixtures
CF="--target=armv4t-none-eabi -mcpu=arm7tdmi -ffreestanding -nostdlib -fno-builtin -Wno-everything"
clang $CF -c crt0.s -o crt0.o; clang $CF -marm -O1 -c support.c -o sup.o
cpu() { clang $CF $2 $3 $4 -c cputest.c -o ct.o; clang $CF -marm -O1 -c main_cpu.c -o mc.o
        ld.lld -T link.ld crt0.o mc.o ct.o sup.o -o t.elf; llvm-objcopy -O binary t.elf $OUT/gba-cpu-$1.gba; }
cpu arm_O0 -marm -O0; cpu arm_O2 -marm -O2; cpu arm_Os -marm -Os
cpu th_O0 -mthumb -O0 -DNO64; cpu th_O2 -mthumb -O2 -DNO64; cpu th_Os -mthumb -Os -DNO64
clang $CF -marm -O1 -c hw.c -o hw.o; clang $CF -c edge.s -o edge.o
ld.lld -T link.ld crt0.o hw.o edge.o sup.o -o t.elf; llvm-objcopy -O binary t.elf $OUT/gba-hw.gba
clang $CF -marm -O2 -c demo.c -o demo.o
ld.lld -T link.ld crt0.o demo.o sup.o -o t.elf; llvm-objcopy -O binary t.elf $OUT/gba-demo.gba
rm -f *.o *.elf
# Valores esperados do teste de CPU (rodando o mesmo código no computador):
#   clang -O1 -DNATIVE cputest.c && ./a.out              -> resultado dos testes ARM
#   clang -O1 -DNATIVE -DNO64 cputest.c && ./a.out       -> resultado dos testes Thumb
