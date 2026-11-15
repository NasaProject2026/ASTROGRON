import type { ReportEnvelope } from '@/domain/farmer-ux-contracts';

const encoder = new TextEncoder();

export type PdfUnitMode = 'SI_METRIC' | 'SI_WITH_ACRE_GALLON_EQUIV';

/**
 * Sanitize UTF-8 / scientific strings into strict WinAnsi ASCII-safe characters so Type1
 * Helvetica PDF streams render reliably across all PDF readers without replacement glyphs.
 */
export function sanitizePdfText(raw: string): string {
  return raw
    .replace(/\u2014|\u2013/g, '--')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u00b0/g, ' deg ')
    .replace(/\u00b3/g, '3')
    .replace(/\u00b2/g, '2')
    .replace(/\u00d7/g, 'x')
    .replace(/\u2192/g, '->')
    .replace(/\u00b7/g, '|')
    .replace(/[^\x20-\x7e]/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/\s+/g, ' ')
    .trim();
}

function wrapTextLines(text: string, maxChars: number): string[] {
  const clean = text
    .replace(/\u2014|\u2013/g, '--')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\u00b0/g, ' deg ')
    .replace(/\u00b3/g, '3')
    .replace(/\u00b2/g, '2')
    .replace(/\u00d7/g, 'x')
    .replace(/\u2192/g, '->')
    .replace(/\u00b7/g, '|')
    .replace(/[^\x20-\x7e]/g, ' ')
    .trim();

  if (!clean) return [''];
  const words = clean.split(/\s+/);
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    if (!current) {
      current = word;
    } else if (current.length + 1 + word.length <= maxChars) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

interface PdfLineSpec {
  text: string;
  size: number;
  bold?: boolean;
  spacingBefore?: number;
  spacingAfter?: number;
  indent?: number;
}

