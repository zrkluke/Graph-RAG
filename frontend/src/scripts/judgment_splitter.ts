export interface HeadingInfo {
  role: string;
  type: string;
}

export function detect_heading(line: string): HeadingInfo | null {
  const norm = line.replace(/[ \u3000]/g, '').trim().replace(/[:：]+$/, '');
  if (!norm) return null;

  // 移除前置序號（例如：一、, ㈠, 1., 1、, 壹、, (一), ㈡等）
  let norm_stripped = norm.replace(/^[一二三四五六七八九十百壹貳參肆伍陸柒捌玖拾\d]+[、.．：:]/, '');
  norm_stripped = norm_stripped.replace(/^[㈠㈡㈢㈣㈤㈥㈦㈧㈨㈩①②③④⑤⑥⑦⑧⑨⑩⑴⑵⑶⑷⑸⑹⑺⑻⑼⑽⒈⒉⒊⒋⒌⒍⒎⒏⒐⒑]/, '');
  norm_stripped = norm_stripped.replace(/^[\(（][一二三四五六七八九十百壹貳參肆伍陸柒捌玖拾\d]+[\)）][．、.：:]?/, '');
  norm_stripped = norm_stripped.trim().replace(/[:：]+$/, '');

  // 精確匹配標準標題名稱
  if (["程序事項", "程序方面", "程序部分"].includes(norm_stripped)) {
    return { role: "court", type: "procedure" };
  }
  if (["事實概要"].includes(norm_stripped)) {
    return { role: "court", type: "facts_summary" };
  }
  if ([
    "原告主張", "原告起訴主張", "原告主張略以", "聲請人主張", 
    "上訴人主張", "原告起訴主張及聲明", "本件原告主張", 
    "公訴人起訴意旨", "起訴意旨", "告訴人起訴意旨", "原告起訴主張及聲明如下"
  ].includes(norm_stripped)) {
    return { role: "plaintiff", type: "claims" };
  }
  if ([
    "被告答辯", "被告答辯略以", "被告答辯則以", "被告抗辯", 
    "被告則以", "被告答辯及聲明", "答辯人答辯略以", "被告主張"
  ].includes(norm_stripped)) {
    return { role: "defendant", type: "claims" };
  }
  if (["兩造不爭執事項", "不爭執事項", "不爭執之事實", "不爭執事項略以"].includes(norm_stripped)) {
    return { role: "court", type: "uncontested" };
  }
  if ([
    "本院之判斷", "本院判斷", "得心證之理由", "理由", 
    "本院之見解", "本院判斷如下", "本院之判斷：", "得心證的理由"
  ].includes(norm_stripped)) {
    return { role: "court", type: "reasoning" };
  }
  if (["犯罪事實", "事實", "犯罪之事實", "背景事實"].includes(norm_stripped)) {
    return { role: "court", type: "facts" };
  }
  if (["證據能力", "證據能力部分", "關於證據能力"].includes(norm_stripped)) {
    return { role: "court", type: "evidence_ability" };
  }
  if (["論罪科刑", "量刑理由", "量刑說明"].includes(norm_stripped)) {
    return { role: "court", type: "sentencing" };
  }
  if (["沒收", "關於沒收"].includes(norm_stripped)) {
    return { role: "court", type: "confiscation" };
  }

  return null;
}

export interface Section {
  index: number;
  role: string;
  type: string;
  text: string;
  chunks: string[];
}

export function split_judgment_into_sections(case_type: string, fact_reason: string): Section[] {
  if (!fact_reason || !fact_reason.trim()) {
    return [];
  }

  const lines = fact_reason.split("\r\n");
  const sectionsTemp: { role: string; type: string; lines: string[] }[] = [];
  
  let current_section = {
    role: "court",
    type: "reasoning",
    lines: [] as string[]
  };

  for (const line of lines) {
    const heading_info = detect_heading(line);
    if (heading_info) {
      if (current_section.lines.length > 0) {
        const text = current_section.lines.join("\r\n").trim();
        if (text) {
          sectionsTemp.push({
            role: current_section.role,
            type: current_section.type,
            lines: current_section.lines
          });
        }
      }
      current_section = {
        role: heading_info.role,
        type: heading_info.type,
        lines: [line]
      };
    } else {
      current_section.lines.push(line);
    }
  }

  // 存檔最後一個區塊
  if (current_section.lines.length > 0) {
    const text = current_section.lines.join("\r\n").trim();
    if (text) {
      sectionsTemp.push({
        role: current_section.role,
        type: current_section.type,
        lines: current_section.lines
      });
    }
  }

  const final_sections: Section[] = [];
  let idx = 1;
  for (const sec of sectionsTemp) {
    const cleaned_text = sec.lines.join("\r\n").trim();
    if (cleaned_text) {
      const chunks = split_text_into_chunks(cleaned_text, 1000, 150);
      final_sections.push({
        index: idx,
        role: sec.role,
        type: sec.type,
        text: cleaned_text,
        chunks
      });
      idx++;
    }
  }

  return final_sections;
}

export function split_text_into_chunks(text: string, chunk_size: number = 1000, overlap: number = 150): string[] {
  if (!text) {
    return [];
  }

  const separators = ['\r\n\r\n', '\n\n', '\r\n', '\n', '。', '；', '，', ' ', ''];

  function _split(text_to_split: string, current_seps: string[]): string[] {
    if (text_to_split.length <= chunk_size) {
      return [text_to_split];
    }
    if (current_seps.length === 0) {
      const chunks: string[] = [];
      for (let idx = 0; idx < text_to_split.length; idx += (chunk_size - overlap)) {
        const chunk = text_to_split.substring(idx, idx + chunk_size);
        if (chunk) {
          chunks.push(chunk);
        }
      }
      return chunks;
    }

    const sep = current_seps[0];
    let parts: string[];
    if (sep === '') {
      parts = Array.from(text_to_split);
    } else {
      parts = text_to_split.split(sep);
    }

    const chunks: string[] = [];
    let current_chunk: string[] = [];
    let current_len = 0;

    for (const part of parts) {
      const part_len = part.length + sep.length;

      if (current_len + part_len <= chunk_size) {
        current_chunk.push(part);
        current_len += part_len;
      } else {
        if (current_chunk.length > 0) {
          const chunk_text = current_chunk.join(sep);
          chunks.push(chunk_text);

          // 考慮 overlap：從 current_chunk 的尾端保留部分元素
          const overlap_chunk: string[] = [];
          let overlap_len = 0;
          for (let i = current_chunk.length - 1; i >= 0; i--) {
            const p = current_chunk[i];
            if (overlap_len + p.length + sep.length <= overlap) {
              overlap_chunk.unshift(p);
              overlap_len += p.length + sep.length;
            } else {
              break;
            }
          }
          current_chunk = overlap_chunk;
          current_len = overlap_len;
        }

        if (part.length > chunk_size) {
          const sub_chunks = _split(part, current_seps.slice(1));
          for (let i = 0; i < sub_chunks.length - 1; i++) {
            chunks.push(sub_chunks[i]);
          }
          if (sub_chunks.length > 0) {
            const last_sc = sub_chunks[sub_chunks.length - 1];
            current_chunk.push(last_sc);
            current_len += last_sc.length + sep.length;
          }
        } else {
          current_chunk.push(part);
          current_len += part_len;
        }
      }
    }

    if (current_chunk.length > 0) {
      chunks.push(current_chunk.join(sep));
    }

    return chunks;
  }

  return _split(text, separators);
}
