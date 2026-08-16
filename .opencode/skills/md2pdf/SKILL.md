---
name: md2pdf
description: Convert any Markdown file to a clean, professional PDF. Supports headings, code blocks, tables, lists, blockquotes, and inline formatting.
---

# md2pdf - Markdown to PDF Converter

Convert any markdown file to a professionally styled PDF document.

## When to Use

- When generating reports, specs, or documents that need PDF output
- When creating artifacts that need a portable, printable format

## Commands

### Convert markdown to PDF
```bash
./tools/md2pdf document.md                          # Output: document.pdf
./tools/md2pdf document.md /path/to/output.pdf      # Custom output path
./tools/md2pdf document.md --title "My Report"      # Custom title
```

## Supported Markdown Features

- Headings (h1-h6) with sizing and underlines
- Fenced code blocks with monospace font and grey background
- Tables with headers and cell borders
- Blockquotes with left border styling
- Bullet lists (nested) and numbered lists
- Inline: **bold**, *italic*, `code`, [links](url)
- Horizontal rules (---, ***, ___)
- Unicode sanitization (em-dashes, arrows replaced with ASCII)

## Tips

- If no output path given, the PDF is saved next to the input with `.pdf` extension
- Title auto-detected from the first heading if not specified
