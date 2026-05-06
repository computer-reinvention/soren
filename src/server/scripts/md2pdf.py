"""Convert Markdown files to clean, professional PDFs using fpdf2."""

from __future__ import annotations

import argparse
import os
import re
import sys
from pathlib import Path

import requests
from fpdf import FPDF


# ── Unicode sanitization ────────────────────────────────────────────────────

_UNICODE_MAP = {
    "\u2014": "--",   # em dash
    "\u2013": "-",    # en dash
    "\u2018": "'",    # left single quote
    "\u2019": "'",    # right single quote
    "\u201c": '"',    # left double quote
    "\u201d": '"',    # right double quote
    "\u2026": "...",  # ellipsis
    "\u2192": "->",   # right arrow
    "\u2190": "<-",   # left arrow
    "\u2194": "<->",  # left-right arrow
    "\u21d2": "=>",   # double right arrow
    "\u2022": "*",    # bullet
    "\u00b7": "*",    # middle dot
    "\u2713": "[x]",  # check mark
    "\u2717": "[ ]",  # cross mark
    "\u2714": "[x]",  # heavy check mark
    "\u2716": "[X]",  # heavy cross mark
    "\u00a0": " ",    # non-breaking space
    "\u200b": "",     # zero-width space
    "\u2502": "|",    # box drawing vertical
    "\u251c": "|",    # box drawing tee
    "\u2514": "`",    # box drawing corner
    "\u2500": "-",    # box drawing horizontal
    "\u250c": "+",    # box drawing down-right
    "\u2510": "+",    # box drawing down-left
    "\u2518": "+",    # box drawing up-left
    "\u2524": "|",    # box drawing left tee
    "\u252c": "+",    # box drawing down tee
    "\u2534": "+",    # box drawing up tee
    "\u253c": "+",    # box drawing cross
    "\u25cf": "*",    # black circle
    "\u25cb": "o",    # white circle
    "\u25a0": "#",    # black square
    "\u25a1": "[ ]",  # white square
    "\u2603": "*",    # snowman
}


def sanitize(text: str) -> str:
    """Replace unicode chars that fpdf2 can't render in latin-1."""
    for orig, repl in _UNICODE_MAP.items():
        text = text.replace(orig, repl)
    return text.encode("latin-1", errors="replace").decode("latin-1")


# ── Markdown parser ─────────────────────────────────────────────────────────

class MarkdownPDF(FPDF):
    """PDF renderer with markdown-aware styling."""

    def __init__(self, title: str = ""):
        super().__init__()
        self._doc_title = title
        self.set_auto_page_break(auto=True, margin=20)

    def header(self):
        if self._doc_title:
            self.set_font("Helvetica", "I", 8)
            self.set_text_color(140, 140, 140)
            self.cell(0, 6, sanitize(self._doc_title), align="L")
            self.ln(2)
            self.set_text_color(0, 0, 0)

    def footer(self):
        self.set_y(-15)
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(140, 140, 140)
        self.cell(0, 10, f"Page {self.page_no()}/{{nb}}", align="C")
        self.set_text_color(0, 0, 0)


def _strip_inline_markup(text: str) -> str:
    """Remove markdown inline markup for plain text extraction."""
    # Bold+italic
    text = re.sub(r'\*\*\*(.+?)\*\*\*', r'\1', text)
    text = re.sub(r'___(.+?)___', r'\1', text)
    # Bold
    text = re.sub(r'\*\*(.+?)\*\*', r'\1', text)
    text = re.sub(r'__(.+?)__', r'\1', text)
    # Italic
    text = re.sub(r'\*(.+?)\*', r'\1', text)
    text = re.sub(r'_(.+?)_', r'\1', text)
    # Inline code
    text = re.sub(r'`(.+?)`', r'\1', text)
    # Links [text](url)
    text = re.sub(r'\[(.+?)\]\(.+?\)', r'\1', text)
    # Strikethrough
    text = re.sub(r'~~(.+?)~~', r'\1', text)
    return text


