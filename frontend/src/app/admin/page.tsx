'use client';

import React, { useState, useEffect } from 'react';

interface Stats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}

interface FailedJob {
  id: string;
  jid: string;
  status: string;
  error_message: string;
  retry_count: number;
  updated_at: string;
}

export default function AdminPage() {
  const [stats, setStats] = useState<Stats>({ pending: 0, processing: 0, completed: 0, failed: 0 });
  const [failedJobs, setFailedJobs] = useState<FailedJob[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [syncLimit, setSyncLimit] = useState<number>(10);
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'error' | 'info' | null }>({
    text: '',
    type: null,
  });
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchJobsData = async () => {
    try {
      setLoading(true);
      const res = await fetch('/api/admin/jobs');
      const data = await res.json();
      if (data.success) {
        setStats(data.stats);
        setFailedJobs(data.failedJobs || []);
      } else {
        showStatus(data.error || '獲取佇列狀態失敗', 'error');
      }
    } catch (err: any) {
      showStatus(err.message || '獲取資料失敗', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchJobsData();
  }, []);

  const showStatus = (text: string, type: 'success' | 'error' | 'info') => {
    setStatusMessage({ text, type });
    setTimeout(() => {
      setStatusMessage({ text: '', type: null });
    }, 6000);
  };

  const handleEnqueue = async () => {
    setActionLoading('enqueue');
    try {
      const res = await fetch('/api/admin/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'enqueue' }),
      });
      const data = await res.json();
      if (data.success) {
        showStatus(data.message, 'success');
        fetchJobsData();
      } else {
        showStatus(data.error || '掃描排隊失敗', 'error');
      }
    } catch (err: any) {
      showStatus(err.message || '執行錯誤', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleSync = async () => {
    setActionLoading('sync');
    try {
      const res = await fetch('/api/admin/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync', limit: syncLimit, force: true }),
      });
      const data = await res.json();
      if (data.success) {
        showStatus(data.message, 'success');
        fetchJobsData();
      } else {
        showStatus(data.error || '批量同步失敗', 'error');
      }
    } catch (err: any) {
      showStatus(err.message || '同步錯誤', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleRetryFailed = async () => {
    setActionLoading('retry');
    try {
      const res = await fetch('/api/admin/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (data.success) {
        showStatus(data.message, 'success');
        fetchJobsData();
      } else {
        showStatus(data.error || '重設失敗任務失敗', 'error');
      }
    } catch (err: any) {
      showStatus(err.message || '重設錯誤', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleCommunityDetection = async () => {
    setActionLoading('community');
    try {
      const res = await fetch('/api/admin/community-detection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (data.success) {
        showStatus(data.message, 'success');
      } else {
        showStatus(data.error || '社群偵測執行失敗', 'error');
      }
    } catch (err: any) {
      showStatus(err.message || '執行錯誤', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans p-6 md:p-12">
      {/* 頁面標題 */}
      <div className="max-w-7xl mx-auto mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
            法律判決書 RAG 搜尋系統 — 維運管理後台
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            管理任務佇列、監控 Ingestion 同步進度並手動優化圖譜拓撲
          </p>
        </div>
        <button
          onClick={fetchJobsData}
          disabled={loading || actionLoading !== null}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 active:bg-slate-900 border border-slate-700 hover:border-slate-600 rounded-lg text-sm font-medium transition-all cursor-pointer flex items-center gap-2 justify-center"
        >
          {loading ? '更新中...' : '🔄 重新整理'}
        </button>
      </div>

      {/* 狀態訊息提示橫幅 */}
      {statusMessage.text && (
        <div className="max-w-7xl mx-auto mb-8">
          <div
            className={`p-4 rounded-xl border flex items-center gap-3 animate-fade-in ${
              statusMessage.type === 'success'
                ? 'bg-emerald-950/40 border-emerald-800 text-emerald-300'
                : statusMessage.type === 'error'
                ? 'bg-rose-950/40 border-rose-800 text-rose-300'
                : 'bg-blue-950/40 border-blue-800 text-blue-300'
            }`}
          >
            <span className="text-xl">
              {statusMessage.type === 'success' ? '✅' : statusMessage.type === 'error' ? '❌' : 'ℹ️'}
            </span>
            <p className="text-sm font-medium">{statusMessage.text}</p>
          </div>
        </div>
      )}

      {/* 數據統計區 */}
      <div className="max-w-7xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 backdrop-blur-md">
          <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider">佇列等待中 (Pending)</p>
          <p className="text-3xl font-black text-blue-400 mt-2">{loading ? '...' : stats.pending}</p>
        </div>
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 backdrop-blur-md">
          <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider">同步處理中 (Processing)</p>
          <p className="text-3xl font-black text-amber-400 mt-2">{loading ? '...' : stats.processing}</p>
        </div>
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 backdrop-blur-md">
          <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider">同步已完成 (Completed)</p>
          <p className="text-3xl font-black text-emerald-400 mt-2">{loading ? '...' : stats.completed}</p>
        </div>
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 backdrop-blur-md">
          <p className="text-slate-400 text-xs font-semibold uppercase tracking-wider">匯入失敗數 (Failed)</p>
          <p className="text-3xl font-black text-rose-400 mt-2">{loading ? '...' : stats.failed}</p>
        </div>
      </div>

      {/* 操作控制面板 */}
      <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {/* 卡片 1: 佇列任務產生器 */}
        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2">📂 掃描並排入佇列</h3>
            <p className="text-slate-400 text-xs mt-2 leading-relaxed">
              自動掃描本地 `data/` 資料夾中所有的判決書 JSON 檔案。將尚未寫入資料庫之判決字號以 `pending` 狀態登錄至 Job 佇列。
            </p>
          </div>
          <button
            onClick={handleEnqueue}
            disabled={actionLoading !== null}
            className="w-full mt-6 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-500 text-slate-100 rounded-xl text-sm font-semibold transition-all cursor-pointer shadow-lg shadow-blue-900/20"
          >
            {actionLoading === 'enqueue' ? '正在掃描檔案...' : '開始掃描並登錄'}
          </button>
        </div>

        {/* 卡片 2: 同步與併發控制 */}
        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2">⚡ 執行手動批次同步</h3>
            <p className="text-slate-400 text-xs mt-2 leading-relaxed">
              從佇列拉取待處理任務，取得判決書全文進行分塊、雙寫寫入 Postgres 與 Neo4j。**併發限制設定為 2 以防免費資料庫鎖定**。
            </p>
            <div className="mt-4 flex items-center gap-3">
              <label htmlFor="limit-select" className="text-slate-400 text-xs font-semibold">單次處理限制：</label>
              <select
                id="limit-select"
                value={syncLimit}
                onChange={(e) => setSyncLimit(parseInt(e.target.value))}
                className="bg-slate-950 border border-slate-700 text-slate-200 text-xs rounded-lg px-2 py-1 focus:outline-none"
              >
                <option value="5">5 筆</option>
                <option value="10">10 筆</option>
                <option value="20">20 筆</option>
                <option value="50">50 筆</option>
              </select>
            </div>
          </div>
          <button
            onClick={handleSync}
            disabled={actionLoading !== null || stats.pending === 0}
            className="w-full mt-6 py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 disabled:text-slate-500 text-slate-100 rounded-xl text-sm font-semibold transition-all cursor-pointer shadow-lg shadow-indigo-900/20"
          >
            {actionLoading === 'sync' ? '執行同步中...' : '手動觸發批次同步'}
          </button>
        </div>

        {/* 卡片 3: 進階維運工具 */}
        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2">🛠️ 維運與圖譜優化</h3>
            <p className="text-slate-400 text-xs mt-2 leading-relaxed">
              在此手動執行社群偵測，系統會在 Neo4j 中重算 Judgment 的社群分組。若有先前因死結或超時失敗的任務，可點選重試。
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-6">
            <button
              onClick={handleRetryFailed}
              disabled={actionLoading !== null || stats.failed === 0}
              className="py-2.5 bg-slate-800 hover:bg-slate-700 disabled:bg-slate-900/60 disabled:text-slate-600 text-slate-100 border border-slate-700 rounded-xl text-xs font-semibold transition-all cursor-pointer"
            >
              {actionLoading === 'retry' ? '正在重設...' : '重試失敗任務'}
            </button>
            <button
              onClick={handleCommunityDetection}
              disabled={actionLoading !== null}
              className="py-2.5 bg-emerald-700 hover:bg-emerald-600 disabled:bg-slate-900/60 disabled:text-slate-600 text-slate-100 rounded-xl text-xs font-semibold transition-all cursor-pointer"
            >
              {actionLoading === 'community' ? '運算中...' : '執行社群偵測'}
            </button>
          </div>
        </div>
      </div>

      {/* 失敗任務日誌列表 */}
      <div className="max-w-7xl mx-auto bg-slate-900/20 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="p-6 border-b border-slate-800">
          <h3 className="text-lg font-bold text-slate-100 flex items-center gap-2">🚨 失敗任務錯誤日誌 (最近 10 筆)</h3>
          <p className="text-slate-400 text-xs mt-1">展示失敗的判決案號與詳細的拋錯訊息，以便開發與維護人員除錯</p>
        </div>
        <div className="overflow-x-auto">
          {loading ? (
            <div className="p-8 text-center text-slate-500 text-sm">正在載入錯誤日誌...</div>
          ) : failedJobs.length === 0 ? (
            <div className="p-8 text-center text-slate-500 text-sm">👍 目前沒有失敗的同步任務。系統狀態良好！</div>
          ) : (
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-950 text-slate-400 font-semibold border-b border-slate-800">
                  <th className="p-4 w-12">ID</th>
                  <th className="p-4 w-1/4">裁判書字號 (JID)</th>
                  <th className="p-4 w-12">重試次數</th>
                  <th className="p-4">詳細錯誤堆疊</th>
                  <th className="p-4 w-1/6">最後更新時間</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {failedJobs.map((job) => (
                  <tr key={job.id} className="hover:bg-slate-900/30">
                    <td className="p-4 text-slate-500">{job.id}</td>
                    <td className="p-4 font-mono font-semibold text-rose-300">{job.jid}</td>
                    <td className="p-4 text-center font-bold text-slate-300">{job.retry_count}</td>
                    <td className="p-4">
                      <div className="bg-slate-950/60 border border-slate-800/80 rounded-lg p-2 font-mono text-[11px] text-rose-400 max-h-24 overflow-y-auto max-w-lg md:max-w-2xl break-all">
                        {job.error_message}
                      </div>
                    </td>
                    <td className="p-4 text-slate-400">{new Date(job.updated_at).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
