#!/bin/sh
# Monta tests/fixtures/3ds-hello.3dsx (programa de teste próprio). Precisa de clang e ld.lld.
set -e
cd "$(dirname "$0")"
F="--target=armv6k-none-eabihf -mcpu=mpcore -mfpu=vfp -mfloat-abi=hard -marm -ffreestanding -nostdlib -fno-builtin -O2 -Wno-everything"
clang $F -c hello.c -o hello.o
ld.lld -T ld.ld hello.o -o hello.elf
for s in text rodata data; do llvm-objcopy -O binary --only-section=.$s hello.elf $s.bin; done
python3 - <<'PY'
import struct
t=open('text.bin','rb').read(); r=open('rodata.bin','rb').read(); d=open('data.bin','rb').read()
hdr=struct.pack('<4sHHIIIIII',b'3DSX',0x20,8,0,0,len(t),len(r),len(d),0)
rel=struct.pack('<6I',0,0,0,0,0,0)
open('../../fixtures/3ds-hello.3dsx','wb').write(hdr+rel+t+r+d)
print('3ds-hello.3dsx', len(t), len(r), len(d))
PY
rm -f *.o *.elf *.bin
