ENTRY(_start)
SECTIONS {
  . = 0x00100000;
  .text : { *(.text.start) *(.text*) }
  . = ALIGN(0x1000);
  .rodata : { *(.rodata*) }
  . = ALIGN(0x1000);
  .data : { *(.data*) *(.bss*) *(COMMON) }
}