def _render_inline(pdf: MarkdownPDF, text: str, base_font: str = "Helvetica",
                   base_size: int = 10, base_style: str = ""):
    """Render a line with inline formatting (bold, italic, code, links)."""
    # Tokenize inline elements
    pattern = re.compile(
        r'(\*\*\*(.+?)\*\*\*'    # bold+italic
        r'|\*\*(.+?)\*\*'         # bold
        r'|\*(.+?)\*'             # italic
        r'|`(.+?)`'               # inline code
        r'|\[(.+?)\]\((.+?)\))'   # link
    )

    pos = 0
    parts = []
    for m in pattern.finditer(text):
        # Text before this match
        if m.start() > pos:
            parts.append(("text", text[pos:m.start()]))

        if m.group(2):     # bold+italic
            parts.append(("bi", m.group(2)))
        elif m.group(3):   # bold
            parts.append(("b", m.group(3)))
        elif m.group(4):   # italic
            parts.append(("i", m.group(4)))
        elif m.group(5):   # code
            parts.append(("code", m.group(5)))
        elif m.group(6):   # link
            parts.append(("link", m.group(6)))

        pos = m.end()

    # Remaining text
    if pos < len(text):
        parts.append(("text", text[pos:]))

    if not parts:
        parts = [("text", text)]

    for kind, content in parts:
        content = sanitize(content)
        if kind == "text":
            pdf.set_font(base_font, base_style, base_size)
            pdf.write(5, content)
        elif kind == "b":
            pdf.set_font(base_font, "B", base_size)
            pdf.write(5, content)
        elif kind == "i":
            pdf.set_font(base_font, "I", base_size)
            pdf.write(5, content)
        elif kind == "bi":
            pdf.set_font(base_font, "BI", base_size)
            pdf.write(5, content)
        elif kind == "code":
            pdf.set_font("Courier", "", base_size - 1)
            pdf.set_fill_color(240, 240, 240)
            pdf.write(5, f" {content} ")
        elif kind == "link":
            pdf.set_font(base_font, "U", base_size)
            pdf.set_text_color(0, 0, 180)
            pdf.write(5, content)
            pdf.set_text_color(0, 0, 0)

    pdf.set_font(base_font, base_style, base_size)
    pdf.ln(5)


def _parse_table_row(line: str) -> list[str]:
    """Parse a markdown table row into cells."""
    line = line.strip()
    if line.startswith("|"):
        line = line[1:]
    if line.endswith("|"):
        line = line[:-1]
    return [cell.strip() for cell in line.split("|")]


def _is_separator_row(line: str) -> bool:
    """Check if a table row is a separator (e.g., |---|---|)."""
    stripped = line.strip().strip("|")
    return bool(re.match(r'^[\s\-:| ]+$', stripped)) and "-" in stripped