function escapePdfLiteral(rawLine: string): string {
  return rawLine.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function buildFieldGeometryVectorOps(
  report: ReportEnvelope,
  topY: number
): { ops: string[]; heightConsumed: number } {
  const fields = report.fieldGeometries ?? [];
  const rings: Array<{ label: string; ring: number[][] }> = [];
  for (const f of fields) {
    const g = f.geometry as { type?: string; coordinates?: unknown } | null;
    if (!g) continue;
    if (g.type === 'Polygon' && Array.isArray(g.coordinates) && Array.isArray(g.coordinates[0])) {
      rings.push({ label: f.id, ring: g.coordinates[0] as number[][] });
    } else if (g.type === 'MultiPolygon' && Array.isArray(g.coordinates)) {
      for (const poly of g.coordinates as number[][][][]) {
        if (Array.isArray(poly[0])) rings.push({ label: f.id, ring: poly[0] });
      }
    }
  }
  if (rings.length === 0) return { ops: [], heightConsumed: 0 };

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const r of rings) {
    for (const pt of r.ring) {
      const x = pt[0] ?? 0;
      const y = pt[1] ?? 0;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  if (!Number.isFinite(minX)) return { ops: [], heightConsumed: 0 };

  const boxX = 48;
  const boxW = 240;
  const boxH = 88;
  const boxY = topY - boxH;
  const spanX = Math.max(maxX - minX, 0.0005);
  const spanY = Math.max(maxY - minY, 0.0005);
  const pad = 12;

  const ops: string[] = [
    'q',
    '0.04 0.11 0.19 rg',
    '0.25 0.45 0.62 RG',
    '1 w',
    `${boxX} ${boxY} ${boxW} ${boxH} re B`,
  ];

  const palette = [
    '0.45 0.89 0.94',
    '0.34 0.85 0.65',
    '0.57 0.72 1.00',
  ];

  rings.slice(0, 6).forEach((item, idx) => {
    const strokeRgb = palette[idx % palette.length]!;
    ops.push(`${strokeRgb} RG 1.4 w 0.12 0.35 0.44 rg`);
    const cmds = item.ring
      .map((pt, pIdx) => {
        const px = boxX + pad + (((pt[0] ?? minX) - minX) / spanX) * (boxW - pad * 2);
        const py = boxY + pad + (((pt[1] ?? minY) - minY) / spanY) * (boxH - pad * 2);
        return `${px.toFixed(1)} ${py.toFixed(1)} ${pIdx === 0 ? 'm' : 'l'}`;
      })
      .join(' ');
    ops.push(`${cmds} h B`);
  });

  // Crisp North marker & bbox caption right next to sketch
  ops.push('0.95 0.98 1.0 rg BT /F2 8.0 Tf 1 0 0 1 ' + `${boxX + boxW - 18} ${boxY + boxH - 14}` + ' Tm (N) Tj ET');
  ops.push('0.2 0.25 0.35 rg BT /F1 8.0 Tf ' + `1 0 0 1 ${boxX + boxW + 12} ${boxY + boxH - 16}` +
    ` Tm (Vector parcel sketch from WGS84 coords) Tj ET`);
  ops.push('0.2 0.25 0.35 rg BT /F1 7.5 Tf ' + `1 0 0 1 ${boxX + boxW + 12} ${boxY + boxH - 30}` +
    ` Tm (Extent: [${minX.toFixed(4)}, ${minY.toFixed(4)}] to [${maxX.toFixed(4)}, ${maxY.toFixed(4)}]) Tj ET`);
  ops.push('Q');

  return { ops, heightConsumed: boxH + 14 };
}

/**
 * Generates a deterministic, valid, multi-page PDF 1.4 document with strict xref offsets.
 */
export function buildReportPdfBytes(
  report: ReportEnvelope,
  unitMode: PdfUnitMode = 'SI_METRIC'
): Uint8Array {
  const areaLabel =
    report.totalAreaHa === null
      ? 'Not declared (coordinates only)'
      : unitMode === 'SI_WITH_ACRE_GALLON_EQUIV'
        ? `${report.totalAreaHa.toFixed(2)} ha (${(report.totalAreaHa * 2.47105).toFixed(2)} acres)`
        : `${report.totalAreaHa.toFixed(2)} ha`;

  const modeBanner =
    report.dataAvailabilityClass === 'VERIFIED_RECORDED_CORPUS'
      ? 'RECORDED M14 SCIENTIFIC ARCHIVE (READ-ONLY) -- NOT A FIELD RECOMMENDATION'
      : report.dataAvailabilityClass === 'SYNTHETIC_DEMO_CORPUS'
        ? 'SYNTHETIC INTERFACE DEMONSTRATION -- NOT RECORDED SCIENTIFIC RESULTS'
        : 'EVIDENCE AVAILABILITY REPORT -- NO CROP RECOMMENDATION AVAILABLE';

  const specs: PdfLineSpec[] = [
    { text: 'ASTRAGRON AGRICULTURAL RESEARCH & LAND REPORT', size: 15, bold: true, spacingAfter: 4 },
    { text: modeBanner, size: 9, bold: true, spacingAfter: 10 },
    {
      text: `Farm: ${report.farmName} (${report.farmId})`,
      size: 11,
      bold: true,
      spacingAfter: 3,
    },
    {
      text: `Location: ${report.locationLabel} | Coordinates: [${report.coordinates[0].toFixed(4)}, ${report.coordinates[1].toFixed(4)}] (EPSG:4326)`,
      size: 9,
      spacingAfter: 2,
    },
    {
      text: `Total Area: ${areaLabel} | Fields: ${report.fieldCount} | Analysis Date: ${report.createdAt}`,
      size: 9,
      spacingAfter: 2,
    },
    {
      text: `Report ID: ${report.reportId} | Input Revision: ${report.inputRevision} | Corpus: ${report.corpusVersion}`,
      size: 8.5,
      spacingAfter: 10,
    },
    { text: '1. OVERALL STATUS & SUMMARY', size: 12, bold: true, spacingBefore: 4, spacingAfter: 4 },
    { text: report.headlineStatus, size: 10, bold: true, spacingAfter: 3 },
    { text: report.recommendationNotice, size: 9.5, spacingAfter: 6 },
  ];

  for (const finding of report.summaryFindings) {
    specs.push({ text: `- ${finding}`, size: 9.5, indent: 8, spacingAfter: 3 });
  }

  if (report.waterBalanceChart.length > 0) {
    specs.push({
      text: '2. WEATHER & WATER DEFICIT COMPARISON (MODELED / ARCHIVED)',
      size: 12,
      bold: true,
      spacingBefore: 8,
      spacingAfter: 4,
    });
    for (const pt of report.waterBalanceChart) {
      const valStr = pt.value === null ? 'Not measured / NULL' : `${pt.value.toFixed(1)} ${pt.unit}`;
      specs.push({
        text: `- ${pt.label}: ${valStr}${pt.statusTag ? ` [${pt.statusTag}]` : ''}`,
        size: 9.5,
        indent: 8,
        spacingAfter: 2,
      });
    }
  }

  if (report.sourceCoveragesSummary.length > 0) {
    specs.push({
      text: '3. EARTH OBSERVATION & SATELLITE SOURCE AVAILABILITY',
      size: 12,
      bold: true,
      spacingBefore: 8,
      spacingAfter: 4,
    });
    for (const src of report.sourceCoveragesSummary) {
      specs.push({
        text: `- ${src.title} (${src.sourceId}): ${src.status} | Kind: ${src.coverageKind} | Grid: ${src.resolution}`,
        size: 9,
        indent: 8,
        spacingAfter: 2,
      });
    }
  }

  specs.push({ text: '4. WHAT WE KNOW', size: 12, bold: true, spacingBefore: 8, spacingAfter: 4 });
  for (const item of report.whatWeKnow) {
    specs.push({ text: `- ${item}`, size: 9.5, indent: 8, spacingAfter: 2 });
  }

  specs.push({ text: '5. WHAT IS MISSING & LIMITATIONS', size: 12, bold: true, spacingBefore: 8, spacingAfter: 4 });
  for (const item of report.whatWeDontKnow) {
    specs.push({ text: `- ${item}`, size: 9.5, indent: 8, spacingAfter: 2 });
  }

  specs.push({ text: '6. RECOMMENDED NEXT STEPS', size: 12, bold: true, spacingBefore: 8, spacingAfter: 4 });
  for (const item of report.whatHappensNext) {
    specs.push({ text: `- ${item}`, size: 9.5, indent: 8, spacingAfter: 2 });
  }

  if (report.scientificNotes.length > 0) {
    specs.push({ text: '7. SCIENTIFIC & PROVENANCE NOTES', size: 11, bold: true, spacingBefore: 8, spacingAfter: 4 });
    for (const note of report.scientificNotes) {
      specs.push({ text: `- ${note}`, size: 8.5, indent: 8, spacingAfter: 2 });
    }
  }

  specs.push({
    text: `PROVENANCE & DIGEST: ${report.provenanceFooter} | Hash=${report.contentHash}`,
    size: 8,
    spacingBefore: 10,
    spacingAfter: 2,
  });

  // Paginate across A4 / Letter safe height (612 x 792 pt, margins 48 pt, y from 744 down to 64)
  const pageContents: string[] = [];
  let ops: string[] = [];
  let y = 744;

  const pushNewPage = () => {
    pageContents.push(ops.join('\n'));
    ops = [];
    y = 744;
  };

  let hasDrawnGeometry = false;
  for (let idx = 0; idx < specs.length; idx += 1) {
    const spec = specs[idx]!;
    y -= spec.spacingBefore ?? 0;
    const indent = spec.indent ?? 0;
    const usableWidth = 516 - indent;
    const approxCharWidth = spec.size * 0.52;
    const maxChars = Math.max(28, Math.floor(usableWidth / approxCharWidth));
    const lines = wrapTextLines(spec.text, maxChars);
    const lineHeight = Math.ceil(spec.size * 1.38);

    for (const line of lines) {
      if (y - lineHeight < 64) {
        pushNewPage();
      }
      const fontKey = spec.bold ? 'F2' : 'F1';
      const x = 48 + indent;
      ops.push('BT');
      ops.push(`/${fontKey} ${spec.size.toFixed(1)} Tf`);
      ops.push(`1 0 0 1 ${x} ${y} Tm`);
      ops.push(`(${escapePdfLiteral(line)}) Tj`);
      ops.push('ET');
      y -= lineHeight;
    }
    y -= spec.spacingAfter ?? 0;

    // Render crisp vector field boundary sketch right below header summary block
    if (!hasDrawnGeometry && spec.text.startsWith('Report ID:') && (report.fieldGeometries?.length ?? 0) > 0) {
      hasDrawnGeometry = true;
      if (y - 108 < 64) {
        pushNewPage();
      }
      const sketch = buildFieldGeometryVectorOps(report, y);
      if (sketch.ops.length > 0) {
        ops.push(...sketch.ops);
        y -= sketch.heightConsumed;
      }
    }
  }
  if (ops.length > 0 || pageContents.length === 0) {
    pageContents.push(ops.join('\n'));
  }

  // Add uniform page footer to every page
  const totalPages = pageContents.length;
  const finalizedStreams = pageContents.map((body, idx) => {
    const footer = [
      'BT',
      '/F1 8.0 Tf',
      '1 0 0 1 48 36 Tm',
      `(ASTRAGRON Offline Report | Page ${idx + 1} of ${totalPages} | Revision ${escapePdfLiteral(report.inputRevision)}) Tj`,
      'ET',
    ].join('\n');
    return `${body}\n${footer}`;
  });

  // Object allocation:
  // 1: Catalog
  // 2: Pages
  // 3: Font F1 (Helvetica)
  // 4: Font F2 (Helvetica-Bold)
  // For each page i:
  //   5 + i*2     : Page object
  //   5 + i*2 + 1 : Content stream object
  const objects: string[] = [];
  const pageIds: number[] = [];

  for (let i = 0; i < finalizedStreams.length; i++) {
    pageIds.push(5 + i * 2);
  }

  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  objects.push(`<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] >>`);
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>');

  for (let i = 0; i < finalizedStreams.length; i++) {
    const pageObjId = 5 + i * 2;
    const streamObjId = pageObjId + 1;
    const streamBody = finalizedStreams[i] ?? '';
    const streamBytes = encoder.encode(streamBody).length;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${streamObjId} 0 R >>`
    );
    objects.push(`<< /Length ${streamBytes} >>\nstream\n${streamBody}\nendstream`);
  }

  // Serialize binary PDF with exact byte offsets
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [0]; // index 0 = free entry
  let cursor = 0;

  const pushStr = (str: string) => {
    const bytes = encoder.encode(str);
    chunks.push(bytes);
    cursor += bytes.length;
  };

  pushStr('%PDF-1.4\n%ASTR\n');

  for (let i = 0; i < objects.length; i++) {
    offsets.push(cursor);
    const objId = i + 1;
    pushStr(`${objId} 0 obj\n${objects[i]}\nendobj\n`);
  }

  const xrefStart = cursor;
  pushStr(`xref\n0 ${objects.length + 1}\n`);
  pushStr('0000000000 65535 f \n');
  for (let i = 1; i <= objects.length; i++) {
    const off = offsets[i] ?? 0;
    pushStr(`${String(off).padStart(10, '0')} 00000 n \n`);
  }

  pushStr(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);

  const out = new Uint8Array(cursor);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.length;
  }
  return out;
}
