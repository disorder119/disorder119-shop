Archive taxonomy filter upgrade

This build-time patch affects only the classic archive browsing/filtering code.
It does not alter the guarded Match, Chaos or Baukasten HTML/JS blocks and does
not change config/mode-guard.json.

Browse filters use:
- department: Women / Men / Unisex / Objects (no Kids department)
- product_type: precise reviewed product type
- taxonomy_category: reviewed category, preserving legacy category for modes
- size_normalized: normalized browse size while keeping raw size unchanged
