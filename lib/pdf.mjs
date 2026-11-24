// A text PDF (not a scan) → rows of cells. Text pieces on one line become a row; pieces far apart become cells.
// Persian lists are right-to-left, so cells are ordered by x from right to left.
// Many PDFs store Persian in "visual" order with presentation-form letters (ﻻﺎک for کالا).
// Such text is reversed back to reading order (keeping Latin/digit runs as they are), then NFKC-normalised.
const AR = /[؀-ۿﭐ-﷿ﹰ-﻿]/;
export function fixRtl(s) {
  if (!/[ﭐ-﷿ﹰ-﻿]/.test(s)) return s.normalize("NFKC");
  const rev = [...s].reverse().join("");
  return rev.replace(/[A-Za-z0-9][A-Za-z0-9.,\-\/:]*[A-Za-z0-9]|[A-Za-z0-9]/g, run => [...run].reverse().join("")).normalize("NFKC").replace(/\s+/g, " ").trim();
}

export async function readPdf(buf) {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true, isEvalSupported: false, disableFontFace: true, verbosity: 0 }).promise;
  const rows = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const items = tc.items.filter(i => i.str && i.str.trim()).map(i => ({ s: fixRtl(i.str), x: i.transform[4], y: i.transform[5], w: i.width, h: Math.abs(i.transform[3]) || 10 }));
    items.sort((a, b) => b.y - a.y);
    const lines = [];
    for (const it of items) {
      const l = lines.find(l => Math.abs(l.y - it.y) < Math.max(3, it.h * 0.45));
      if (l) l.items.push(it); else lines.push({ y: it.y, items: [it] });
    }
    for (const l of lines.sort((a, b) => b.y - a.y)) {
      const its = l.items.sort((a, b) => (b.x + b.w) - (a.x + a.w));
      const cells = []; let prev = null;
      for (const it of its) {
        const gap = prev ? prev.x - (it.x + it.w) : Infinity;
        const sp = gap > 1 ? " " : "", last = cells[cells.length - 1];
        // pieces come right→left: Persian reads on (append), Latin/numbers read the other way (prepend)
        // a lone bracket inside Persian text is stored as the mirrored glyph, so swap it back
        const mir = s => /^[()\[\]]+$/.test(s) ? s.replace(/[()\[\]]/g, c => ({ "(": ")", ")": "(", "[": "]", "]": "[" }[c])) : s;
        if (prev && gap < Math.max(6, it.h * 0.9)) cells[cells.length - 1] = (AR.test(it.s) || AR.test(last) ? last + sp + mir(it.s) : it.s + sp + last).trim();
        else cells.push(it.s.trim());
        prev = it;
      }
      rows.push(cells);
    }
  }
  if (!rows.length) throw new Error("no text");
  return [{ name: "PDF", rows }];
}
