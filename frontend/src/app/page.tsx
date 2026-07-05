"use client";

import React, { useState } from 'react';
import GraphNetwork from '@/components/GraphNetwork';

interface ResultItem {
  id: string;
  court: string;
  courtLevel: string;
  caseType: string;
  reason: string;
  mainText: string;
  factReason: string;
  maxSectionScore: number;
  searchScore?: number;
  judges: string[];
  defendants: string[];
  plaintiffs: string[];
  citedLaws: string[];
  community?: number | null;
  communityName?: string | null;
  similarRecommendations?: {
    id: string;
    court: string;
    reason: string;
    date: string;
    sharedLawCount: number;
  }[];
}

interface SearchResultGroup {
  results: ResultItem[];
  responseTimeMs: number;
}

interface MultiAlgorithmResults {
  keyword?: SearchResultGroup;
  vector?: SearchResultGroup;
  hybrid?: SearchResultGroup;
}

// ==========================================
// 智慧高亮與法條跳轉演算法 (Token-based Entity Highlighting)
// ==========================================
function highlightText(
  text: string,
  defendants: string[] = [],
  plaintiffs: string[] = [],
  judges: string[] = [],
  citedLaws: string[] = []
): string {
  if (!text) return "";
  let highlighted = text;

  // 用於暫存 HTML 標籤的對照表，防止多次替換或巢狀標籤破壞結構
  const replacements: { token: string; html: string }[] = [];
  let tokenCounter = 0;

  // 1. 高亮法條 (依字串長度由長到短排序，避免短法條名稱破壞長法條)
  const sortedLaws = [...citedLaws]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  sortedLaws.forEach((law) => {
    const escapedLaw = law.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
    const regex = new RegExp(escapedLaw, 'g');
    const token = `___TOKEN_LAW_${tokenCounter}___`;
    const encodedLaw = encodeURIComponent(law);
    const html = `<a href="https://law.moj.gov.tw/Search/SearchLawSingle.aspx?keyword=${encodedLaw}" target="_blank" rel="noopener noreferrer" class="bg-blue-50 text-blue-700 font-bold px-1.5 py-0.5 rounded border border-blue-200 hover:bg-blue-100 hover:text-blue-800 transition-colors mx-0.5 inline-flex items-center gap-0.5 cursor-pointer">${law} 🔗</a>`;

    if (regex.test(highlighted)) {
      highlighted = highlighted.replace(regex, token);
      replacements.push({ token, html });
      tokenCounter++;
    }
  });

  // 2. 高亮被告 (只高亮長度大於或等於 2 的名字)
  const sortedDefs = [...defendants]
    .filter((d) => d && d.length >= 2)
    .sort((a, b) => b.length - a.length);

  sortedDefs.forEach((d) => {
    const regex = new RegExp(d, 'g');
    const token = `___TOKEN_DEF_${tokenCounter}___`;
    const html = `<span class="bg-rose-50 text-rose-700 font-bold px-1.5 py-0.5 rounded border border-rose-200 mx-0.5">${d} (被告)</span>`;

    if (regex.test(highlighted)) {
      highlighted = highlighted.replace(regex, token);
      replacements.push({ token, html });
      tokenCounter++;
    }
  });

  // 3. 高亮原告
  const sortedPlfs = [...plaintiffs]
    .filter((p) => p && p.length >= 2)
    .sort((a, b) => b.length - a.length);

  sortedPlfs.forEach((p) => {
    const regex = new RegExp(p, 'g');
    const token = `___TOKEN_PLA_${tokenCounter}___`;
    const html = `<span class="bg-emerald-50 text-emerald-700 font-bold px-1.5 py-0.5 rounded border border-emerald-200 mx-0.5">${p} (原告)</span>`;

    if (regex.test(highlighted)) {
      highlighted = highlighted.replace(regex, token);
      replacements.push({ token, html });
      tokenCounter++;
    }
  });

  // 4. 高亮法官
  const sortedJudges = [...judges]
    .filter((j) => j && j.length >= 2)
    .sort((a, b) => b.length - a.length);

  sortedJudges.forEach((j) => {
    const regex = new RegExp(j, 'g');
    const token = `___TOKEN_JUD_${tokenCounter}___`;
    const html = `<span class="bg-amber-50 text-amber-700 font-bold px-1.5 py-0.5 rounded border border-amber-200 mx-0.5">${j} (法官)</span>`;

    if (regex.test(highlighted)) {
      highlighted = highlighted.replace(regex, token);
      replacements.push({ token, html });
      tokenCounter++;
    }
  });

  // 5. 先將換行符轉為 HTML 的 br，再還原所有的 HTML 高亮標籤
  let finalHtml = highlighted.replace(/\r\n|\n/g, '<br/>');
  replacements.forEach(({ token, html }) => {
    finalHtml = finalHtml.split(token).join(html);
  });

  return finalHtml;
}

