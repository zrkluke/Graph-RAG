import { LAW_NAMES, LAW_ALIASES, PSEUDO_LAWS, normalize_law_name } from './law_names';

const escapeRegex = (s: string) => s.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');

// 按長度降序排列，避免短名遮蔽長名（例如「民法」遮蔽「民事訴訟法」）
const _ALL_NAMES = Array.from(
  new Set<string>([
    ...LAW_NAMES,
    ...Object.keys(LAW_ALIASES),
    ...Array.from(PSEUDO_LAWS)
  ])
).sort((a, b) => b.length - a.length);

// 具名法條：白名單法律（含虛指詞）+ 第 X 條（含 之N 附號）
const LAW_ARTICLE_RE = new RegExp(
  '(' + _ALL_NAMES.map(escapeRegex).join('|') + ')\\s*(?:（[^）]*）\\s*)?第\\s*(\\d+)\\s*條(?:之\\s*(\\d+))?',
  'g'
);

// 省略法名的連續條號（含前置項款修飾詞 & 條之N 附號）
const ABBR_ARTICLE_RE = new RegExp(
  '(?:(?:第\\s*\\d+\\s*[項款目]|前段|後段|但書|本文)\\s*|[、，及與暨或,]\\s*(?!第\\s*\\d+\\s*條))*[、，及與暨或,]\\s*第\\s*(\\d+)\\s*條(?:之\\s*(\\d+))?',
  'y'
);

// ── Qualifier tokens（條號之後）──
const _ITEM_TOKEN_RE = /第\s*(\d+)\s*([項款目])/y;
const _CLAUSE_TOKEN_RE = /第\s*(\d+)\s*([款目])/y;
const _MULTI_TOKEN_RE = /第\s*(\d+)\s*[、，]\s*(\d+)\s*([項款目])/y;
const _MODIFIER_RE = /前段|後段|但書|本文/y;

// ── Abbreviated item/clause ──
const _ABBR_ITEM_RE = /[、，及與暨或,]\s*第\s*(\d+)\s*([項款目])/y;
const _ABBR_MULTI_RE = /[、，及與暨或,]\s*第\s*(\d+)\s*[、，]\s*(\d+)\s*([項款目])/y;

// 文內簡稱：例如「勞動基準法（下稱勞基法）」「民事訴訟法（簡稱民訴法）」
const ABBR_ALIAS_RE = new RegExp(
  '(' + Array.from(new Set(LAW_NAMES)).sort((a, b) => b.length - a.length).map(escapeRegex).join('|') + ')\\s*（(?:下稱|簡稱)\\s*「?([^」）]{1,20})」?）',
  'g'
);

function _extract_inline_law_aliases(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  ABBR_ALIAS_RE.lastIndex = 0;
  let match;
  while ((match = ABBR_ALIAS_RE.exec(text)) !== null) {
    const canonical = normalize_law_name(match[1]);
    const alias = normalize_law_name(match[2]);
    if (!alias || PSEUDO_LAWS.has(alias) || alias === canonical) {
      continue;
    }
    out[alias] = canonical;
  }
  return out;
}

function _parse_qualifier(text: string, startPos: number): { subRefs: string[], newPos: number } {
  _MULTI_TOKEN_RE.lastIndex = startPos;
  let m = _MULTI_TOKEN_RE.exec(text);
  if (m) {
    const unit = m[3];
    return {
      subRefs: [`第${m[1]}${unit}`, `第${m[2]}${unit}`],
      newPos: _MULTI_TOKEN_RE.lastIndex
    };
  }

  const parts: string[] = [];
  let pos = startPos;
  while (pos < text.length) {
    _ITEM_TOKEN_RE.lastIndex = pos;
    m = _ITEM_TOKEN_RE.exec(text);
    if (m) {
      parts.push(`第${m[1]}${m[2]}`);
      pos = _ITEM_TOKEN_RE.lastIndex;
      continue;
    }

    _MODIFIER_RE.lastIndex = pos;
    m = _MODIFIER_RE.exec(text);
    if (m) {
      parts.push(m[0]);
      pos = _MODIFIER_RE.lastIndex;
      break;
    }
    break;
  }

  return {
    subRefs: [parts.join('')],
    newPos: pos
  };
}

