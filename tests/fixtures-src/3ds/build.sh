#!/bin/sh
# Monta tests/fixtures/3ds-hello.3dsx (programa de teste próprio). Precisa de clang e ld.lld.
set -e
cd "$(dirname "$0")"
F="--target=armv6k-none-eabihf -mcpu=mpcore -mfpu=vfp -mfloat-abi=hard -marm -ffreestanding -nostdlib -fno-builtin -O2 -Wno-everything"
for P in hello tri fs; do
clang $F -c $P.c -o $P.o
ld.lld -T ld.ld $P.o -o $P.elf
for s in text rodata data; do llvm-objcopy -O binary --only-section=.$s $P.elf $s.bin; done
python3 - $P <<'PY'
import struct, sys
t=open('text.bin','rb').read(); r=open('rodata.bin','rb').read(); d=open('data.bin','rb').read()
name=sys.argv[1]
romfs=bytes([0x28,0,0,0, 0xAB]) + bytes(59) if name=='fs' else b''
hs=0x2C if romfs else 0x20
body_off=hs+24
hdr=struct.pack('<4sHHIIIIII',b'3DSX',hs,8,0,0,len(t),len(r),len(d),0)
if romfs: hdr+=struct.pack('<III',0,0,body_off+len(t)+len(r)+len(d))
rel=struct.pack('<6I',0,0,0,0,0,0)
open('../../fixtures/3ds-%s.3dsx' % name,'wb').write(hdr+rel+t+r+d+romfs)
print('3ds-%s.3dsx' % sys.argv[1], len(t), len(r), len(d))
PY
done
rm -f *.o *.elf *.bin
