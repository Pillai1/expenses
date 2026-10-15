// Tiny dependency-free .xlsx writer: inline strings and a few fixed styles, packaged with zip.js.
// Cells are plain values (string | number | null) or objects { v, s, f } where s is a STYLE id and f a formula.
(function (root) {
  const Zip = typeof module !== 'undefined' && module.exports ? require('./zip.js') : root.Zip;
  const MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
  const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
  const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

  const STYLE = { normal: 0, header: 1, date: 2, money: 3, totalLabel: 4, totalMoney: 5, month: 6 };

  const STYLES_XML = HEAD +
    `<styleSheet xmlns="${NS}">` +
    '<numFmts count="3">' +
    '<numFmt numFmtId="164" formatCode="d mmm yyyy"/>' +
    '<numFmt numFmtId="165" formatCode="#,##0.00"/>' +
    '<numFmt numFmtId="166" formatCode="mmm yyyy"/>' +
    '</numFmts>' +
    '<fonts count="2">' +
    '<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
    '<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
    '</fonts>' +
    '<fills count="3">' +
    '<fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFE3ECF7"/><bgColor indexed="64"/></patternFill></fill>' +
    '</fills>' +
    '<borders count="2">' +
    '<border><left/><right/><top/><bottom/><diagonal/></border>' +
    '<border><left/><right/><top style="thin"><color auto="1"/></top><bottom/><diagonal/></border>' +
    '</borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="7">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1"/>' +
    '<xf numFmtId="165" fontId="1" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1"/>' +
    '<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

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

  function cellXml(ref, cell) {
    if (cell === null || cell === undefined) return '';
    const c = typeof cell === 'object' ? cell : { v: cell };
    const s = c.s ? ` s="${c.s}"` : '';
    if (c.f) {
      const v = c.v === undefined || c.v === null ? '' : `<v>${esc(c.v)}</v>`;
      return `<c r="${ref}"${s}><f>${esc(c.f)}</f>${v}</c>`;
    }
    if (c.v === null || c.v === undefined || c.v === '') return s ? `<c r="${ref}"${s}/>` : '';
    if (typeof c.v === 'number') return `<c r="${ref}"${s}><v>${c.v}</v></c>`;
    const text = String(c.v);
    const space = /^\s|\s$/.test(text) ? ' xml:space="preserve"' : '';
    return `<c r="${ref}"${s} t="inlineStr"><is><t${space}>${esc(text)}</t></is></c>`;
  }

  function sheetXml(sheet, index) {
    const rows = sheet.rows.map((row, r) =>
      `<row r="${r + 1}">${row.map((cell, c) => cellXml(colName(c) + (r + 1), cell)).join('')}</row>`
    ).join('');
    const cols = (sheet.widths || []).map((w, i) =>
      `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`
    ).join('');
    const pane = sheet.freezeHeader
      ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft"/>'
      : '';
    return HEAD +
      `<worksheet xmlns="${NS}" xmlns:r="${NS_R}">` +
      `<sheetViews><sheetView workbookViewId="0"${index === 0 ? ' tabSelected="1"' : ''}>${pane}</sheetView></sheetViews>` +
      '<sheetFormatPr defaultRowHeight="15"/>' +
      (cols ? `<cols>${cols}</cols>` : '') +
      `<sheetData>${rows}</sheetData>` +
      (sheet.autoFilter ? `<autoFilter ref="${sheet.autoFilter}"/>` : '') +
      '</worksheet>';
  }

  function workbookXml(sheets) {
    const list = sheets.map((s, i) => `<sheet name="${esc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('');
    const names = sheets.map((s, i) => {
      if (!s.autoFilter) return '';
      const [a, b] = s.autoFilter.split(':').map(ref => ref.replace(/^([A-Z]+)(\d+)$/, '$$$1$$$2'));
      return `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(s.name)}'!${a}:${b}</definedName>`;
    }).join('');
    return HEAD +
      `<workbook xmlns="${NS}" xmlns:r="${NS_R}">` +
      '<bookViews><workbookView activeTab="0"/></bookViews>' +
      `<sheets>${list}</sheets>` +
      (names ? `<definedNames>${names}</definedNames>` : '') +
      '<calcPr fullCalcOnLoad="1"/>' +
      '</workbook>';
  }

  function packageFiles(sheets) {
    const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const ct = 'application/vnd.openxmlformats-officedocument.spreadsheetml';
    return [
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
      { name: 'xl/styles.xml', data: STYLES_XML },
      ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s, i) })),
    ];
  }

  // sheets: [{ name, rows: [[cell]], widths?: [number], freezeHeader?: bool, autoFilter?: 'A1:E10' }]
  function build(sheets) {
    return Zip.zip(packageFiles(sheets));
  }

  const api = { build, colName, dateSerial, STYLE, MIME };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.XLSXWriter = api;
})(typeof self !== 'undefined' ? self : this);
