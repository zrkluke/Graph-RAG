import { NextResponse } from 'next/server';
import neo4j, { Driver } from 'neo4j-driver';
import OpenAI from 'openai';

// 宣告全域變數快取，防止 Serverless 冷啟動連線數溢出
declare global {
  var neo4jDriver: Driver | undefined;
}

// 初始化 OpenAI 客戶端
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_API_BASE || undefined,
});

// 獲取或建立 Neo4j 驅動實例
function getNeo4jDriver(): Driver {
  if (!globalThis.neo4jDriver) {
    const uri = process.env.NEO4J_URI;
    const user = process.env.NEO4J_USERNAME || 'neo4j';
    const password = process.env.NEO4J_PASSWORD;

    if (!uri || !password) {
      throw new Error('缺少 Neo4j 連線環境變數！');
    }

    globalThis.neo4jDriver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  }
  return globalThis.neo4jDriver;
}

// 將 Neo4j Integer 物件安全地轉換為 JavaScript 的 number
function toJSNumber(val: any): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return val;
  if (typeof val.toNumber === 'function') return val.toNumber();
  if (val.low !== undefined) return val.low;
  return Number(val) || 0;
}

export async function POST(request: Request) {
  try {
    // 1. 解析前端 Body 傳參
    const body = await request.json().catch(() => ({}));
    const { query, courtLevel, caseType, limit = 3 } = body;

    if (!query || typeof query !== 'string' || !query.trim()) {
      return NextResponse.json({ error: '請提供有效的案情情境描述！' }, { status: 400 });
    }

    // 2. 向量化查詢（用於向量檢索）
    const tStartEmbed = performance.now();
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: query.replace(/\n/g, ' ').trim(),
    });
    const queryVector = embeddingResponse.data[0].embedding;
    const tEndEmbed = performance.now();
    const embedTime = tEndEmbed - tStartEmbed;

    const driverInstance = getNeo4jDriver();

    // 3. 【第一步：並行獲取候選 ID 列表】(不作實體與推薦 JOIN，避免 OOM)
    const runKeywordCandidates = async () => {
      const session = driverInstance.session();
      const tStart = performance.now();
      try {
        const cypher = `
          CALL db.index.fulltext.queryNodes('judgment_text_index', $query)
          YIELD node AS j, score
          WHERE ($courtLevel IS NULL OR j.court_level = $courtLevel)
            AND ($caseType IS NULL OR j.case_type = $caseType)
          RETURN j.id AS id, score AS score
          ORDER BY score DESC
          LIMIT 50
        `;
        const res = await session.run(cypher, {
          query,
          courtLevel: courtLevel && courtLevel !== '全部' ? courtLevel : null,
          caseType: caseType && caseType !== '全部' ? caseType : null,
        });
        const tEnd = performance.now();
        return { 
          candidates: res.records.map(r => ({ id: r.get('id') as string, score: Number(r.get('score')) })), 
          time: tEnd - tStart 
        };
      } finally {
        await session.close();
      }
    };

    const runVectorCandidates = async () => {
      const session = driverInstance.session();
      const tStart = performance.now();
      try {
        const cypher = `
          CALL db.index.vector.queryNodes('chunk_embedding_index', 100, $queryVector)
          YIELD node AS chunk, score
          MATCH (s:Section)-[:HAS_CHUNK]->(chunk)
          MATCH (j:Judgment)-[:HAS_SECTION]->(s)
          WHERE ($courtLevel IS NULL OR j.court_level = $courtLevel)
            AND ($caseType IS NULL OR j.case_type = $caseType)
          RETURN j.id AS id, max(score) AS score
          ORDER BY score DESC
          LIMIT 50
        `;
        const res = await session.run(cypher, {
          queryVector,
          courtLevel: courtLevel && courtLevel !== '全部' ? courtLevel : null,
          caseType: caseType && caseType !== '全部' ? caseType : null,
        });
        const tEnd = performance.now();
        return { 
          candidates: res.records.map(r => ({ id: r.get('id') as string, score: Number(r.get('score')) })), 
          time: (tEnd - tStart) + embedTime 
        };
      } finally {
        await session.close();
      }
    };

    const [keywordRes, vectorRes] = await Promise.all([
      runKeywordCandidates(),
      runVectorCandidates(),
    ]);

    const keywordCandidates = keywordRes.candidates;
    const vectorCandidates = vectorRes.candidates;

    // 4. 【第二步：在 Node.js 中計算混合 RRF 排序與三欄候選】
    const tStartRRF = performance.now();
    const rrfMap = new Map<string, number>();

    // 向量排行權重
    vectorCandidates.forEach((c, index) => {
      const score = 1 / (60 + index + 1);
      rrfMap.set(c.id, score);
    });

    // 全文排行權重融合
    keywordCandidates.forEach((c, index) => {
      const score = 1 / (60 + index + 1);
      rrfMap.set(c.id, (rrfMap.get(c.id) || 0) + score);
    });

    // 排序混合結果
    const sortedRRF = Array.from(rrfMap.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([id, score]) => ({ id, score }));

    const tEndRRF = performance.now();
    const rrfTime = tEndRRF - tStartRRF;
    const hybridTime = Math.max(keywordRes.time, vectorRes.time) + rrfTime;

    // 取得三欄要顯示的目標 ID (各取前 limit 筆，去重合併)
    const targetLimit = Number(limit);
    const keywordTargetIds = keywordCandidates.slice(0, targetLimit).map(c => c.id);
    const vectorTargetIds = vectorCandidates.slice(0, targetLimit).map(c => c.id);
    const hybridTargetIds = sortedRRF.slice(0, targetLimit).map(c => c.id);

    const allTargetIds = Array.from(new Set([
      ...keywordTargetIds,
      ...vectorTargetIds,
      ...hybridTargetIds
    ]));

    // 5. 【第三步：批次撈取目標 ID 的詳情、實體與相似案例推薦】
    const detailsMap = new Map<string, any>();
    
    if (allTargetIds.length > 0) {
      const session = driverInstance.session();
      try {
        const cypher = `
          MATCH (j:Judgment)
          WHERE j.id IN $allTargetIds
          
          // 1. 圖遍歷相似案例推薦 (共享最多引用法規之 Judgment)
          OPTIONAL MATCH (j)-[:CITED]->(l:Law)<-[:CITED]-(other:Judgment)
          WHERE other.id <> j.id
          WITH j, other, count(l) AS shared_count
          ORDER BY shared_count DESC, other.date DESC
          WITH j, collect({
            id: other.id, 
            court: other.court, 
            reason: other.reason, 
            date: toString(other.date), 
            sharedLawCount: toInteger(shared_count)
          })[0..3] AS similar_cases
          
          // 2. 關聯其餘實體
          OPTIONAL MATCH (j)-[:JUDGED_BY]->(judge:Person)
          OPTIONAL MATCH (j)-[:DEFENDANT]->(defendant:Person)
          OPTIONAL MATCH (j)-[:PLAINTIFF]->(plaintiff:Person)
          OPTIONAL MATCH (j)-[:CITED]->(law:Law)
          
          RETURN 
            j.id AS id,
            j.court AS court,
            j.court_level AS court_level,
            j.case_type AS case_type,
            j.reason AS reason,
            j.main_text AS main_text,
            j.fact_reason AS fact_reason,
            j.community AS community,
            collect(distinct judge.name) AS judges,
            collect(distinct defendant.name) AS defendants,
            collect(distinct plaintiff.name) AS plaintiffs,
            collect(distinct law.name) AS cited_laws,
            similar_cases
        `;
        const res = await session.run(cypher, { allTargetIds });
        
        res.records.forEach(rec => {
          const rawDefendants = rec.get('defendants') || [];
          const cleanedDefendants = rawDefendants.filter(
            (name: string) => name && name !== '主　文' && name !== '主文'
          );

          const rawSimilar = rec.get('similar_cases') || [];
          const cleanedSimilar = rawSimilar.map((item: any) => ({
            id: item.id || '',
            court: item.court || '',
            reason: item.reason || '',
            date: item.date || '',
            sharedLawCount: toJSNumber(item.sharedLawCount),
          }));

          detailsMap.set(rec.get('id'), {
            id: rec.get('id'),
            court: rec.get('court'),
            courtLevel: rec.get('court_level'),
            caseType: rec.get('case_type'),
            reason: rec.get('reason'),
            mainText: rec.get('main_text'),
            factReason: rec.get('fact_reason'),
            community: rec.get('community') !== null && rec.get('community') !== undefined ? toJSNumber(rec.get('community')) : null,
            judges: rec.get('judges') || [],
            defendants: cleanedDefendants,
            plaintiffs: rec.get('plaintiffs') || [],
            citedLaws: rec.get('cited_laws') || [],
            similarRecommendations: cleanedSimilar,
          });
        });

      } finally {
        await session.close();
      }
    }

    // 6. 【第四步：將詳情裝配回三欄結果中】
    const assembleList = (candidates: { id: string, score: number }[], targetIds: string[]) => {
      return targetIds.map(id => {
        const detail = detailsMap.get(id);
        const cand = candidates.find(c => c.id === id);
        return {
          ...(detail || { id, court: '', courtLevel: '', caseType: '', reason: '', mainText: '', factReason: '', judges: [], defendants: [], plaintiffs: [], citedLaws: [], similarRecommendations: [], community: null }),
          maxSectionScore: cand ? cand.score : 0,
          searchScore: cand ? cand.score : 0
        };
      });
    };

    const finalKeywordList = assembleList(keywordCandidates.map(c => ({ id: c.id, score: c.score })), keywordTargetIds);
    const finalVectorList = assembleList(vectorCandidates.map(c => ({ id: c.id, score: c.score })), vectorTargetIds);
    const finalHybridList = hybridTargetIds.map(id => {
      const detail = detailsMap.get(id);
      const cand = sortedRRF.find(c => c.id === id);
      return {
        ...(detail || { id, court: '', courtLevel: '', caseType: '', reason: '', mainText: '', factReason: '', judges: [], defendants: [], plaintiffs: [], citedLaws: [], similarRecommendations: [], community: null }),
        maxSectionScore: cand ? cand.score : 0,
        rrfScore: cand ? cand.score : 0
      };
    });

    // 7. 回傳三種搜尋演算法的結果對比與耗時
    return NextResponse.json({
      keyword: {
        results: finalKeywordList,
        responseTimeMs: Math.round(keywordRes.time),
      },
      vector: {
        results: finalVectorList,
        responseTimeMs: Math.round(vectorRes.time),
      },
      hybrid: {
        results: finalHybridList,
        responseTimeMs: Math.round(hybridTime),
      },
    });

  } catch (error: any) {
    console.error('[API 錯誤] 搜尋檢索執行失敗:', error);
    return NextResponse.json(
      { error: error.message || '後端伺服器內部發生未知錯誤' },
      { status: 500 }
    );
  }
}