// ==========================================
// 骨架屏載入元件 (Skeleton Loaders)
// ==========================================
function SearchSkeleton() {
  return (
    <div className="flex flex-col gap-3 w-full animate-pulse">
      {[1, 2, 3].map((i) => (
        <div key={i} className="bg-white border border-slate-200 rounded-xl p-4 flex flex-col gap-3">
          <div className="h-4 bg-slate-200 rounded w-3/4"></div>
          <div className="h-3 bg-slate-200 rounded w-1/2"></div>
          <div className="flex gap-2">
            <div className="h-5 bg-slate-200 rounded w-16"></div>
            <div className="h-5 bg-slate-200 rounded w-16"></div>
          </div>
        </div>
      ))}
    </div>
  );
}

function VerdictReaderSkeleton() {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6 flex flex-col gap-6 w-full animate-pulse h-full">
      <div className="flex justify-between items-center pb-4 border-b border-slate-100">
        <div className="flex flex-col gap-2 w-2/3">
          <div className="h-6 bg-slate-200 rounded w-full"></div>
          <div className="h-4 bg-slate-200 rounded w-1/2"></div>
        </div>
        <div className="h-8 bg-slate-200 rounded w-20"></div>
      </div>
      <div className="flex gap-2">
        <div className="h-6 bg-slate-200 rounded w-16"></div>
        <div className="h-6 bg-slate-200 rounded w-20"></div>
        <div className="h-6 bg-slate-200 rounded w-24"></div>
      </div>
      <div className="flex flex-col gap-3 pt-4 border-t border-slate-100">
        <div className="h-4 bg-slate-200 rounded w-1/4"></div>
        <div className="h-20 bg-slate-200 rounded w-full"></div>
      </div>
      <div className="flex-1 flex flex-col gap-3">
        <div className="h-4 bg-slate-200 rounded w-1/4"></div>
        <div className="h-40 bg-slate-200 rounded w-full"></div>
      </div>
    </div>
  );
}

// ==========================================
// 智慧判決書閱讀器元件 (VerdictReader)
// ==========================================
interface VerdictReaderProps {
  item: ResultItem;
  onSimilarClick: (id: string) => void;
  onClose?: () => void;
}

