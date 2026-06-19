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
}

interface GraphNetworkProps {
  results: ResultItem[];
  query: string;
}

export default function GraphNetwork({ results, query }: GraphNetworkProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const networkRef = useRef<any>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !containerRef.current || results.length === 0) {
      return;
    }

    // 動態載入 vis-network 以防 Next.js SSR 期間出現 window is not defined
    const initNetwork = async () => {
      const { Network } = await import('vis-network/standalone/esm/index.js');

      // 1. 初始化資料集
      const nodes: any[] = [];
      const edges: any[] = [];
      const addedNodes = new Set<string>();

      // 實體配色方案 (HSL)
      const colors = {
        query: '#3b82f6',       // 亮藍：查詢情境
        judgment: '#f97316',    // 橘色：判決書
        law: '#eab308',         // 亮黃：法規
        judge: '#a855f7',       // 紫色：法官
        defendant: '#ef4444',   // 紅色：被告
        plaintiff: '#10b981',   // 綠色：原告
      };

      // 2. 加入中心查詢節點
      const queryLabel = query.length <= 15 ? query : query.slice(0, 12) + '...';
      nodes.push({
        id: 'query_node',
        label: `🔍 情境：${queryLabel}`,
        color: {
          background: colors.query,
          border: '#1d4ed8',
          highlight: { background: '#2563eb', border: '#1e40af' }
        },
        size: 26,
        shape: 'dot',
        font: { color: '#ffffff', size: 14, face: 'system-ui' },
        title: `您的查詢情境：\n${query}`,
      });
      addedNodes.add('query_node');

      // 3. 遍歷結果加入圖譜元素
      results.forEach((r) => {
        const jId = r.id;
        const jLabel = jId.includes(',') ? jId.split(',').slice(-2, -1)[0] : jId;
        const shortLabel = jLabel.length > 12 ? jLabel.slice(0, 10) + '...' : jLabel;

        const jTitle = `法院：${r.court}\n案由：${r.reason}\n字號：${r.id}\n相似度：${r.maxSectionScore.toFixed(4)}`;

        // 加入判決書節點
        if (!addedNodes.has(jId)) {
          nodes.push({
            id: jId,
            label: `⚖️ ${shortLabel}`,
            color: {
              background: colors.judgment,
              border: '#c2410c',
              highlight: { background: '#ea580c', border: '#9a3412' }
            },
            size: 22,
            shape: 'dot',
            font: { color: '#ffffff', size: 12, face: 'system-ui' },
            title: jTitle,
          });
          addedNodes.add(jId);
        }

        // 建立 查詢節點 -> 判決書 的連線 (線寬反映相似度)
        const score = r.maxSectionScore;
        const edgeWidth = Math.max(2, Math.min(6, (score - 0.55) * 12));
        edges.push({
          from: 'query_node',
          to: jId,
          width: edgeWidth,
          title: `相似度得分：${score.toFixed(4)}`,
          color: { color: '#93c5fd', highlight: '#3b82f6' },
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
                highlight: { background: '#ca8a04', border: '#854d0e' }
              },
              size: 14,
              shape: 'dot',
              font: { color: '#1f2937', size: 11, face: 'system-ui' },
              title: `引用法規：${law}`,
            });
            addedNodes.add(law);
          }
          edges.push({
            from: jId,
            to: law,
            color: { color: '#fef08a', highlight: '#eab308' },
            width: 1.5,
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
                highlight: { background: '#9333ea', border: '#6b21a8' }
              },
              size: 14,
              shape: 'dot',
              font: { color: '#ffffff', size: 11, face: 'system-ui' },
              title: `審判法官：${judge}`,
            });
            addedNodes.add(judgeId);
          }
          edges.push({
            from: jId,
            to: judgeId,
            color: { color: '#e9d5ff', highlight: '#a855f7' },
            width: 1.5,
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
                highlight: { background: '#dc2626', border: '#991b1b' }
              },
              size: 14,
              shape: 'dot',
              font: { color: '#ffffff', size: 11, face: 'system-ui' },
              title: `被告人：${defendant}`,
            });
            addedNodes.add(defId);
          }
          edges.push({
            from: jId,
            to: defId,
            color: { color: '#fecaca', highlight: '#ef4444' },
            width: 1.5,
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
                highlight: { background: '#059669', border: '#065f46' }
              },
              size: 14,
              shape: 'dot',
              font: { color: '#ffffff', size: 11, face: 'system-ui' },
              title: `原告人：${plaintiff}`,
            });
            addedNodes.add(plainId);
          }
          edges.push({
            from: jId,
            to: plainId,
            color: { color: '#a7f3d0', highlight: '#10b981' },
            width: 1.5,
          });
        });
      });

      // 4. 配置與初始化網絡圖
      const data = { nodes, edges };
      const options = {
        nodes: {
          borderWidth: 2,
          shadow: true,
        },
        edges: {
          shadow: true,
          smooth: {
            enabled: true,
            type: 'continuous',
            roundness: 0.5,
          },
        },
        physics: {
          barnesHut: {
            gravity: -1500,
            centralGravity: 0.2,
            springLength: 160,
            damping: 0.9,
          },
          stabilization: {
            iterations: 150,
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
    <div className="bg-white p-3 rounded-xl border border-gray-200">
      <div className="text-xs text-gray-500 mb-2 flex justify-between items-center">
        <span>💡 <b>圖譜說明：</b>藍色為您的搜尋；橘色為判決書；黃色為法規；紫色為法官；紅綠為被告與原告。</span>
        <span className="font-bold text-blue-600">🖱️ 滑鼠可拖曳節點、滾輪可放大縮小</span>
      </div>
      <div 
        ref={containerRef} 
        className="w-full h-[550px] rounded-lg bg-gray-50 border border-gray-100" 
      />
    </div>
  );
}
