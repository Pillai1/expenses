// Tiny dependency-free .xlsx writer, packaged with zip.js.
// A cell is a plain value (string | number | null) or { v, f, s } where f is a formula and s a style object:
//   { font: { b, sz, color }, fill: 'FFRRGGBB', border: { left, right, top, bottom, color }, align: { h, v, wrap }, numFmt }
// numFmt is a format code ('"$"#,##0.00') or a built-in id (14 = the phone/PC's short date).
(function (root) {
  const Zip = typeof module !== 'undefined' && module.exports ? require('./zip.js') : root.Zip;
  const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

  function esc(s) {
    return String(s)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function colName(i) {
    let s = '';
    for (i += 1; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
    return s;
  }

  // Excel serial day number for a local "YYYY-MM-DD" date.
  function dateSerial(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;
  }

  // Collects style objects into the indexed font/fill/border/format tables that styles.xml needs.
  function createStyles() {
    const fonts = [];
    const fills = ['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'];
    const borders = ['<border><left/><right/><top/><bottom/><diagonal/></border>'];
    const numFmts = [];
    const xfs = [];
    const dxfs = [];
    const add = (list, xml) => {
      let i = list.indexOf(xml);
      if (i < 0) { list.push(xml); i = list.length - 1; }
      return i;
    };
    const fontXml = (f = {}) =>
      `<font>${f.b ? '<b/>' : ''}<sz val="${f.sz || 11}"/><color rgb="${f.color || 'FF000000'}"/><name val="Calibri"/><family val="2"/></font>`;
    const borderXml = b => {
      const color = b.color ? `<color rgb="${b.color}"/>` : '<color indexed="64"/>';
      const side = n => (b[n] ? `<${n} style="${b[n]}">${color}</${n}>` : `<${n}/>`);
      return `<border>${side('left')}${side('right')}${side('top')}${side('bottom')}<diagonal/></border>`;
    };
    const numFmtId = code => {
      if (code === undefined || code === 'General') return 0;
      if (typeof code === 'number') return code;
      return 164 + add(numFmts, code);
    };
    const id = style => {
      if (!style) return 0;
      const a = style.align;
      const align = a
        ? `<alignment${a.h ? ` horizontal="${a.h}"` : ''}${a.v ? ` vertical="${a.v}"` : ''}${a.wrap ? ' wrapText="1"' : ''}/>`
        : '';
      const attrs = `numFmtId="${numFmtId(style.numFmt)}" fontId="${add(fonts, fontXml(style.font))}" ` +
        `fillId="${style.fill ? add(fills, `<fill><patternFill patternType="solid"><fgColor rgb="${style.fill}"/><bgColor indexed="64"/></patternFill></fill>`) : 0}" ` +
        `borderId="${style.border ? add(borders, borderXml(style.border)) : 0}" xfId="0" ` +
        'applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1"';
      return add(xfs, align ? `<xf ${attrs} applyAlignment="1">${align}</xf>` : `<xf ${attrs}/>`);
    };
    const dxfFill = rgb => add(dxfs, `<dxf><fill><patternFill><bgColor rgb="${rgb}"/></patternFill></fill></dxf>`);
    id({}); // xf 0: the default cell style
    const xml = () => HEAD +
      `<styleSheet xmlns="${NS}">` +
      (numFmts.length
        ? `<numFmts count="${numFmts.length}">${numFmts.map((code, i) => `<numFmt numFmtId="${164 + i}" formatCode="${esc(code)}"/>`).join('')}</numFmts>`
        : '') +
      `<fonts count="${fonts.length}">${fonts.join('')}</fonts>` +
      `<fills count="${fills.length}">${fills.join('')}</fills>` +
      `<borders count="${borders.length}">${borders.join('')}</borders>` +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      `<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>` +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      `<dxfs count="${dxfs.length}">${dxfs.join('')}</dxfs>` +
      '</styleSheet>';
    return { id, dxfFill, xml };
  }

  function cellXml(ref, cell, styles) {
    if (cell === null || cell === undefined) return '';
    const c = typeof cell === 'object' ? cell : { v: cell };
    const sid = styles.id(c.s);
    const s = sid ? ` s="${sid}"` : '';
    if (c.f) {
      const v = c.v === undefined || c.v === null ? '' : `<v>${esc(c.v)}</v>`;
      return `<c r="${ref}"${s}><f>${esc(c.f)}</f>${v}</c>`;
    }
    if (c.v === null || c.v === undefined || c.v === '') return s ? `<c r="${ref}"${s}/>` : '';
    if (typeof c.v === 'number') return `<c r="${ref}"${s}><v>${c.v}</v></c>`;
    const text = String(c.v);
    const space = /^\s|\s$|\n/.test(text) ? ' xml:space="preserve"' : '';
    return `<c r="${ref}"${s} t="inlineStr"><is><t${space}>${esc(text)}</t></is></c>`;
  }

  // sheet: { name, rows, widths?, heights?: { rowNumber: points }, merges?: ['A1:Q1'], zoom?, freezeHeader?,
  //          todayHighlight?: { range: 'A3:A33', fill: 'FFFFFF00' } }
  function sheetXml(sheet, index, styles) {
    const heights = sheet.heights || {};
    const rows = sheet.rows.map((row, r) => {
      const ht = heights[r + 1] ? ` ht="${heights[r + 1]}" customHeight="1"` : '';
      return `<row r="${r + 1}"${ht}>${row.map((cell, c) => cellXml(colName(c) + (r + 1), cell, styles)).join('')}</row>`;
    }).join('');
    const cols = (sheet.widths || []).map((w, i) =>
      w ? `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>` : ''
    ).join('');
    const pane = sheet.freezeHeader
      ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft"/>'
      : '';
    const zoom = sheet.zoom ? ` zoomScale="${sheet.zoom}" zoomScaleNormal="${sheet.zoom}"` : '';
    const merges = sheet.merges && sheet.merges.length
      ? `<mergeCells count="${sheet.merges.length}">${sheet.merges.map(m => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>`
      : '';
    let cf = '';
    if (sheet.todayHighlight) {
      const { range, fill } = sheet.todayHighlight;
      const first = range.split(':')[0];
      cf = `<conditionalFormatting sqref="${range}"><cfRule type="timePeriod" dxfId="${styles.dxfFill(fill)}" priority="1" timePeriod="today">` +
        `<formula>FLOOR(${first},1)=TODAY()</formula></cfRule></conditionalFormatting>`;
    }
    return HEAD +
      `<worksheet xmlns="${NS}" xmlns:r="${NS_R}">` +
      `<sheetViews><sheetView workbookViewId="0"${index === 0 ? ' tabSelected="1"' : ''}${zoom}>${pane}</sheetView></sheetViews>` +
      '<sheetFormatPr defaultRowHeight="15"/>' +
      (cols ? `<cols>${cols}</cols>` : '') +
      `<sheetData>${rows}</sheetData>` +
      merges + cf +
      '</worksheet>';
  }

  function workbookXml(sheets) {
    const list = sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('');
    return HEAD +
      `<workbook xmlns="${NS}" xmlns:r="${NS_R}">` +
      '<bookViews><workbookView activeTab="0"/></bookViews>' +
      `<sheets>${list}</sheets>` +
      '<calcPr fullCalcOnLoad="1"/>' +
      '</workbook>';
  }

  function build(sheets) {
    const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const ct = 'application/vnd.openxmlformats-officedocument.spreadsheetml';
    const styles = createStyles();
    const sheetFiles = sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s, i, styles) }));
    return Zip.zip([
      {
        name: '[Content_Types].xml',
        data: HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          `<Override PartName="/xl/workbook.xml" ContentType="${ct}.sheet.main+xml"/>` +
          sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="${ct}.worksheet+xml"/>`).join('') +
          `<Override PartName="/xl/styles.xml" ContentType="${ct}.styles+xml"/>` +
          '</Types>',
      },
      {
        name: '_rels/.rels',
        data: HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          `<Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/>` +
          '</Relationships>',
      },
      { name: 'xl/workbook.xml', data: workbookXml(sheets) },
      {
        name: 'xl/_rels/workbook.xml.rels',
        data: HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="${rel}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
          `<Relationship Id="rId${sheets.length + 1}" Type="${rel}/styles" Target="styles.xml"/>` +
          '</Relationships>',
      },
      { name: 'xl/styles.xml', data: styles.xml() },
      ...sheetFiles,
    ]);
  }

  const api = { build, colName, dateSerial, MIME };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.XLSXWriter = api;
})(typeof self !== 'undefined' ? self : this);
