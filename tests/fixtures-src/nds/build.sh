#!/bin/sh
# Monta tests/fixtures/nds-test.nds (programa de teste próprio, ARM9 + ARM7). Precisa de clang e ld.lld.
set -e
cd "$(dirname "$0")"
cp ../gba/cputest.c ../gba/support.c .
C9="--target=armv5te-none-eabi -mcpu=arm946e-s -ffreestanding -nostdlib -fno-builtin -Wno-everything"
C7="--target=armv4t-none-eabi -mcpu=arm7tdmi -ffreestanding -nostdlib -fno-builtin -Wno-everything"
clang $C9 -marm -O2 -c arm9.c -o a9.o; clang $C9 -marm -O2 -c cputest.c -o ct9.o; clang $C9 -mthumb -O1 -c thumb9.c -o th9.o
clang $C9 -marm -O1 -c support.c -o s9.o; clang $C9 -c crt9.s -o c9.o
ld.lld --defsym=BASE=0x02000000 -T ld9.ld c9.o a9.o ct9.o th9.o s9.o -o a9.elf; llvm-objcopy -O binary a9.elf a9.bin
clang $C7 -marm -O1 -c arm7.c -o a7.o; clang $C7 -c crt9.s -o c7.o
ld.lld --defsym=BASE=0x02380000 -T ld9.ld c7.o a7.o -o a7.elf; llvm-objcopy -O binary a7.elf a7.bin
python3 - <<'PY'
import struct
a9=open('a9.bin','rb').read(); a7=open('a7.bin','rb').read(); assert len(a9)<0x4000
rom=bytearray(0xA000); rom[0:12]=b'LE NDS TEST '
struct.pack_into('<IIII',rom,0x20,0x4000,0x02000000,0x02000000,len(a9))
struct.pack_into('<IIII',rom,0x30,0x9000,0x02380000,0x02380000,len(a7))
rom[0x15C]=0x56; rom[0x15D]=0xCF
rom[0x4000:0x4000+len(a9)]=a9; rom[0x9000:0x9000+len(a7)]=a7
for i in range(0x80): struct.pack_into('<I',rom,0x8000+i*4,i*3+1)
open('../../fixtures/nds-test.nds','wb').write(rom)
PY
rm -f *.o *.elf *.bin cputest.c support.c