function VerdictReader({ item, onSimilarClick, onClose }: VerdictReaderProps) {
  const highlightedMainText = highlightText(
    item.mainText,
    item.defendants,
    item.plaintiffs,
    item.judges,
    item.citedLaws
  );

  const highlightedFactReason = highlightText(
    item.factReason,
    item.defendants,
    item.plaintiffs,
    item.judges,
    item.citedLaws
  );

  // 錨點滾動
  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div className="flex flex-col md:flex-row gap-6 h-full bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
      {/* 左側：段落目錄導航 (TOC) */}
      <div className="hidden md:flex flex-col w-44 border-r border-slate-100 p-5 bg-slate-50/50 flex-shrink-0">
        <span className="text-[11px] font-black text-slate-400 tracking-wider block mb-4 uppercase">閱讀導航</span>
        <div className="flex flex-col gap-2">
          <button
            onClick={() => scrollToSection(`verdict-basic-${item.id}`)}
            className="text-left text-xs font-bold text-slate-600 hover:text-blue-600 py-2 px-3 rounded-lg hover:bg-white transition-all flex items-center gap-1.5 border border-transparent hover:border-slate-100 cursor-pointer"
          >
            📋 基本資訊
          </button>
          <button
            onClick={() => scrollToSection(`verdict-main-${item.id}`)}
            className="text-left text-xs font-bold text-slate-600 hover:text-blue-600 py-2 px-3 rounded-lg hover:bg-white transition-all flex items-center gap-1.5 border border-transparent hover:border-slate-100 cursor-pointer"
          >
            📢 判決主文
          </button>
          <button
            onClick={() => scrollToSection(`verdict-facts-${item.id}`)}
            className="text-left text-xs font-bold text-slate-600 hover:text-blue-600 py-2 px-3 rounded-lg hover:bg-white transition-all flex items-center gap-1.5 border border-transparent hover:border-slate-100 cursor-pointer"
          >
            📝 事實與理由
          </button>
          {item.similarRecommendations && item.similarRecommendations.length > 0 && (
            <button
              onClick={() => scrollToSection(`verdict-recommendations-${item.id}`)}
              className="text-left text-xs font-bold text-slate-600 hover:text-blue-600 py-2 px-3 rounded-lg hover:bg-white transition-all flex items-center gap-1.5 border border-transparent hover:border-slate-100 cursor-pointer"
            >
              🔗 相似案例
            </button>
          )}
        </div>
      </div>

      {/* 右側：判決書本文 */}
      <div className="flex-grow flex flex-col min-w-0 h-full overflow-hidden">
        {/* 頂部 Header */}
        <div className="flex justify-between items-center p-5 border-b border-slate-100 bg-white sticky top-0 z-10">
          <div className="min-w-0 pr-3">
            <h3 className="font-extrabold text-slate-800 text-sm md:text-base leading-snug truncate">
              ⚖️ {item.court} ── {item.id}
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">案由：{item.reason || '未載明'}</p>
          </div>
          <div className="flex items-center gap-3 flex-shrink-0">
            {item.community !== null && item.community !== undefined && (
              <span
                className="text-[10px] px-2 py-0.5 rounded font-black text-white shadow-sm"
                style={{ backgroundColor: `hsl(${(item.community! * 137.5) % 360}, 80%, 45%)` }}
              >
                社群 {item.community}
              </span>
            )}
            {onClose && (
              <button
                onClick={onClose}
                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors border border-slate-200/60 cursor-pointer"
                aria-label="關閉"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* 內容區 */}
        <div className="flex-grow overflow-y-auto p-6 md:p-8 flex flex-col gap-6 scroll-smooth">
          {/* 基本資訊 */}
          <div id={`verdict-basic-${item.id}`} className="flex flex-col gap-3 pb-5 border-b border-slate-100">
            <div className="flex flex-wrap gap-1.5 text-[11px] font-bold">
              <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded border border-blue-100">📂 {item.caseType}</span>
              <span className="bg-purple-50 text-purple-700 px-2 py-0.5 rounded border border-purple-100">🏛️ {item.courtLevel}</span>
              <span className="bg-rose-50/50 text-rose-700 px-2 py-0.5 rounded border border-rose-100">
                👤 法官：{item.judges.length > 0 ? item.judges.join('，') : '未載明'}
              </span>
            </div>

            <div className="text-xs text-slate-700 bg-slate-50/50 p-4 rounded-xl border border-slate-100 flex flex-col gap-2.5">
              <div>
                👤 <b>當事人關係：</b>
                被告 <span className="text-rose-700 font-bold">{item.defendants.length > 0 ? item.defendants.join('，') : '無'}</span> | 
                原告 <span className="text-emerald-700 font-bold">{item.plaintiffs.length > 0 ? item.plaintiffs.join('，') : '無'}</span>
              </div>
              <div className="flex flex-wrap gap-1.5 items-center">
                <span>📖 <b>引用法規：</b></span>
                {item.citedLaws.length > 0 ? (
                  item.citedLaws.map((law) => {
                    const encodedLaw = encodeURIComponent(law);
                    return (
                      <a
                        key={law}
                        href={`https://law.moj.gov.tw/Search/SearchLawSingle.aspx?keyword=${encodedLaw}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="bg-white text-slate-700 hover:text-blue-600 hover:border-blue-300 px-2 py-0.5 rounded border border-slate-200 text-[10px] font-bold transition-all inline-flex items-center gap-0.5 cursor-pointer"
                      >
                        {law} 🔗
                      </a>
                    );
                  })
                ) : (
                  <span className="text-slate-400">無</span>
                )}
              </div>
            </div>
          </div>

          {/* 判決主文 */}
          <div id={`verdict-main-${item.id}`} className="flex flex-col gap-2.5">
            <span className="font-extrabold text-slate-800 text-sm flex items-center gap-1.5">
              <span className="w-1.5 h-3.5 bg-blue-600 rounded-full"></span> 📢 判決主文
            </span>
            <div className="bg-blue-50/20 border-l-4 border-blue-600 p-4 rounded-r-xl text-xs md:text-sm text-slate-800 leading-relaxed font-semibold">
              <p dangerouslySetInnerHTML={{ __html: highlightedMainText }} />
            </div>
          </div>

          {/* 事實及理由 */}
          <div id={`verdict-facts-${item.id}`} className="flex flex-col gap-2.5 pt-2">
            <span className="font-extrabold text-slate-800 text-sm flex items-center gap-1.5">
              <span className="w-1.5 h-3.5 bg-blue-600 rounded-full"></span> 📝 事實及理由全文
            </span>
            <div className="bg-slate-50/50 border border-slate-100 p-5 rounded-xl text-xs md:text-sm text-slate-600 leading-relaxed">
              <p dangerouslySetInnerHTML={{ __html: highlightedFactReason }} />
            </div>
          </div>

          {/* 相似案例 */}
          {item.similarRecommendations && item.similarRecommendations.length > 0 && (
            <div id={`verdict-recommendations-${item.id}`} className="mt-4 pt-4 border-t border-slate-100">
              <span className="text-[11px] font-black text-slate-400 block mb-3 uppercase tracking-wider">🔗 相似案例推薦 (共享最多法規)</span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {item.similarRecommendations.map((sim) => (
                  <div
                    key={sim.id}
                    onClick={() => onSimilarClick(sim.id)}
                    className="text-xs bg-white hover:bg-blue-50/30 border border-slate-200 hover:border-blue-300 p-3 rounded-xl cursor-pointer flex flex-col gap-1 transition-all group shadow-sm hover:shadow"
                  >
                    <div className="flex justify-between items-start gap-2">
                      <span className="font-bold text-slate-700 group-hover:text-blue-700 line-clamp-1">
                        👉 {sim.court}
                      </span>
                      <span className="bg-blue-100/50 text-blue-700 text-[10px] px-1.5 py-0.5 rounded font-black flex-shrink-0">
                        共享 {sim.sharedLawCount} 條
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-400 line-clamp-1">案號：{sim.id.split(',').slice(-1)[0]}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ==========================================
// 主首頁元件 (Home)
// ==========================================
export default function Home() {
  // 搜尋與篩選狀態
  const [query, setQuery] = useState('');
  const [courtLevel, setCourtLevel] = useState('全部');
  const [caseType, setCaseType] = useState('全部');
  const [limit, setLimit] = useState(3);

  // 進階篩選狀態
  const [court, setCourt] = useState('');
  const [judge, setJudge] = useState('');
  const [citedLaw, setCitedLaw] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  // 佈局模式與選取狀態
  const [layoutMode, setLayoutMode] = useState<'classic' | 'compare'>('classic');
  const [selectedItem, setSelectedItem] = useState<ResultItem | null>(null);

  // 三種檢索演算法結果
  const [algoResults, setAlgoResults] = useState<MultiAlgorithmResults>({});
  const [searchedQuery, setSearchedQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'cards' | 'graph'>('cards');
  const [cacheHit, setCacheHit] = useState<boolean | null>(null);
  const [executionTimeMs, setExecutionTimeMs] = useState<number | null>(null);

  // Accordion 展開狀態管理 (比對模式下使用)
  const [expandedIds, setExpandedIds] = useState<Record<string, boolean>>({});

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  };

  // 執行 API 檢索的核心函數
  const triggerSearch = async (searchQuery: string) => {
    if (!searchQuery.trim()) {
      setError('請輸入要搜尋的犯罪或糾紛情境描述！');
      return;
    }

    setLoading(true);
    setError('');
    setCacheHit(null);
    setExecutionTimeMs(null);

    try {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: searchQuery.trim(),
          courtLevel,
          caseType,
          limit,
          court: court.trim(),
          judge: judge.trim(),
          citedLaw: citedLaw.trim(),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || '後端檢索失敗');
      }

      setAlgoResults({
        keyword: data.keyword,
        vector: data.vector,
        hybrid: data.hybrid,
      });
      setCacheHit(data.cacheHit ?? false);
      setExecutionTimeMs(data.executionTimeMs ?? null);
      setSearchedQuery(searchQuery.trim());

      // 預設將混合檢索的第一筆設為當前選中的項目
      if (data.hybrid?.results && data.hybrid.results.length > 0) {
        setSelectedItem(data.hybrid.results[0]);
      } else {
        setSelectedItem(null);
      }

      // 搜尋完成後，比對模式預設展開前幾個最相關的項目
      const initialExpands: Record<string, boolean> = {};
      const allItems = [
        ...(data.keyword?.results || []),
        ...(data.vector?.results || []),
        ...(data.hybrid?.results || []),
      ];
      allItems.slice(0, 2).forEach((item) => {
        initialExpands[item.id] = true;
      });
      setExpandedIds(initialExpands);

    } catch (err: any) {
      console.error(err);
      setError(err.message || '連線至 API 發生錯誤');
    } finally {
      setLoading(false);
    }
  };

  // 表單送出
  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    triggerSearch(query);
  };

  // 點擊相似案例推薦時觸發二次搜尋
  const handleSimilarClick = (simId: string) => {
    setQuery(simId);
    triggerSearch(simId);
  };

  // 統計召回結果中引用最多次的法條 (基於混合檢索 Hybrid 的 Top 3)
  const getTopLaws = () => {
    const counts: Record<string, number> = {};
    const hybridResults = algoResults.hybrid?.results || [];
    hybridResults.forEach((r) => {
      r.citedLaws.forEach((law) => {
        counts[law] = (counts[law] || 0) + 1;
      });
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
  };

  const topLaws = getTopLaws();

  // 是否有任何檢索結果
  const hasResults = !!(
    algoResults.keyword?.results?.length ||
    algoResults.vector?.results?.length ||
    algoResults.hybrid?.results?.length
  );

  // 渲染單個 Accordion 項目的卡片 (比對對照模式下使用)
  const renderAccordionItem = (r: ResultItem, scoreLabel: string, scoreVal: number) => {
    const isExpanded = !!expandedIds[r.id];
    const hasCommunity = r.community !== null && r.community !== undefined;
    const communityHue = hasCommunity ? (r.community! * 137.5) % 360 : 0;
    const communityColorStyle = hasCommunity
      ? { borderLeft: `5px solid hsl(${communityHue}, 80%, 55%)` }
      : { borderLeft: '5px solid #cbd5e1' };

    return (
      <div
        key={r.id}
        className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-all duration-200"
        style={communityColorStyle}
      >
        <button
          onClick={() => toggleExpand(r.id)}
          className="w-full px-4 py-3 flex justify-between items-center text-left hover:bg-slate-50 transition-colors cursor-pointer"
        >
          <div className="flex-1 pr-3">
            <span className="font-extrabold text-slate-800 text-xs md:text-sm leading-normal line-clamp-1">
              ⚖️ {r.court} ── {r.id}
            </span>
            <div className="flex gap-2 items-center mt-1">
              <span className="text-[10px] text-slate-400">案由：{r.reason || '未載明'}</span>
              {hasCommunity && (
                <span
                  className="text-[9px] px-1.5 py-0.2 rounded font-bold text-white shadow-sm"
                  style={{ backgroundColor: `hsl(${communityHue}, 80%, 45%)` }}
                  title={r.communityName || `Leiden 社群 ${r.community}`}
                >
                  {r.communityName || `社群 ${r.community}`}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded font-bold border border-slate-200/50">
              {scoreLabel} {scoreVal.toFixed(3)}
            </span>
            <span className="text-slate-400 text-xs">
              {isExpanded ? '▲' : '▼'}
            </span>
          </div>
        </button>

        {isExpanded && (
          <div className="px-4 pb-4 pt-2 border-t border-slate-100 bg-white flex flex-col gap-3">
            <div className="flex flex-wrap gap-1.5 text-[10px] font-semibold">
              <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded">📂 {r.caseType}</span>
              <span className="bg-purple-50 text-purple-700 px-2 py-0.5 rounded">🏛️ {r.courtLevel}</span>
              <span className="bg-rose-50/50 text-rose-700 px-2 py-0.5 rounded">
                👤 法官：{r.judges.length > 0 ? r.judges.join('，') : '未載明'}
              </span>
            </div>

            <div className="text-xs text-slate-600 leading-normal">
              👤 <b>當事人：</b>
              被告 <span className="text-red-600 font-bold">{r.defendants.length > 0 ? r.defendants.join('，') : '無'}</span> | 
              原告 <span className="text-green-600 font-bold">{r.plaintiffs.length > 0 ? r.plaintiffs.join('，') : '無'}</span>
            </div>

            <div className="bg-slate-50 border-l-2 border-blue-500 p-3 rounded-r-lg text-xs text-slate-800 leading-relaxed">
              <span className="font-bold block mb-1">📢 判決主文：</span>
              <p className="line-clamp-4" dangerouslySetInnerHTML={{ __html: r.mainText.replace(/\r\n|\n/g, '<br/>') }} />
              <div className="mt-2.5 flex justify-end">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedItem(r);
                  }}
                  className="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold text-[10px] shadow-sm hover:shadow transition-all flex items-center gap-1 cursor-pointer"
                >
                  📖 閱讀完整判決書全文
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      {/* 頂部 Header */}
      <header className="bg-white border-b border-slate-200 py-5 px-8 shadow-sm">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-3xl">⚖️</span>
            <div>
              <h1 className="font-extrabold text-xl text-slate-800 tracking-tight">智慧型法律判決書 Graph RAG 搜尋系統</h1>
              <p className="text-xs text-slate-500 mt-0.5">基於 Next.js Serverless + Neo4j AuraDB 雲端混合架構</p>
            </div>
          </div>
          <span className="text-xs px-2.5 py-1 bg-green-50 text-green-700 rounded-full font-semibold border border-green-200">
            🟢 雲端資料庫已連線
          </span>
        </div>
      </header>

      {/* 主內容區 */}
      <main className="flex-1 max-w-7xl mx-auto w-full p-6 lg:p-8 flex flex-col lg:flex-row gap-6">
        
        {/* 左側搜尋配置 */}
        <section className="w-full lg:w-80 flex-shrink-0 flex flex-col gap-5">
          <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-sm flex flex-col gap-4">
            <div className="border-l-4 border-blue-600 pl-2.5">
              <h2 className="font-bold text-slate-800 text-lg">🔍 搜尋配置</h2>
            </div>

            <form onSubmit={handleSearch} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <label className="text-sm font-semibold text-slate-700">情境或犯罪描述</label>
                <textarea
                  className="w-full p-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-slate-50/50 resize-y"
                  placeholder="請輸入例如：被告酒後騎乘機車，被警察攔檢酒精濃度超標並肇事逃逸..."
                  rows={5}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-700">法院層級</label>
                  <select
                    className="p-2 border border-slate-200 rounded-xl text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                    value={courtLevel}
                    onChange={(e) => setCourtLevel(e.target.value)}
                  >
                    <option>全部</option>
                    <option>地方法院</option>
                    <option>高等法院</option>
                    <option>最高法院</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-700">案件種類</label>
                  <select
                    className="p-2 border border-slate-200 rounded-xl text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                    value={caseType}
                    onChange={(e) => setCaseType(e.target.value)}
                  >
                    <option>全部</option>
                    <option>民事</option>
                    <option>刑事</option>
                    <option>行政</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-col gap-1.5">
                <div className="flex justify-between text-xs font-semibold text-slate-700">
                  <span>顯示結果筆數</span>
                  <span className="text-blue-600">{limit} 筆</span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={10}
                  className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                  value={limit}
                  onChange={(e) => setLimit(Number(e.target.value))}
                />
              </div>

              {/* 進階篩選按鈕 */}
              <div className="border-t border-slate-100 pt-3">
                <button
                  type="button"
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="flex items-center justify-between w-full text-left text-xs font-bold text-slate-500 hover:text-blue-600 transition-colors cursor-pointer"
                >
                  <span>🛠️ 進階篩選條件</span>
                  <span>{showAdvanced ? '▲' : '▼'}</span>
                </button>
              </div>

              {/* 進階篩選面板 */}
              {showAdvanced && (
                <div className="flex flex-col gap-3.5 bg-slate-50 p-3 rounded-xl border border-slate-200/60 animate-fadeIn">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-slate-500">指定法院</label>
                    <input
                      type="text"
                      className="p-2 border border-slate-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="例：臺灣臺北地方法院"
                      value={court}
                      onChange={(e) => setCourt(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-slate-500">指定法官</label>
                    <input
                      type="text"
                      className="p-2 border border-slate-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="例：陳筠諼"
                      value={judge}
                      onChange={(e) => setJudge(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-slate-500">指定引用法規</label>
                    <input
                      type="text"
                      className="p-2 border border-slate-200 rounded-lg text-xs bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                      placeholder="例：中華民國刑法第185-3條"
                      value={citedLaw}
                      onChange={(e) => setCitedLaw(e.target.value)}
                    />
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 disabled:bg-slate-300 disabled:shadow-none cursor-pointer"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin h-5 w-5 text-white" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    <span>正在進行三種檢索...</span>
                  </>
                ) : (
                  <span>🚀 開始檢索</span>
                )}
              </button>
            </form>

            {error && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-xl font-medium">
                ⚠️ {error}
              </div>
            )}

            <div className="p-4 bg-slate-50 border border-slate-100 rounded-xl text-xs text-slate-500 leading-relaxed">
              💡 <b>搜尋說明：</b><br />
              系統會並行查詢並對比：<br />
              1. <b>全文檢索</b> (詞庫索引匹配)<br />
              2. <b>向量檢索</b> (語意嵌入距離)<br />
              3. <b>混合檢索</b> (RRF 重排序)<br />
              且能呈現各自的運算耗時差異。
            </div>
          </div>
        </section>

        {/* 右側結果展示區 */}
        <section className="flex-1 flex flex-col gap-5 min-w-0">
          <div className="border-l-4 border-blue-600 pl-2.5 flex justify-between items-center flex-wrap gap-2">
            <h2 className="font-bold text-slate-800 text-lg">📋 匹配結果與圖譜統計</h2>
            {cacheHit !== null && (
              <div className="flex items-center gap-2 text-xs font-bold">
                {cacheHit ? (
                  <span className="bg-emerald-100 text-emerald-800 border border-emerald-300 px-2 py-0.5 rounded-full flex items-center gap-0.5 shadow-sm">
                    ⚡ 快取命中 (Redis Cache Hit)
                  </span>
                ) : (
                  <span className="bg-blue-100 text-blue-800 border border-blue-300 px-2 py-0.5 rounded-full flex items-center gap-0.5 shadow-sm">
                    🔍 即時檢索 (Neo4j Search)
                  </span>
                )}
                {executionTimeMs !== null && (
                  <span className="bg-slate-100 text-slate-700 border border-slate-300 px-2 py-0.5 rounded-full shadow-sm">
                    ⏱️ API 總耗時: {executionTimeMs} ms
                  </span>
                )}
              </div>
            )}
          </div>

          {!hasResults ? (
            <div className="flex-grow bg-white rounded-2xl border border-slate-200 border-dashed p-16 flex flex-col items-center justify-center text-slate-400 gap-4 min-h-[400px]">
              <span className="text-5xl">💡</span>
              <p className="text-sm font-medium">請在左側輸入犯罪或糾紛情境描述，並點選「開始檢索」查閱結果。</p>
            </div>
          ) : (
            <div className="flex-grow flex flex-col gap-5 min-w-0">
              
              {/* Dashboard 摘要 */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 rounded-xl bg-gradient-to-br from-blue-50 to-blue-100/50 border border-blue-200/60 shadow-sm">
                  <span className="text-xs font-bold text-blue-800 block mb-1">🎯 混合檢索結果筆數</span>
                  <div className="text-2xl font-black text-blue-700">
                    {algoResults.hybrid?.results?.length || 0} <span className="text-sm font-medium">筆</span>
                  </div>
                </div>
                <div className="p-4 rounded-xl bg-gradient-to-br from-green-50 to-green-100/50 border border-green-200/60 shadow-sm md:col-span-2">
                  <span className="text-xs font-bold text-green-800 block mb-1">📚 混合核心關聯法條 (Top 3)</span>
                  <div className="text-sm font-bold text-green-700 leading-normal truncate">
                    {topLaws.length > 0
                      ? topLaws.map(([law, count]) => `${law} (${count}次)`).join('，')
                      : '無關聯法條數據'}
                  </div>
                </div>
              </div>

              {/* 控制與佈局切換列 */}
              <div className="flex flex-col sm:flex-row justify-between items-stretch sm:items-center gap-3 border-b border-slate-200 pb-1">
                {/* Tabs 標籤頁 */}
                <div className="flex gap-2">
                  <button
                    onClick={() => setActiveTab('cards')}
                    className={`px-4 py-2 font-bold text-sm border-b-2 transition-all cursor-pointer ${
                      activeTab === 'cards'
                        ? 'border-blue-600 text-blue-600'
                        : 'border-transparent text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    📋 匹配結果對照
                  </button>
                  <button
                    onClick={() => setActiveTab('graph')}
                    className={`px-4 py-2 font-bold text-sm border-b-2 transition-all cursor-pointer ${
                      activeTab === 'graph'
                        ? 'border-blue-600 text-blue-600'
                        : 'border-transparent text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    🕸️ 關聯圖譜網絡
                  </button>
                </div>

                {/* 經典/比對佈局切換 */}
                {activeTab === 'cards' && !loading && (
                  <div className="flex bg-slate-100 p-1 rounded-xl gap-1 border border-slate-200/50">
                    <button
                      onClick={() => {
                        setLayoutMode('classic');
                        const hybridResults = algoResults.hybrid?.results || [];
                        if (hybridResults.length > 0 && !selectedItem) {
                          setSelectedItem(hybridResults[0]);
                        }
                      }}
                      className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                        layoutMode === 'classic'
                          ? 'bg-white text-blue-600 shadow-sm'
                          : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      📖 經典雙欄閱讀
                    </button>
                    <button
                      onClick={() => setLayoutMode('compare')}
                      className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                        layoutMode === 'compare'
                          ? 'bg-white text-blue-600 shadow-sm'
                          : 'text-slate-500 hover:text-slate-700'
                      }`}
                    >
                      🔬 演算法三欄比對
                    </button>
                  </div>
                )}
              </div>

              {/* 骨架屏載入狀態 */}
              {loading ? (
                activeTab === 'cards' ? (
                  layoutMode === 'compare' ? (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
                      {[1, 2, 3].map((idx) => (
                        <div key={idx} className="flex flex-col gap-4 bg-slate-50/40 p-3 rounded-2xl border border-slate-200/60">
                          <div className="h-4 bg-slate-200 rounded w-1/2 animate-pulse mb-2"></div>
                          <SearchSkeleton />
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                      <div className="lg:col-span-1 bg-slate-50/40 p-4 rounded-2xl border border-slate-200/60">
                        <div className="h-4 bg-slate-200 rounded w-2/3 animate-pulse mb-3"></div>
                        <SearchSkeleton />
                      </div>
                      <div className="lg:col-span-2 h-[600px]">
                        <VerdictReaderSkeleton />
                      </div>
                    </div>
                  )
                ) : (
                  <div className="w-full bg-white rounded-2xl border border-slate-200 p-16 flex items-center justify-center">
                    <svg className="animate-spin h-8 w-8 text-blue-600" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  </div>
                )
              ) : (
                /* Tab 內容：卡片展示 */
                activeTab === 'cards' && (
                  layoutMode === 'compare' ? (
                    /* 演算法三欄比對佈局 */
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
                      {/* 全文檢索 */}
                      <div className="flex flex-col gap-4 bg-slate-50/40 p-3 rounded-2xl border border-slate-200/60">
                        <div className="flex justify-between items-center border-b border-slate-200 pb-2">
                          <span className="font-extrabold text-xs md:text-sm text-slate-700 flex items-center gap-1">
                            📝 全文關鍵字檢索
                          </span>
                          <span className="text-[10px] bg-emerald-50 text-emerald-700 font-extrabold px-2 py-0.5 rounded border border-emerald-200">
                            ⚡ {algoResults.keyword?.responseTimeMs || 0} ms
                          </span>
                        </div>
                        <div className="flex flex-col gap-3">
                          {algoResults.keyword?.results && algoResults.keyword.results.length > 0 ? (
                            algoResults.keyword.results.map((r) =>
                              renderAccordionItem(r, 'Score', r.searchScore || 0)
                            )
                          ) : (
                            <div className="text-center text-xs text-slate-400 py-8">無匹配結果</div>
                          )}
                        </div>
                      </div>

                      {/* 向量檢索 */}
                      <div className="flex flex-col gap-4 bg-slate-50/40 p-3 rounded-2xl border border-slate-200/60">
                        <div className="flex justify-between items-center border-b border-slate-200 pb-2">
                          <span className="font-extrabold text-xs md:text-sm text-slate-700 flex items-center gap-1">
                            🎯 純向量語意檢索
                          </span>
                          <span className="text-[10px] bg-emerald-50 text-emerald-700 font-extrabold px-2 py-0.5 rounded border border-emerald-200">
                            ⚡ {algoResults.vector?.responseTimeMs || 0} ms
                          </span>
                        </div>
                        <div className="flex flex-col gap-3">
                          {algoResults.vector?.results && algoResults.vector.results.length > 0 ? (
                            algoResults.vector.results.map((r) =>
                              renderAccordionItem(r, 'Cosine', r.searchScore || 0)
                            )
                          ) : (
                            <div className="text-center text-xs text-slate-400 py-8">無匹配結果</div>
                          )}
                        </div>
                      </div>

                      {/* 混合檢索 (RRF) */}
                      <div className="flex flex-col gap-4 bg-blue-50/20 p-3 rounded-2xl border border-blue-200/50 shadow-sm ring-1 ring-blue-100">
                        <div className="flex justify-between items-center border-b border-blue-150 pb-2">
                          <span className="font-extrabold text-xs md:text-sm text-blue-800 flex items-center gap-1">
                            ⭐ 混合檢索 (RRF 重排)
                          </span>
                          <span className="text-[10px] bg-blue-50 text-blue-700 font-extrabold px-2 py-0.5 rounded border border-blue-200">
                            ⚡ {algoResults.hybrid?.responseTimeMs || 0} ms
                          </span>
                        </div>
                        <div className="flex flex-col gap-3">
                          {algoResults.hybrid?.results && algoResults.hybrid.results.length > 0 ? (
                            algoResults.hybrid.results.map((r) =>
                              renderAccordionItem(r, 'RRF', (r as any).rrfScore || 0)
                            )
                          ) : (
                            <div className="text-center text-xs text-slate-400 py-8">無匹配結果</div>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* 經典雙欄閱讀佈局 */
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-stretch min-h-[500px]">
                      {/* 左欄：簡潔卡片清單 (RRF) */}
                      <div className="lg:col-span-1 flex flex-col gap-4 bg-slate-50/40 p-4 rounded-2xl border border-slate-200/60 max-h-[700px] overflow-y-auto">
                        <div className="flex justify-between items-center border-b border-slate-200 pb-2">
                          <span className="font-extrabold text-xs md:text-sm text-blue-850 flex items-center gap-1">
                            ⭐ 混合檢索結果清單
                          </span>
                          <span className="text-[10px] bg-blue-50 text-blue-700 font-extrabold px-2 py-0.5 rounded border border-blue-200">
                            ⚡ {algoResults.hybrid?.responseTimeMs || 0} ms
                          </span>
                        </div>

                        <div className="flex flex-col gap-3">
                          {algoResults.hybrid?.results && algoResults.hybrid.results.length > 0 ? (
                            algoResults.hybrid.results.map((r) => {
                              const isSelected = selectedItem?.id === r.id;
                              const hasCommunity = r.community !== null && r.community !== undefined;
                              const communityHue = hasCommunity ? (r.community! * 137.5) % 360 : 0;

                              return (
                                <div
                                  key={r.id}
                                  onClick={() => setSelectedItem(r)}
                                  className={`p-4 rounded-xl border transition-all duration-200 cursor-pointer flex flex-col gap-2 relative overflow-hidden shadow-sm hover:shadow ${
                                    isSelected
                                      ? 'bg-blue-50/40 border-blue-400 ring-1 ring-blue-300'
                                      : 'bg-white border-slate-200 hover:border-slate-300'
                                  }`}
                                  style={
                                    hasCommunity
                                      ? { borderLeft: `5px solid hsl(${communityHue}, 80%, 55%)` }
                                      : { borderLeft: '5px solid #cbd5e1' }
                                  }
                                >
                                  <div className="flex justify-between items-start gap-2">
                                    <span className={`font-extrabold text-xs leading-normal line-clamp-1 ${isSelected ? 'text-blue-800' : 'text-slate-800'}`}>
                                      ⚖️ {r.court}
                                    </span>
                                    <span className="text-[9px] bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded font-black border border-slate-200/50 flex-shrink-0">
                                      RRF {(r as any).rrfScore?.toFixed(3) || "0.016"}
                                    </span>
                                  </div>
                                  <div className="text-[11px] text-slate-500 line-clamp-2 leading-relaxed">
                                    <b>案由：</b>{r.reason || '未載明'}<br/>
                                    <b>主文：</b>{r.mainText.slice(0, 45)}...
                                  </div>
                                  <div className="flex justify-between items-center mt-1 pt-1 border-t border-slate-100 text-[10px]">
                                    <span className="text-slate-400">案號：{r.id.split(',').slice(-1)[0]}</span>
                                    {hasCommunity && (
                                      <span
                                        className="px-1.5 py-0.2 rounded font-bold text-white scale-90 origin-right"
                                        style={{ backgroundColor: `hsl(${communityHue}, 80%, 45%)` }}
                                      >
                                        社群 {r.community}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              );
                            })
                          ) : (
                            <div className="text-center text-xs text-slate-400 py-8">無匹配結果</div>
                          )}
                        </div>
                      </div>

                      {/* 右欄：智慧判決書閱讀器 */}
                      <div className="lg:col-span-2 flex flex-col max-h-[700px]">
                        {selectedItem ? (
                          <VerdictReader
                            item={selectedItem}
                            onSimilarClick={handleSimilarClick}
                          />
                        ) : (
                          <div className="flex-grow bg-white border border-slate-200 border-dashed rounded-2xl p-16 flex flex-col items-center justify-center text-slate-400 gap-4">
                            <span className="text-5xl">📖</span>
                            <p className="text-sm font-medium">請從左側點選判決書以檢視完整資訊與全文。</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                )
              )}

              {/* Tab 內容：圖譜網絡展示 */}
              {activeTab === 'graph' && !loading && (
                <GraphNetwork results={algoResults.hybrid?.results || []} query={searchedQuery} />
              )}

            </div>
          )}
        </section>

      </main>

      {/* ==========================================
          右側滑出式抽屜 (Drawer) - 用於比對模式或行動版開啟
          ========================================== */}
      {layoutMode === 'compare' && (
        <div
          className={`fixed inset-0 z-50 transition-all duration-300 ease-in-out ${
            selectedItem ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
          }`}
        >
          {/* 背景遮罩 */}
          <div
            onClick={() => setSelectedItem(null)}
            className="absolute inset-0 bg-slate-900/40 backdrop-blur-xs transition-opacity duration-300"
          />

          {/* 抽屜主體 */}
          <div
            className={`absolute inset-y-0 right-0 w-full md:w-3/5 bg-slate-50 shadow-2xl transition-transform duration-300 ease-in-out transform flex flex-col ${
              selectedItem ? 'translate-x-0' : 'translate-x-full'
            }`}
          >
            {selectedItem && (
              <div className="flex-1 overflow-hidden p-4 md:p-6 h-full">
                <VerdictReader
                  item={selectedItem}
                  onSimilarClick={(simId) => {
                    setSelectedItem(null);
                    handleSimilarClick(simId);
                  }}
                  onClose={() => setSelectedItem(null)}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
