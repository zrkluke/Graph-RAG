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
  judges: string[];
  defendants: string[];
  plaintiffs: string[];
  citedLaws: string[];
}

export default function Home() {
  // 搜尋與篩選狀態
  const [query, setQuery] = useState('');
  const [courtLevel, setCourtLevel] = useState('全部');
  const [caseType, setCaseType] = useState('全部');
  const [limit, setLimit] = useState(3);

  // 查詢結果與系統狀態
  const [results, setResults] = useState<ResultItem[]>([]);
  const [searchedQuery, setSearchedQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'cards' | 'graph'>('cards');

  // 執行 API 檢索
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) {
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
          query: query.trim(),
          courtLevel,
          caseType,
          limit,
        }),
      });

      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || '後端檢索失敗');
      }

      setResults(data.results || []);
      setSearchedQuery(query.trim());
    } catch (err: any) {
      console.error(err);
      setError(err.message || '連線至 API 發生錯誤');
    } finally {
      setLoading(false);
    }
  };

  // 統計召回結果中引用最多次的法條 (Top 3)
  const getTopLaws = () => {
    const counts: Record<string, number> = {};
    results.forEach((r) => {
      r.citedLaws.forEach((law) => {
        counts[law] = (counts[law] || 0) + 1;
      });
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
  };

  const topLaws = getTopLaws();

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
        <section className="w-full lg:w-96 flex-shrink-0 flex flex-col gap-5">
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
                  rows={6}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-700">法院層級</label>
                  <select
                    className="p-2.5 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                    className="p-2.5 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
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
                    <span>正在向量化與檢索...</span>
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
              💡 <b>小提示：</b><br />
              - 請盡量描述具體的情節（如工具、傷勢、酒精濃度、是否逃逸等），這能大幅提高語意向量匹配的精確度。<br />
              - 圖譜由 Vercel Serverless Function 即時查詢 Neo4j 提取。
            </div>
          </div>
        </section>

        {/* 右側：搜尋結果展示區 */}
        <section className="flex-1 flex flex-col gap-5">
          <div className="border-l-4 border-blue-600 pl-2.5 flex justify-between items-center">
            <h2 className="font-bold text-slate-800 text-lg">📋 匹配結果與圖譜統計</h2>
          </div>

          {/* 無資料時的兜底畫面 */}
          {results.length === 0 ? (
            <div className="flex-1 bg-white rounded-2xl border border-slate-200 border-dashed p-16 flex flex-col items-center justify-center text-slate-400 gap-4">
              <span className="text-5xl">💡</span>
              <p className="text-sm font-medium">請在左側輸入犯罪或糾紛情境描述，並點選「開始檢索」查閱結果。</p>
            </div>
          ) : (
            <div className="flex-grow flex flex-col gap-5">
              
              {/* 頂部 Dashboard */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="p-4 rounded-xl bg-gradient-to-br from-blue-50 to-blue-100/50 border border-blue-200/60 shadow-sm">
                  <span className="text-xs font-bold text-blue-800 block mb-1">🎯 檢索結果筆數</span>
                  <div className="text-2xl font-black text-blue-700">
                    {results.length} <span className="text-sm font-medium">筆</span>
                  </div>
                </div>
                <div className="p-4 rounded-xl bg-gradient-to-br from-green-50 to-green-100/50 border border-green-200/60 shadow-sm md:col-span-2">
                  <span className="text-xs font-bold text-green-800 block mb-1">📚 核心關聯法條 (Top 3)</span>
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
                  📋 相似判決卡片
                </button>
                <button
                  onClick={() => setActiveTab('graph')}
                  className={`px-5 py-2.5 font-bold text-sm border-b-2 transition-all ${
                    activeTab === 'graph'
                      ? 'border-blue-600 text-blue-600'
                      : 'border-transparent text-slate-500 hover:text-slate-700'
                  }`}
                >
                  🕸️ 關聯圖譜網絡
                </button>
              </div>

              {/* Tab 內容：卡片展示 */}
              {activeTab === 'cards' && (
                <div className="flex flex-col gap-5">
                  {results.map((r, idx) => {
                    const isHigh = r.maxSectionScore >= 0.80;
                    const isMed = r.maxSectionScore >= 0.70;
                    const badgeColor = isHigh 
                      ? 'bg-emerald-100 text-emerald-800 border-emerald-200' 
                      : isMed 
                        ? 'bg-amber-100 text-amber-800 border-amber-200' 
                        : 'bg-slate-100 text-slate-800 border-slate-200';

                    return (
                      <div key={r.id} className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-col gap-4">
                        {/* 卡片頭部 */}
                        <div className="flex justify-between items-start gap-4 border-b border-slate-100 pb-4">
                          <div>
                            <h3 className="font-extrabold text-slate-800 text-base leading-snug">{r.court} | {r.reason}</h3>
                            <span className="text-xs text-slate-400 block mt-1">字號：{r.id}</span>
                          </div>
                          <span className={`px-3 py-1.5 rounded-full text-xs font-black border ${badgeColor} whitespace-nowrap`}>
                            🎯 相似度 {r.maxSectionScore.toFixed(4)}
                          </span>
                        </div>

                        {/* 標籤分類 */}
                        <div className="flex flex-wrap gap-2 text-xs font-semibold">
                          <span className="bg-blue-50 text-blue-700 px-2.5 py-1 rounded-lg">📂 {r.caseType}</span>
                          <span className="bg-purple-50 text-purple-700 px-2.5 py-1 rounded-lg">🏛️ {r.courtLevel}</span>
                          <span className="bg-rose-50/50 text-rose-700 px-2.5 py-1 rounded-lg">
                            ⚖️ 審判法官：{r.judges.length > 0 ? r.judges.join('，') : '未提供'}
                          </span>
                        </div>

                        {/* 訴訟關係人 */}
                        <div className="text-sm text-slate-600 leading-normal">
                          👤 <b>當事人</b>：
                          被告 ── <span className="text-red-600 font-bold">{r.defendants.length > 0 ? r.defendants.join('，') : '無'}</span> | 
                          原告 ── <span className="text-green-600 font-bold">{r.plaintiffs.length > 0 ? r.plaintiffs.join('，') : '無'}</span>
                        </div>

                        {/* 引用法規 */}
                        <div className="text-sm text-slate-600 flex flex-wrap gap-1.5 items-center">
                          <span className="font-bold flex-shrink-0">📖 引用法規：</span>
                          {r.citedLaws.length > 0 ? (
                            r.citedLaws.map((law) => (
                              <span key={law} className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-xs">
                                {law}
                              </span>
                            ))
                          ) : (
                            <span className="text-slate-400 text-xs">無</span>
                          )}
                        </div>

                        {/* 判決主文 */}
                        <div className="bg-slate-50 border-l-4 border-blue-500 p-4 rounded-r-xl text-sm text-slate-800 leading-relaxed">
                          <span className="font-bold block mb-1">📢 判決主文：</span>
                          <p dangerouslySetInnerHTML={{ __html: r.mainText.replace(/\r\n|\n/g, '<br/>') }} />
                        </div>

                        {/* 事實及理由片段 */}
                        <div className="text-sm text-slate-600 leading-relaxed">
                          <span className="font-bold block mb-1">📝 事實及理由摘要：</span>
                          <p className="bg-slate-50/50 border border-slate-100 p-3 rounded-xl text-slate-500 italic">
                            {r.factReason.slice(0, 350)}...
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Tab 內容：圖譜網絡展示 */}
              {activeTab === 'graph' && (
                <GraphNetwork results={results} query={searchedQuery} />
              )}

            </div>
          )}
        </section>

      </main>
    </div>
  );
}