def md_to_pdf(md_text: str, output_path: str, title: str = "") -> str:
    """Convert markdown text to a PDF file.

    Supports: headings, code blocks, tables, blockquotes,
    bullet lists, numbered lists, horizontal rules, inline formatting.
    """
    pdf = MarkdownPDF(title=title)
    pdf.alias_nb_pages()
    pdf.add_page()

    lines = md_text.split("\n")
    i = 0
    total = len(lines)

    while i < total:
        line = lines[i]

        # ── Fenced code blocks ───────────────────────────────────────
        if line.strip().startswith("```"):
            lang = line.strip().removeprefix("```").strip()
            code_lines = []
            i += 1
            while i < total and not lines[i].strip().startswith("```"):
                code_lines.append(lines[i])
                i += 1
            i += 1  # skip closing ```

            # Render code block
            pdf.set_fill_color(245, 245, 245)
            pdf.set_draw_color(200, 200, 200)
            pdf.set_font("Courier", "", 8)

            # Background rect
            x_start = pdf.get_x()
            y_start = pdf.get_y()

            for cl in code_lines:
                cl = sanitize(cl)
                if len(cl) > 110:
                    cl = cl[:107] + "..."
                pdf.cell(0, 4, "  " + cl, new_x="LMARGIN", new_y="NEXT", fill=True)
            pdf.ln(3)
            continue

        # ── Headings ─────────────────────────────────────────────────
        heading_match = re.match(r'^(#{1,6})\s+(.+)$', line)
        if heading_match:
            level = len(heading_match.group(1))
            text = _strip_inline_markup(heading_match.group(2))
            sizes = {1: 18, 2: 15, 3: 13, 4: 11, 5: 10, 6: 10}
            size = sizes.get(level, 10)

            if level <= 2:
                pdf.ln(4)
            else:
                pdf.ln(2)

            pdf.set_font("Helvetica", "B", size)
            pdf.cell(0, size * 0.6, sanitize(text), new_x="LMARGIN", new_y="NEXT")

            # Underline for h1 and h2
            if level <= 2:
                y = pdf.get_y()
                pdf.set_draw_color(180, 180, 180)
                pdf.line(pdf.l_margin, y, pdf.w - pdf.r_margin, y)
                pdf.ln(2)

            pdf.ln(2)
            i += 1
            continue

        # ── Tables ───────────────────────────────────────────────────
        if "|" in line and i + 1 < total and _is_separator_row(lines[i + 1]):
            header_cells = _parse_table_row(line)
            i += 2  # skip header + separator

            data_rows = []
            while i < total and "|" in lines[i] and lines[i].strip():
                data_rows.append(_parse_table_row(lines[i]))
                i += 1

            num_cols = len(header_cells)
            if num_cols == 0:
                continue

            # Calculate column widths
            page_width = pdf.w - pdf.l_margin - pdf.r_margin
            col_width = page_width / num_cols

            # Header
            pdf.set_font("Helvetica", "B", 9)
            pdf.set_fill_color(230, 230, 230)
            for j, cell in enumerate(header_cells):
                w = col_width
                pdf.cell(w, 6, sanitize(_strip_inline_markup(cell))[:30], border=1, fill=True)
            pdf.ln()

            # Data rows
            pdf.set_font("Helvetica", "", 9)
            for row in data_rows:
                for j, cell in enumerate(row[:num_cols]):
                    w = col_width
                    pdf.cell(w, 6, sanitize(_strip_inline_markup(cell))[:30], border=1)
                pdf.ln()

            pdf.ln(3)
            continue

        # ── Blockquotes ──────────────────────────────────────────────
        if line.strip().startswith(">"):
            quote_lines = []
            while i < total and lines[i].strip().startswith(">"):
                text = lines[i].strip().removeprefix(">").strip()
                quote_lines.append(text)
                i += 1

            pdf.set_fill_color(245, 245, 250)
            pdf.set_draw_color(100, 100, 200)

            # Draw left border
            x = pdf.get_x()
            y_start = pdf.get_y()

            pdf.set_font("Helvetica", "I", 10)
            pdf.set_text_color(80, 80, 80)
            for ql in quote_lines:
                pdf.cell(4, 5, "")  # indent
                pdf.cell(0, 5, sanitize(_strip_inline_markup(ql)), new_x="LMARGIN", new_y="NEXT")

            # Left bar
            y_end = pdf.get_y()
            pdf.set_draw_color(100, 100, 200)
            pdf.set_line_width(0.8)
            pdf.line(x + 2, y_start, x + 2, y_end)
            pdf.set_line_width(0.2)

            pdf.set_text_color(0, 0, 0)
            pdf.ln(3)
            continue

        # ── Bullet lists ─────────────────────────────────────────────
        list_match = re.match(r'^(\s*)([-*+])\s+(.+)$', line)
        if list_match:
            indent_level = len(list_match.group(1)) // 2
            items = []
            while i < total:
                m = re.match(r'^(\s*)([-*+])\s+(.+)$', lines[i])
                if not m:
                    break
                depth = len(m.group(1)) // 2
                items.append((depth, m.group(3)))
                i += 1

            pdf.set_font("Helvetica", "", 10)
            bullets = ["*", "-", "o"]
            for depth, text in items:
                indent = 8 + depth * 6
                bullet = bullets[min(depth, len(bullets) - 1)]
                pdf.cell(indent, 5, "")
                pdf.cell(4, 5, bullet)
                _render_inline(pdf, text)
            pdf.ln(2)
            continue

        # ── Numbered lists ───────────────────────────────────────────
        num_match = re.match(r'^(\s*)(\d+)[.)]\s+(.+)$', line)
        if num_match:
            items = []
            while i < total:
                m = re.match(r'^(\s*)(\d+)[.)]\s+(.+)$', lines[i])
                if not m:
                    break
                depth = len(m.group(1)) // 2
                items.append((depth, m.group(2), m.group(3)))
                i += 1

            pdf.set_font("Helvetica", "", 10)
            for depth, num, text in items:
                indent = 8 + depth * 6
                pdf.cell(indent, 5, "")
                pdf.cell(8, 5, f"{num}.")
                _render_inline(pdf, text)
            pdf.ln(2)
            continue

        # ── Horizontal rule ──────────────────────────────────────────
        if re.match(r'^(---|\*\*\*|___)\s*$', line.strip()):
            pdf.ln(2)
            y = pdf.get_y()
            pdf.set_draw_color(180, 180, 180)
            pdf.line(pdf.l_margin, y, pdf.w - pdf.r_margin, y)
            pdf.ln(4)
            i += 1
            continue

        # ── Empty line ───────────────────────────────────────────────
        if not line.strip():
            pdf.ln(3)
            i += 1
            continue

        # ── Regular paragraph ────────────────────────────────────────
        _render_inline(pdf, line)
        i += 1

    # Write output
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    pdf.output(output_path)
    return output_path


# ── CLI ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Convert Markdown to PDF")
    parser.add_argument("input", help="Input markdown file")
    parser.add_argument("output", nargs="?", help="Output PDF path (default: input with .pdf extension)")
    parser.add_argument("--title", help="Document title (default: first heading or filename)")
    args = parser.parse_args()

    input_path = Path(args.input)
    if not input_path.exists():
        print(f"error: file not found: {input_path}", file=sys.stderr)
        sys.exit(1)

    # Read markdown
    md_text = input_path.read_text(encoding="utf-8")

    # Determine output path
    if args.output:
        output_path = args.output
    else:
        output_path = str(input_path.with_suffix(".pdf"))

    # Determine title
    title = args.title
    if not title:
        # Extract from first heading
        for line in md_text.split("\n"):
            m = re.match(r'^#{1,3}\s+(.+)$', line)
            if m:
                title = _strip_inline_markup(m.group(1))
                break
        if not title:
            title = input_path.stem

    print(f"Converting {input_path} -> {output_path}")
    result = md_to_pdf(md_text, output_path, title=title)
    print(f"PDF saved: {result}")


if __name__ == "__main__":
    main()
