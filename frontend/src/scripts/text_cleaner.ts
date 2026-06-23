const _INLINE_HEADING_RE = /([。！？])\u3000{2,}(主\u3000*文|理\u3000*由(?:\u3000*要\u3000*領)?|事\u3000*實(?:\u3000*(?:及|與)\u3000*理\u3000*由(?:\u3000*要\u3000*領)?|\u3000*理\u3000*由\u3000*及\u3000*證\u3000*據)?)\u3000*/g;

const _DATE_LINE_RE = /中[ \t\u3000]*華[ \t\u3000]*民[ \t\u3000]*國/;
const _DATE_LINE_ONLY_RE = /^[ \t\u3000]*中[ \t\u3000]*華[ \t\u3000]*民[ \t\u3000]*國[ \t\u3000]*\d{2,3}[ \t\u3000]*年[ \t\u3000]*\d{1,2}[ \t\u3000]*月[ \t\u3000]*\d{1,2}[ \t\u3000]*日[ \t\u3000]*$/;
const _SECTION_INDEX_START_RE = /^[一二三四五六七八九十壹貳參肆伍陸柒捌玖甲乙丙丁㈠㈡㈢㈣㈤㈥㈦㈧㈨㈩①②③④⑤⑥⑦⑧⑨⑩⑴⑵⑶⑷⑸⑹⑺⑻⑼⑽⒈⒉⒊⒋⒌⒍⒎⒏⒐⒑0-9０-９（(]/;
const _BODY_BLOCK_START_RE = /^[ \t\u3000]*(?:[一二三四五六七八九十壹貳參肆伍陸柒捌玖甲乙丙丁]+[、：:](?![一二三四五六七八九十壹貳參肆伍陸柒捌玖甲乙丙丁][、：:])|[㈠㈡㈢㈣㈤㈥㈦㈧㈨㈩]|[①②③④⑤⑥⑦⑧⑨⑩]|[⑴⑵⑶⑷⑸⑹⑺⑻⑼⑽]|[⒈⒉⒊⒋⒌⒍⒎⒏⒐⒑]|[（(][一二三四五六七八九十壹貳參肆伍陸柒捌玖甲乙丙丁]+[）)]|[0-9０-９]{1,3}[.、](?![0-9０-９]))/;

// 附表/附件/附錄 的 inline 引用排除
const _ATTACHMENT_INLINE_RE = /附[錄表件](?:[一二三四五六七八九十壹貳參肆伍陸柒捌玖甲乙丙丁0-9０-９]+(?:[、，][一二三四五六七八九十壹貳參肆伍陸柒捌玖甲乙丙丁0-9０-９]+)*)?(?:所示|編號|之|所列|明細)/;
const _KEEP_HEADERS = new Set(["主文", "事實", "理由", "理由要領", "事實及理由", "事實與理由", "事實及理由要領", "事實理由及證據"]);
const _KEEP_SECTION_LINE_RE = /^(?:主文|事實|理由(?:要領)?|事實(?:及|與)理由(?:要領)?|(?:[一二三四五六七八九十壹貳參肆伍陸柒捌玖甲乙丙丁0-9０-９]+[、：:]?)(?:原告(?:起訴|之|的)?主張|被告(?:答辯|抗辯)|被告則以|本院(?:之|的)?判斷|本院判斷|得心證之理由|茲分敘理由如下|程序方面|程序事項|程序部分|實體方面|實體事項|實體部分|論罪科刑|沒收(?:部分)?|證據能力|原判決認定|原裁定略以|兩造不爭執事項)[:：]?)$/;
const _COURT_TITLE_RE = /^.+法院.*(?:判決|裁定)$/;
const _REASON_HEADING_RE = /^(?:理由(?:要領)?|事實(?:及|與)?理由(?:要領)?|事實理由及證據|事實)$/;

const _CIRCLED_ITEM_START_RE = /^[㈠㈡㈢㈣㈤㈥㈦㈧㈨㈩①②③④⑤⑥⑦⑧⑨⑩⑴⑵⑶⑷⑸⑹⑺⑻⑼⑽⒈⒉⒊⒋⒌⒍⒎⒏⒐⒑]/;
const _FOOTER_SPECIAL_RE = /正本(?:係照|係依|證明)|書記官|法\s*官|審判長/;
const _ZHUJIAN_SENT_END_RE = /。\s*$/;
const _BODY_SPACE_RE = /(?<=[\u4e00-\u9fff\d\u3000-\u303f\u2460-\u24ff\u3200-\u32ff])\s+(?=[\u4e00-\u9fff\d\u3000-\u303f\u2460-\u24ff\u3200-\u32ff])/g;

function _normalize_spaces(text: string): string {
  return text.replace(/[ \t\u3000]+/g, '');
}

function _canonical_heading(line: string): string | null {
  const leadingMatch = line.match(/^[ \t\u3000]*/);
  const leading = leadingMatch ? leadingMatch[0] : '';
  const norm = _normalize_spaces(line.trim());
  if (norm === "主文") {
    return leading + "主文";
  }
  if (_REASON_HEADING_RE.test(norm)) {
    return leading + norm;
  }
  return null;
}

function _canonical_title(line: string): string | null {
  const norm = _normalize_spaces(line.trim());
  if (_COURT_TITLE_RE.test(norm)) {
    return norm;
  }
  return null;
}

function _normalize_body_line(line: string): string {
  const heading = _canonical_heading(line);
  if (heading !== null) {
    return heading;
  }

  if (line.startsWith('\u3000')) {
    const stripped_full = line.replace(/^\u3000+/, '');
    if (stripped_full && _SECTION_INDEX_START_RE.test(stripped_full)) {
      return stripped_full;
    }
  }
  return line;
}

function _is_body_keep_line(line: string): boolean {
  const norm = _normalize_spaces(line.trim());
  return _KEEP_HEADERS.has(norm) || _KEEP_SECTION_LINE_RE.test(norm);
}

function _starts_new_body_block(line: string): boolean {
  const stripped = line.replace(/^[ \t\u3000]+/, '');
  if (!stripped) {
    return true;
  }
  const norm = _normalize_spaces(stripped);
  return (
    _KEEP_HEADERS.has(norm) ||
    (stripped.startsWith("附錄") && !_ATTACHMENT_INLINE_RE.test(stripped)) ||
    (stripped.startsWith("附表") && !_ATTACHMENT_INLINE_RE.test(stripped)) ||
    (stripped.startsWith("附件") && !_ATTACHMENT_INLINE_RE.test(stripped)) ||
    norm.startsWith("中華民國") ||
    norm.startsWith("如不服") ||
    norm.includes("正本證明") ||
    _KEEP_SECTION_LINE_RE.test(norm) ||
    _BODY_BLOCK_START_RE.test(stripped)
  );
}

function _split_lines_preserve_trailing(text: string): { lines: string[], trailing_newline: boolean } {
  const trailing_newline = text.endsWith('\r\n');
  if (trailing_newline) {
    text = text.slice(0, -2);
  }
  return {
    lines: text.split('\r\n'),
    trailing_newline
  };
}

function _join_lines(lines: string[], trailing_newline: boolean): string {
  let text = lines.join('\r\n');
  if (trailing_newline) {
    text += '\r\n';
  }
  return text;
}

function _normalize_header_lines(lines: string[], body_start_idx: number | null): string[] {
  const limit = body_start_idx === null ? lines.length : body_start_idx;
  const out = [...lines];
  for (let idx = 0; idx < limit; idx++) {
    const title = _canonical_title(out[idx]);
    if (title !== null) {
      out[idx] = title;
    }
  }
  return out;
}

function _find_footer_start(lines: string[], body_start_idx: number): number {
  for (let idx = body_start_idx; idx < lines.length; idx++) {
    const line = lines[idx];
    if (_DATE_LINE_ONLY_RE.test(line) || line.includes("正本證明與原本無異")) {
      return idx;
    }
  }
  return lines.length;
}

function _find_footer_end(lines: string[], footer_start_idx: number): number {
  let last_secretary = -1;
  const scanLimit = Math.min(footer_start_idx + 40, lines.length);
  for (let idx = footer_start_idx; idx < scanLimit; idx++) {
    if (lines[idx].includes("書記官")) {
      last_secretary = idx;
    }
    if (idx > footer_start_idx && _DATE_LINE_ONLY_RE.test(lines[idx])) {
      if (last_secretary >= 0) {
        break;
      }
    }
  }
  if (last_secretary >= 0) {
    return last_secretary + 1;
  }
  return footer_start_idx;
}

function _compress_body_spaces(lines: string[], body_start_idx: number, footer_start_idx: number): string[] {
  const out = [...lines];
  const end = Math.min(footer_start_idx, out.length);
  for (let idx = body_start_idx; idx < end; idx++) {
    out[idx] = out[idx].replace(_BODY_SPACE_RE, '');
  }
  return out;
}

function _merge_footer_lines(lines: string[], footer_start_idx: number, footer_end_idx: number): string[] {
  if (footer_end_idx <= footer_start_idx) {
    return [...lines];
  }
  const out = [...lines];
  const footer = lines.slice(footer_start_idx, footer_end_idx);
  const merged: string[] = [];
  let in_paragraph = false;
  
  for (const line of footer) {
    const stripped = line.trim();
    const is_break = (
      !stripped ||
      _DATE_LINE_RE.test(line) ||
      _FOOTER_SPECIAL_RE.test(stripped)
    );
    const is_para_start = stripped.startsWith('如不服') || stripped.startsWith('告訴人');
    
    if (is_break) {
      merged.push(line);
      in_paragraph = false;
    } else if (is_para_start) {
      merged.push(line);
      in_paragraph = true;
    } else if (in_paragraph && merged.length > 0) {
      merged[merged.length - 1] = merged[merged.length - 1].replace(/[ \t\u3000]+$/, '') + line.replace(/^[ \t\u3000]+/, '');
    } else {
      merged.push(line);
      in_paragraph = false;
    }
  }
  
  out.splice(footer_start_idx, footer_end_idx - footer_start_idx, ...merged);
  return out;
}

function _merge_body_lines(lines: string[], body_start_idx: number, footer_start_idx: number): string[] {
  const out = [...lines];
  if (body_start_idx >= footer_start_idx) {
    return out;
  }

  const body_lines = lines.slice(body_start_idx, footer_start_idx).map(_normalize_body_line);
  const merged: string[] = [];
  let in_zhujian = false;

  for (const line of body_lines) {
    if (merged.length === 0) {
      merged.push(line);
      continue;
    }
    const prev = merged[merged.length - 1];
    const norm_prev = _normalize_spaces(prev.trim());
    
    if (norm_prev === '主文') {
      in_zhujian = true;
    } else if (in_zhujian && _is_body_keep_line(prev)) {
      in_zhujian = false;
    }
    
    const keep_break = (
      !prev.trim() ||
      !line.trim() ||
      _is_body_keep_line(prev) ||
      _starts_new_body_block(line) ||
      (in_zhujian && _ZHUJIAN_SENT_END_RE.test(prev))
    );
    
    if (keep_break) {
      merged.push(line);
    } else {
      merged[merged.length - 1] = prev.replace(/[ \t\u3000]+$/, '') + line.replace(/^[ \t\u3000]+/, '');
    }
  }

  // 後處理：移除緊接在圈號項目前的多餘空行
  const cleaned: string[] = [];
  for (let j = 0; j < merged.length; j++) {
    const line = merged[j];
    if (!line.trim()) {
      let nxt = '';
      for (let k = j + 1; k < merged.length; k++) {
        if (merged[k].trim()) {
          nxt = merged[k];
          break;
        }
      }
      const nxt_stripped = nxt.replace(/^[ \t\u3000]+/, '');
      if (nxt_stripped && _CIRCLED_ITEM_START_RE.test(nxt_stripped)) {
        continue; // 跳過此空行
      }
    }
    cleaned.push(line);
  }

  out.splice(body_start_idx, footer_start_idx - body_start_idx, ...cleaned);
  return out;
}

export function clean_judgment_text(full_text: string): string {
  let text = full_text.replace(/\u3000+(\r\n)/g, '$1');
  text = text.replace(_INLINE_HEADING_RE, '$1\r\n$2\r\n');
  
  const { lines, trailing_newline } = _split_lines_preserve_trailing(text);
  
  let body_start_idx: number | null = null;
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const stripped = line.replace(/^[ \t\u3000]+/, '');
    if (
      stripped.startsWith('上列') ||
      line.includes('上開當事人間') ||
      line.replace(/^\s+/, '').startsWith('列當事人間') ||
      line.includes('當事人間') ||
      line.includes('裁定如下') ||
      line.includes('判決如下')
    ) {
      body_start_idx = idx;
      break;
    }
  }
  
  if (body_start_idx === null) {
    for (let idx = 0; idx < lines.length; idx++) {
      if (idx >= 3 && _BODY_BLOCK_START_RE.test(lines[idx])) {
        body_start_idx = idx;
        break;
      }
    }
  }
  
  const normalizedLines = _normalize_header_lines(lines, body_start_idx);
  
  if (body_start_idx === null) {
    return _join_lines(normalizedLines, trailing_newline);
  }
  
  let footer_start_idx = _find_footer_start(normalizedLines, body_start_idx);
  let mergedLines = _merge_body_lines(normalizedLines, body_start_idx, footer_start_idx);
  
  footer_start_idx = _find_footer_start(mergedLines, body_start_idx);
  const footer_end_idx = _find_footer_end(mergedLines, footer_start_idx);
  
  let slicedLines = mergedLines.slice(0, footer_end_idx);
  slicedLines = _merge_footer_lines(slicedLines, footer_start_idx, footer_end_idx);
  slicedLines = _compress_body_spaces(slicedLines, body_start_idx, footer_start_idx);
  
  return _join_lines(slicedLines, trailing_newline);
}
