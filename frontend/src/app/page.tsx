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

export default function Home() {
  // 搜尋與篩選狀態
  const [query, setQuery] = useState('');
  const [courtLevel, setCourtLevel] = useState('全部');
  const [caseType, setCaseType] = useState('全部');
  const [limit, setLimit] = useState(3);

  // 三種檢索演算法結果
  const [algoResults, setAlgoResults] = useState<MultiAlgorithmResults>({});
  const [searchedQuery, setSearchedQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'cards' | 'graph'>('cards');

  // Accordion 展開狀態管理 (支援多開，Key 為判決書的 ID/案號，Value 為 Boolean)
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
    
    try {
      const response = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: searchQuery.trim(),
          courtLevel,
          caseType,
          limit,
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
      setSearchedQuery(searchQuery.trim());
      
      // 搜尋完成後，預設展開前幾個最相關的項目
      const initialExpands: Record<string, boolean> = {};
      const allItems = [
        ...(data.keyword?.results || []),
        ...(data.vector?.results || []),
        ...(data.hybrid?.results || []),
      ];
      // 預設將前 2 個判決書設為展開狀態
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

  // 渲染單個 Accordion 項目的卡片
  const renderAccordionItem = (r: ResultItem, scoreLabel: string, scoreVal: number) => {
    const isExpanded = !!expandedIds[r.id];
    
    // 計算社群色彩標記 (HSL)
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
        {/* Accordion 標題按鈕：只顯示判決書的名稱 */}
        <button
          onClick={() => toggleExpand(r.id)}
          className="w-full px-4 py-3.5 flex justify-between items-center text-left hover:bg-slate-50 transition-colors"
        >
          <div className="flex-1 pr-3">
            <span className="font-extrabold text-slate-800 text-sm leading-normal line-clamp-1">
              ⚖️ {r.court} ── {r.id}
            </span>
            <div className="flex gap-2 items-center mt-1">
              <span className="text-[10px] text-slate-400">案由：{r.reason || '未載明'}</span>
              {hasCommunity && (
                <span 
                  className="text-[9px] px-1.5 py-0.2 rounded font-bold text-white shadow-sm"
                  style={{ backgroundColor: `hsl(${communityHue}, 80%, 45%)` }}
                >
                  社群 {r.community}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs bg-slate-100 text-slate-700 px-2 py-0.5 rounded font-bold border border-slate-200/50">
              {scoreLabel} {scoreVal.toFixed(3)}
            </span>
            <span className="text-slate-400 transition-transform duration-200 transform">
              {isExpanded ? '▲' : '▼'}
            </span>
          </div>
        </button>

        {/* Accordion 展開內容 */}
        {isExpanded && (
          <div className="px-4 pb-4 pt-2 border-t border-slate-100 bg-white flex flex-col gap-3">
            {/* 標籤分類 */}
            <div className="flex flex-wrap gap-1.5 text-[11px] font-semibold">
              <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded">📂 {r.caseType}</span>
              <span className="bg-purple-50 text-purple-700 px-2 py-0.5 rounded">🏛️ {r.courtLevel}</span>
              <span className="bg-rose-50/50 text-rose-700 px-2 py-0.5 rounded">
                👤 法官：{r.judges.length > 0 ? r.judges.join('，') : '未載明'}
              </span>
            </div>

            {/* 訴訟關係人 */}
            <div className="text-xs text-slate-600">
              👤 <b>當事人：</b>
              被告 <span className="text-red-600 font-bold">{r.defendants.length > 0 ? r.defendants.join('，') : '無'}</span> | 
              原告 <span className="text-green-600 font-bold">{r.plaintiffs.length > 0 ? r.plaintiffs.join('，') : '無'}</span>
            </div>

            {/* 引用法規 */}
            <div className="text-xs text-slate-600 flex flex-wrap gap-1 items-center">
              <span className="font-bold">📖 引用法規：</span>
              {r.citedLaws.length > 0 ? (
                r.citedLaws.map((law) => (
                  <span key={law} className="bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded text-[10px]">
                    {law}
                  </span>
                ))
              ) : (
                <span className="text-slate-400">無</span>
              )}
            </div>

            {/* 判決主文 */}
            <div className="bg-slate-50 border-l-2 border-blue-500 p-3 rounded-r-lg text-xs text-slate-800 leading-relaxed">
              <span className="font-bold block mb-1">📢 判決主文：</span>
              <p dangerouslySetInnerHTML={{ __html: r.mainText.replace(/\r\n|\n/g, '<br/>') }} />
            </div>

            {/* 事實及理由片段 */}
            <div className="text-xs text-slate-600 leading-relaxed">
              <span className="font-bold block mb-1">📝 事實及理由摘要：</span>
              <p className="bg-slate-50/50 border border-slate-100 p-2.5 rounded-lg text-slate-500 italic">
                {r.factReason.slice(0, 300)}...
              </p>
            </div>

            {/* 相似案例推薦區塊 (共享最多引用法規) */}
            {r.similarRecommendations && r.similarRecommendations.length > 0 && (
              <div className="mt-2 pt-2 border-t border-slate-100">
                <span className="text-[11px] font-extrabold text-slate-500 block mb-1.5">🔗 相似案例推薦 (共享最多法規)：</span>
                <div className="flex flex-col gap-1.5">
                  {r.similarRecommendations.map((sim) => (
                    <div 
                      key={sim.id}
                      onClick={() => handleSimilarClick(sim.id)}
                      className="text-xs bg-slate-50/80 hover:bg-blue-50/60 border border-slate-200/50 hover:border-blue-200/50 px-2.5 py-1.5 rounded-lg cursor-pointer flex items-center justify-between transition-all group"
                    >
                      <span className="font-semibold text-slate-600 group-hover:text-blue-700 line-clamp-1">
                        👉 {sim.court} ── {sim.id.split(',').slice(-1)[0]}
                      </span>
                      <span className="bg-blue-100/50 text-blue-700 text-[10px] px-1.5 py-0.5 rounded font-black flex-shrink-0">
                        共享 {sim.sharedLawCount} 條
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col font-sans">
      {/* 標題與導航欄 */}
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
        
        {/* 左側：搜尋配置欄 */}
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
                    className="p-2 border border-slate-200 rounded-xl text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                    className="p-2 border border-slate-200 rounded-xl text-xs bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
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

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 disabled:bg-slate-300 disabled:shadow-none"
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

        {/* 右側：搜尋結果展示區 */}
        <section className="flex-1 flex flex-col gap-5">
          <div className="border-l-4 border-blue-600 pl-2.5 flex justify-between items-center">
            <h2 className="font-bold text-slate-800 text-lg">📋 匹配結果與圖譜統計</h2>
          </div>

          {/* 無資料時的兜底畫面 */}
          {!hasResults ? (
            <div className="flex-1 bg-white rounded-2xl border border-slate-200 border-dashed p-16 flex flex-col items-center justify-center text-slate-400 gap-4">
              <span className="text-5xl">💡</span>
              <p className="text-sm font-medium">請在左側輸入犯罪或糾紛情境描述，並點選「開始檢索」查閱結果。</p>
            </div>
          ) : (
            <div className="flex-grow flex flex-col gap-5">
              
              {/* 頂部 Dashboard */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 rounded-xl bg-gradient-to-br from-blue-50 to-blue-100/50 border border-blue-200/60 shadow-sm">
                  <span className="text-xs font-bold text-blue-800 block mb-1">🎯 混合檢索結果筆數</span>
                  <div className="text-2xl font-black text-blue-700">
                    {algoResults.hybrid?.results?.length || 0} <span className="text-sm font-medium">筆</span>
                  </div>
                </div>
                <div className="p-4 rounded-xl bg-gradient-to-br from-green-50 to-green-100/50 border border-green-200/60 shadow-sm md:col-span-2">
                  <span className="text-xs font-bold text-green-800 block mb-1">📚 混合核心關聯法條 (Top 3)</span>
                  <div className="text-sm font-bold text-green-700 leading-normal">
                    {topLaws.length > 0
                      ? topLaws.map(([law, count]) => `${law} (${count}次)`).join('，')
                      : '無關聯法條數據'}
                  </div>
                </div>
              </div>

              {/* Tabs 切換標籤 */}
              <div className="flex border-b border-slate-200 gap-2">
                <button
                  onClick={() => setActiveTab('cards')}
                  className={`px-5 py-2.5 font-bold text-sm border-b-2 transition-all ${
                    activeTab === 'cards'
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  📋 三欄演算法對比
                </button>
                <button
                  onClick={() => setActiveTab('graph')}
                  className={`px-5 py-2.5 font-bold text-sm border-b-2 transition-all ${
                    activeTab === 'graph'
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  🕸️ 關聯圖譜網絡 (以混合檢索為主)
                </button>
              </div>

              {/* Tab 內容：卡片展示 */}
              {activeTab === 'cards' && (
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
                  
                  {/* 第一欄：全文關鍵字檢索 */}
                  <div className="flex flex-col gap-4 bg-slate-50/40 p-3 rounded-2xl border border-slate-200/60">
                    <div className="flex justify-between items-center border-b border-slate-200 pb-2">
                      <span className="font-extrabold text-sm text-slate-700 flex items-center gap-1">
                        📝 全文關鍵字檢索
                      </span>
                      <span className="text-xs bg-emerald-50 text-emerald-700 font-extrabold px-2 py-0.5 rounded border border-emerald-200">
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

                  {/* 第二欄：純向量檢索 */}
                  <div className="flex flex-col gap-4 bg-slate-50/40 p-3 rounded-2xl border border-slate-200/60">
                    <div className="flex justify-between items-center border-b border-slate-200 pb-2">
                      <span className="font-extrabold text-sm text-slate-700 flex items-center gap-1">
                        🎯 純向量語意檢索
                      </span>
                      <span className="text-xs bg-emerald-50 text-emerald-700 font-extrabold px-2 py-0.5 rounded border border-emerald-200">
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

                  {/* 第三欄：混合檢索 (RRF) */}
                  <div className="flex flex-col gap-4 bg-blue-50/20 p-3 rounded-2xl border border-blue-200/50 shadow-sm ring-1 ring-blue-100">
                    <div className="flex justify-between items-center border-b border-blue-150 pb-2">
                      <span className="font-extrabold text-sm text-blue-800 flex items-center gap-1">
                        ⭐ 混合檢索 (RRF 重排)
                      </span>
                      <span className="text-xs bg-blue-50 text-blue-700 font-extrabold px-2 py-0.5 rounded border border-blue-200">
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
              )}

              {/* Tab 內容：圖譜網絡展示 */}
              {activeTab === 'graph' && (
                <GraphNetwork results={algoResults.hybrid?.results || []} query={searchedQuery} />
              )}

            </div>
          )}
        </section>

      </main>
    </div>
  );
}
