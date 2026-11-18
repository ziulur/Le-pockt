ENTRY(_start)
MEMORY { rom (rx) : ORIGIN = 0x08000000, LENGTH = 32M  iwram (rwx) : ORIGIN = 0x03000000, LENGTH = 0x7000  ewram (rwx): ORIGIN = 0x02000100, LENGTH = 0x3FF00 }
SECTIONS {
  .text : { KEEP(*(.init)) *(.text*) *(.rodata*) *(.glue*) . = ALIGN(4); } > rom
  .iwram : { *(.iwram*) . = ALIGN(4); } > iwram AT > rom
  .data : { __data_start = .; *(.data*) . = ALIGN(4); __data_end = .; } > iwram AT > rom
  __data_lma = LOADADDR(.data);
  __iw_lma = LOADADDR(.iwram); __iw_start = ADDR(.iwram); __iw_end = ADDR(.iwram) + SIZEOF(.iwram);
  .bss (NOLOAD) : { __bss_start = .; *(.bss*) *(COMMON) . = ALIGN(4); __bss_end = .; } > iwram
  /DISCARD/ : { *(.ARM.exidx*) *(.ARM.attributes) *(.comment) }
}
