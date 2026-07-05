"use client";

import React, { useEffect, useRef } from 'react';

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
  community?: number | null;
  communityName?: string | null;
}

interface GraphNetworkProps {
  results: ResultItem[];
  query: string;
}

export default function GraphNetwork({ results, query }: GraphNetworkProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const networkRef = useRef<any>(null);
  const nodesDataSetRef = useRef<any>(null);
  const edgesDataSetRef = useRef<any>(null);

  // 實體配色方案 (HSL)
  const colors = {
    query: '#2563eb',       // 深亮藍：查詢情境
    judgment: '#f97316',    // 橘色：預設判決書
    law: '#ca8a04',         // 黃色：法規
    judge: '#9333ea',       // 紫色：法官
    defendant: '#dc2626',   // 紅色：被告
    plaintiff: '#16a34a',   // 綠色：原告
  };

  // 根據社群 ID 動態生成對比鮮明且和諧的 HSL 顏色
  const getCommunityColor = (commId: number) => {
    const hue = (commId * 137.5) % 360; // 使用黃金比例分佈色相
    return {
      background: `hsl(${hue}, 80%, 55%)`,
      border: `hsl(${hue}, 80%, 38%)`,
      highlight: {
        background: `hsl(${hue}, 90%, 62%)`,
        border: `hsl(${hue}, 90%, 42%)`
      }
    };
  };

  useEffect(() => {
    if (typeof window === 'undefined' || !containerRef.current || results.length === 0) {
      return;
    }

    const initNetwork = async () => {
      // 動態載入 vis-network 以防 Next.js SSR 期間出現 window is not defined
      const { Network, DataSet } = await import('vis-network/standalone/esm/index.js');

      // 1. 初始化或取得 DataSet 實例
      if (!nodesDataSetRef.current) {
        nodesDataSetRef.current = new DataSet([]);
      }
      if (!edgesDataSetRef.current) {
        edgesDataSetRef.current = new DataSet([]);
      }

      nodesDataSetRef.current.clear();
      edgesDataSetRef.current.clear();

      const nodes: any[] = [];
      const edges: any[] = [];
      const addedNodes = new Set<string>();

      // 2. 加入中心查詢節點
      const queryLabel = query.length <= 15 ? query : query.slice(0, 12) + '...';
      nodes.push({
        id: 'query_node',
        label: `🔍 查詢案情：\n${queryLabel}`,
        color: {
          background: colors.query,
          border: '#1d4ed8',
          highlight: { background: '#3b82f6', border: '#1e40af' }
        },
        size: 30,
        shape: 'dot',
        font: { color: '#ffffff', size: 13, face: 'system-ui', bold: 'true' },
        title: `您的查詢情境：\n${query}`,
      });
      addedNodes.add('query_node');

      // 3. 遍歷結果加入初始圖譜元素
      results.forEach((r) => {
        const jId = r.id;
        const jLabel = jId.includes(',') ? jId.split(',').slice(-2, -1)[0] : jId;
        const shortLabel = jLabel.length > 12 ? jLabel.slice(0, 10) + '...' : jLabel;

        const hasCommunity = r.community !== null && r.community !== undefined;
        const commText = r.communityName || (hasCommunity ? `法律分群 ${r.community}` : '');
        const jTitle = `法院：${r.court}\n案由：${r.reason}\n字號：${r.id}${commText ? `\n分群資訊：${commText}` : ''}\n相似度：${r.maxSectionScore.toFixed(4)}`;

        // 加入判決書節點
        if (!addedNodes.has(jId)) {
          const commColor = hasCommunity ? getCommunityColor(r.community!) : null;
          nodes.push({
            id: jId,
            label: `⚖️ ${shortLabel}`,
            color: commColor || {
              background: colors.judgment,
              border: '#c2410c',
              highlight: { background: '#ea580c', border: '#9a3412' }
            },
            size: 24,
            shape: 'dot',
            font: { color: '#ffffff', size: 11, face: 'system-ui', bold: 'true' },
            title: jTitle,
          });
          addedNodes.add(jId);
        }

        // 建立 查詢節點 -> 判決書 的連線 (線寬反映相似度)
        const score = r.maxSectionScore;
        const edgeWidth = Math.max(2.5, Math.min(7, (score - 0.55) * 15));
        edges.push({
          from: 'query_node',
          to: jId,
          width: edgeWidth,
          title: `相似度得分：${score.toFixed(4)}`,
          color: { color: '#60a5fa', highlight: '#2563eb' },
          arrows: 'to',
        });

        // 加入引用法規
        r.citedLaws.forEach((law) => {
          if (!addedNodes.has(law)) {
            nodes.push({
              id: law,
              label: `📖 ${law}`,
              color: {
                background: colors.law,
                border: '#a16207',
                highlight: { background: '#eab308', border: '#854d0e' }
              },
              size: 16,
              shape: 'dot',
              font: { color: '#1f2937', size: 10, face: 'system-ui' },
              title: `引用法規：${law}`,
            });
            addedNodes.add(law);
          }
          edges.push({
            from: jId,
            to: law,
            color: { color: '#fde047', highlight: '#ca8a04' },
            width: 1.2,
            arrows: 'to',
            label: '引用',
            font: { size: 8, color: '#854d0e', face: 'system-ui', align: 'horizontal' },
          });
        });

        // 加入法官
        r.judges.forEach((judge) => {
          const judgeId = `judge_${judge}`;
          if (!addedNodes.has(judgeId)) {
            nodes.push({
              id: judgeId,
              label: `👨‍⚖️ ${judge} 法官`,
              color: {
                background: colors.judge,
                border: '#7e22ce',
                highlight: { background: '#a855f7', border: '#6b21a8' }
              },
              size: 16,
              shape: 'dot',
              font: { color: '#ffffff', size: 10, face: 'system-ui' },
              title: `審判法官：${judge}`,
            });
            addedNodes.add(judgeId);
          }
          edges.push({
            from: jId,
            to: judgeId,
            color: { color: '#e9d5ff', highlight: '#9333ea' },
            width: 1.2,
            arrows: 'to',
            label: '審判',
            font: { size: 8, color: '#6b21a8', face: 'system-ui', align: 'horizontal' },
          });
        });

        // 加入被告
        r.defendants.forEach((defendant) => {
          const defId = `def_${defendant}`;
          if (!addedNodes.has(defId)) {
            nodes.push({
              id: defId,
              label: `👤 被告：${defendant}`,
              color: {
                background: colors.defendant,
                border: '#b91c1c',
                highlight: { background: '#ef4444', border: '#991b1b' }
              },
              size: 16,
              shape: 'dot',
              font: { color: '#ffffff', size: 10, face: 'system-ui' },
              title: `被告人：${defendant}`,
            });
            addedNodes.add(defId);
          }
          edges.push({
            from: jId,
            to: defId,
            color: { color: '#fecaca', highlight: '#dc2626' },
            width: 1.2,
            arrows: 'to',
            label: '被告',
            font: { size: 8, color: '#991b1b', face: 'system-ui', align: 'horizontal' },
          });
        });

        // 加入原告
        r.plaintiffs.forEach((plaintiff) => {
          const plainId = `plain_${plaintiff}`;
          if (!addedNodes.has(plainId)) {
            nodes.push({
              id: plainId,
              label: `👤 原告：${plaintiff}`,
              color: {
                background: colors.plaintiff,
                border: '#047857',
                highlight: { background: '#10b981', border: '#065f46' }
              },
              size: 16,
              shape: 'dot',
              font: { color: '#ffffff', size: 10, face: 'system-ui' },
              title: `原告人：${plaintiff}`,
            });
            addedNodes.add(plainId);
          }
          edges.push({
            from: jId,
            to: plainId,
            color: { color: '#bbf7d0', highlight: '#16a34a' },
            width: 1.2,
            arrows: 'to',
            label: '原告',
            font: { size: 8, color: '#166534', face: 'system-ui', align: 'horizontal' },
          });
        });
      });

      nodesDataSetRef.current.add(nodes);
      edgesDataSetRef.current.add(edges);

      // 4. 配置與初始化網絡圖 (優化引力，防止重疊)
      const data = { nodes: nodesDataSetRef.current, edges: edgesDataSetRef.current };
      const options = {
        nodes: {
          borderWidth: 2.5,
          shadow: true,
        },
        edges: {
          shadow: true,
          smooth: {
            enabled: true,
            type: 'continuous',
            roundness: 0.4,
          },
        },
        physics: {
          barnesHut: {
            gravitationalConstant: -2200,
            centralGravity: 0.15,
            springLength: 170,
            springConstant: 0.04,
            damping: 0.85,
          },
          stabilization: {
            iterations: 200,
            fit: true,
          },
        },
        interaction: {
          hover: true,
          tooltipDelay: 200,
        },
      };

      if (networkRef.current) {
        networkRef.current.destroy();
      }

      networkRef.current = new Network(containerRef.current!, data, options);

      // 5. 監聽雙擊事件以進行二跳關係懶加載
      networkRef.current.on('doubleClick', async (params: any) => {
        if (params.nodes && params.nodes.length > 0) {
          const clickedNodeId = params.nodes[0];
          if (clickedNodeId === 'query_node') return;

          // 判定節點類型
          let nodeType = '';
          if (clickedNodeId.startsWith('judge_') || clickedNodeId.startsWith('def_') || clickedNodeId.startsWith('plain_')) {
            nodeType = 'person';
          } else if (clickedNodeId.includes(',') || clickedNodeId.includes('訴') || clickedNodeId.includes('字') || clickedNodeId.includes('判')) {
            nodeType = 'judgment';
          } else {
            nodeType = 'law';
          }

          try {
            const response = await fetch('/api/graph/expand', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ nodeType, nodeId: clickedNodeId }),
            });
            const expandData = await response.json();

            if (response.ok && expandData.nodes) {
              // 新增節點 (去重)
              expandData.nodes.forEach((n: any) => {
                if (!nodesDataSetRef.current.get(n.id)) {
                  let colorStyle = {};
                  let labelPrefix = '';

                  if (n.type === 'judgment') {
                    const hasComm = n.community !== null && n.community !== undefined;
                    const commColor = hasComm ? getCommunityColor(n.community) : null;
                    colorStyle = commColor || { background: colors.judgment, border: '#c2410c' };
                    labelPrefix = '⚖️ ';
                  }

                  const jLabel = n.label.length > 12 ? n.label.slice(0, 10) + '...' : n.label;
                  const jTitle = `法院：${n.court}\n案由：${n.reason}\n字號：${n.id}${n.communityName ? `\n分群資訊：${n.communityName}` : ''}`;

                  nodesDataSetRef.current.add({
                    id: n.id,
                    label: `${labelPrefix}${jLabel}`,
                    color: colorStyle,
                    size: 20,
                    shape: 'dot',
                    font: { color: '#ffffff', size: 10, face: 'system-ui' },
                    title: jTitle,
                  });
                }
              });

              // 新增連線 (去重)
              expandData.edges.forEach((e: any) => {
                const existingEdges = edgesDataSetRef.current.get({
                  filter: (item: any) => (item.from === e.from && item.to === e.to) || (item.from === e.to && item.to === e.from)
                });
                if (existingEdges.length === 0) {
                  edgesDataSetRef.current.add({
                    from: e.from,
                    to: e.to,
                    label: e.label || '',
                    width: e.width || 1.2,
                    color: { color: '#cbd5e1', highlight: '#94a3b8' },
                    font: { size: 8, color: '#64748b', face: 'system-ui', align: 'horizontal' },
                    arrows: 'to',
                  });
                }
              });
            }
          } catch (err) {
            console.error('[圖譜非同步展開失敗]:', err);
          }
        }
      });
    };

    initNetwork();

    // 銷毀清理
    return () => {
      if (networkRef.current) {
        networkRef.current.destroy();
        networkRef.current = null;
      }
    };
  }, [results, query]);

  return (
    <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-md relative overflow-hidden">
      {/* 頂部操作指引 */}
      <div className="text-xs text-slate-500 mb-3 flex justify-between items-center flex-wrap gap-2">
        <span className="font-semibold text-slate-600">📊 知識圖譜關聯分析</span>
        <span className="font-extrabold text-blue-600 animate-pulse">
          🖱️ 雙擊任何節點即可懶加載展開二跳關係網！(滾輪可縮放)
        </span>
      </div>

      <div className="relative">
        <div 
          ref={containerRef} 
          className="w-full h-[580px] rounded-xl bg-slate-50 border border-slate-100 shadow-inner" 
        />

        {/* 浮動式精美圖例說明面板 */}
        <div className="absolute top-4 left-4 bg-white/95 backdrop-blur-sm p-4 rounded-xl border border-slate-200/80 shadow-lg flex flex-col gap-2.5 max-w-[240px] z-10 text-xs text-slate-700 pointer-events-auto">
          <span className="font-bold border-b border-slate-100 pb-1 block text-slate-800">📌 圖譜視覺化圖例</span>
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="w-3.5 h-3.5 rounded-full inline-block" style={{ backgroundColor: colors.query }} />
              <span className="font-medium">🔍 您的查詢情境</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3.5 h-3.5 rounded-full inline-block" style={{ backgroundColor: colors.judgment }} />
              <span className="font-medium">⚖️ 判決書 (反映 法律適用分群)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3.5 h-3.5 rounded-full inline-block" style={{ backgroundColor: colors.law }} />
              <span className="font-medium">📖 引用法規</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3.5 h-3.5 rounded-full inline-block" style={{ backgroundColor: colors.judge }} />
              <span className="font-medium">👨‍⚖️ 審判法官</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3.5 h-3.5 rounded-full inline-block" style={{ backgroundColor: colors.defendant }} />
              <span className="font-medium">👤 訴訟被告</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="w-3.5 h-3.5 rounded-full inline-block" style={{ backgroundColor: colors.plaintiff }} />
              <span className="font-medium">👤 訴訟原告</span>
            </div>
          </div>
          <div className="border-t border-slate-100 pt-2 text-[10px] text-slate-400 font-medium">
            * 關係線上標有法律關係名稱與箭頭指向，反映實體間的聯結。
          </div>
        </div>
      </div>
    </div>
  );
}