function _parse_item_extension(text: string, startPos: number): { suffix: string, newPos: number } {
  const parts: string[] = [];
  let pos = startPos;
  while (pos < text.length) {
    _CLAUSE_TOKEN_RE.lastIndex = pos;
    let m = _CLAUSE_TOKEN_RE.exec(text);
    if (m) {
      parts.push(`第${m[1]}${m[2]}`);
      pos = _CLAUSE_TOKEN_RE.lastIndex;
      continue;
    }

    _MODIFIER_RE.lastIndex = pos;
    m = _MODIFIER_RE.exec(text);
    if (m) {
      parts.push(m[0]);
      pos = _MODIFIER_RE.lastIndex;
      break;
    }
    break;
  }
  return {
    suffix: parts.join(''),
    newPos: pos
  };
}

export interface StatuteMatch {
  law: string;
  article: string;
  sub: string;
  raw: string;
}

export function extract_statutes(text: string): StatuteMatch[] {
  if (!text) {
    return [];
  }

  const inline_aliases = _extract_inline_law_aliases(text);
  const results: StatuteMatch[] = [];
  const seen = new Set<string>();
  let current_law: string | null = null;
  let current_article: string | null = null;
  let pos = 0;

  function emit(law: string, article: string, sub: string, raw: string) {
    const key = `${law}|${article}|${sub}`;
    if (!seen.has(key)) {
      seen.add(key);
      results.push({ law, article, sub, raw });
    }
  }

  while (pos < text.length) {
    // ① 省略項款（只在 chain 進行中才嘗試）
    if (current_article !== null) {
      // 多號縮略：[sep]第X、Y[項款目]
      _ABBR_MULTI_RE.lastIndex = pos;
      let m = _ABBR_MULTI_RE.exec(text);
      if (m) {
        const unit = m[3];
        for (const n of [m[1], m[2]]) {
          emit(current_law!, current_article, `第${n}${unit}`, m[0]);
        }
        pos = _ABBR_MULTI_RE.lastIndex;
        continue;
      }

      // 單號縮略：[sep]第X[項款目]
      _ABBR_ITEM_RE.lastIndex = pos;
      m = _ABBR_ITEM_RE.exec(text);
      if (m) {
        const base = `第${m[1]}${m[2]}`;
        const extRes = _parse_item_extension(text, _ABBR_ITEM_RE.lastIndex);
        const raw = text.substring(pos, extRes.newPos);
        emit(current_law!, current_article, base + extRes.suffix, raw);
        pos = extRes.newPos;
        continue;
      }
    }

    // ② 省略法名的連續條號
    if (current_law !== null) {
      ABBR_ARTICLE_RE.lastIndex = pos;
      let m = ABBR_ARTICLE_RE.exec(text);
      if (m) {
        const suf = m[2] ? `之${m[2]}` : '';
        current_article = m[1] + suf;
        const raw_art = `第${m[1]}條${suf}`;
        const qualRes = _parse_qualifier(text, ABBR_ARTICLE_RE.lastIndex);
        for (const sub of qualRes.subRefs) {
          emit(current_law, current_article, sub, raw_art);
        }
        pos = qualRes.newPos;
        continue;
      }
    }

    // ③ 具名法條（白名單比對）
    LAW_ARTICLE_RE.lastIndex = pos;
    const full = LAW_ARTICLE_RE.exec(text);
    if (!full) {
      break;
    }

    const law_raw = full[1] as string;
    const law = normalize_law_name(law_raw, inline_aliases);
    const suf = full[3] ? `之${full[3]}` : '';
    const article = full[2] + suf;

    if (PSEUDO_LAWS.has(law) || PSEUDO_LAWS.has(law_raw)) {
      if (current_law !== null) {
        current_article = article;
        const qualRes = _parse_qualifier(text, LAW_ARTICLE_RE.lastIndex);
        for (const sub of qualRes.subRefs) {
          emit(current_law, current_article, sub, full[0]);
        }
        pos = qualRes.newPos;
      } else {
        pos = LAW_ARTICLE_RE.lastIndex;
      }
    } else {
      current_law = law;
      current_article = article;
      const qualRes = _parse_qualifier(text, LAW_ARTICLE_RE.lastIndex);
      for (const sub of qualRes.subRefs) {
        emit(current_law, current_article, sub, full[0]);
      }
      pos = qualRes.newPos;
    }
  }

  return results;
}
