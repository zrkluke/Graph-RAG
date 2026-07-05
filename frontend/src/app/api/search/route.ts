import { NextResponse } from 'next/server';
import neo4j, { Driver } from 'neo4j-driver';
import OpenAI from 'openai';
import crypto from 'crypto';
import { getRedisClient } from '@/lib/redis';
import { getPostgresPool } from '@/lib/postgres';

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
  const tStartAPI = performance.now();
  let cacheKey = '';
  let useRedis = false;
  let redisClient: any = null;

  try {
    redisClient = getRedisClient();
    useRedis = true;
  } catch (redisInitError) {
    console.warn('⚠️ [Redis] 初始化失敗，將不使用快取層:', redisInitError);
  }

  try {
    // 1. 解析前端 Body 傳參
    const body = await request.json().catch(() => ({}));
    const { query, courtLevel, caseType, limit = 3, court = '', judge = '', citedLaw = '' } = body;

    if (!query || typeof query !== 'string' || !query.trim()) {
      return NextResponse.json({ error: '請提供有效的案情情境描述！' }, { status: 400 });
    }

    // 嘗試從 Redis 讀取快取
    if (useRedis && redisClient) {
      try {
        const rawKey = JSON.stringify({ query, courtLevel, caseType, limit, court, judge, citedLaw });
        const hash = crypto.createHash('md5').update(rawKey).digest('hex');
        cacheKey = `search:cache:${hash}`;

        const cachedData = await redisClient.get(cacheKey);
        if (cachedData) {
          const parsedData = JSON.parse(cachedData);
          const tEndAPI = performance.now();
          console.log(`⚡ [Redis 快取命中] Key: ${cacheKey}`);
          return NextResponse.json({
            ...parsedData,
            cacheHit: true,
            executionTimeMs: Math.round(tEndAPI - tStartAPI),
          });
        }
      } catch (redisReadError) {
        console.error('❌ [Redis 讀取錯誤] Fallback 到即時檢索:', redisReadError);
      }
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

    const pgPool = getPostgresPool();
    const driverInstance = getNeo4jDriver();

    // 3. 【第一步：並行獲取候選 ID 列表，向量與全文檢索回歸 Postgres】
    // 解析 courtLevel 參數為聯邦法院陣列，以相容最高法院、最高行政法院與懲戒法院等終審機關
    let courtLevelList: string[] | null = null;
    if (courtLevel && courtLevel !== '全部') {
      if (courtLevel === '最高法院') {
        courtLevelList = ['最高法院', '最高行政法院', '懲戒法院', '憲法法庭'];
      } else {
        courtLevelList = [courtLevel];
      }
    }

    const runKeywordCandidates = async () => {
      const client = await pgPool.connect();
      const tStart = performance.now();
      try {
        const terms = query.split(/\s+/).filter(t => t.trim() !== '').slice(0, 5);
        const ilikeConditions: string[] = [];
        const params: any[] = [
          query,
          courtLevelList,
          caseType && caseType !== '全部' ? caseType : null,
          court && court.trim() !== '' ? court.trim() : null
        ];

        terms.forEach((term, index) => {
          const paramIndex = index + 5; // 從 $5 開始
          // 轉義 LIKE 的特殊字元 %, _, \ 避免全表掃描索引失效
          const escapedTerm = term.replace(/[%_\\]/g, '\\$&');
          params.push(`%${escapedTerm}%`);
          ilikeConditions.push(`(id ILIKE $${paramIndex} OR main_text ILIKE $${paramIndex} OR fact_reason ILIKE $${paramIndex})`);
        });

        if (ilikeConditions.length === 0) {
          const escapedQuery = query.trim().replace(/[%_\\]/g, '\\$&');
          params.push(`%${escapedQuery}%`);
          ilikeConditions.push(`(main_text ILIKE $5 OR fact_reason ILIKE $5)`);
        }

        const sql = `
          SELECT id, ts_rank_cd(to_tsvector('simple', COALESCE(id, '') || ' ' || COALESCE(main_text, '') || ' ' || COALESCE(fact_reason, '')), websearch_to_tsquery('simple', $1)) AS score
          FROM judgments
          WHERE (
            to_tsvector('simple', COALESCE(id, '') || ' ' || COALESCE(main_text, '') || ' ' || COALESCE(fact_reason, '')) @@ websearch_to_tsquery('simple', $1)
            OR (${ilikeConditions.join(' AND ')})
          )
            AND ($2::text[] IS NULL OR court_level = ANY($2::text[]))
            AND ($3::text IS NULL OR case_type = $3::text)
            AND ($4::text IS NULL OR court = $4::text)
          ORDER BY score DESC
          LIMIT 50;
        `;
        const res = await client.query(sql, params);
        const tEnd = performance.now();
        return { 
          candidates: res.rows.map((r: any) => ({ id: r.id as string, score: Number(r.score) || 0.1 })), 
          time: tEnd - tStart 
        };
      } finally {
        client.release();
      }
    };

    const runVectorCandidates = async () => {
      const client = await pgPool.connect();
      const tStart = performance.now();
      try {
        const vectorStr = `[${queryVector.join(',')}]`;
        const sql = `
          SELECT c.judgment_id AS id, 1 - MIN(c.embedding <=> $1::vector) AS score
          FROM chunks c
          JOIN judgments j ON c.judgment_id = j.id
          WHERE c.embedding IS NOT NULL
            AND ($2::text[] IS NULL OR j.court_level = ANY($2::text[]))
            AND ($3::text IS NULL OR j.case_type = $3::text)
            AND ($4::text IS NULL OR j.court = $4::text)
          GROUP BY c.judgment_id
          ORDER BY score DESC
          LIMIT 50;
        `;
        const res = await client.query(sql, [
          vectorStr,
          courtLevelList,
          caseType && caseType !== '全部' ? caseType : null,
          court && court.trim() !== '' ? court.trim() : null,
        ]);
        const tEnd = performance.now();
        return { 
          candidates: res.rows.map((r: any) => ({ id: r.id as string, score: Number(r.score) })), 
          time: (tEnd - tStart) + embedTime 
        };
      } finally {
        client.release();
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

    // 5. 【第三步：雙資料庫協調，撈取目標 ID 關係與文字全文】
    const detailsMap = new Map<string, any>();
    const commNameMap = new Map<number, string>();

    // 5.1 一次性統計 Neo4j 各社群最常引用的法規，用於動態語意命名
    const sessionComm = driverInstance.session();
    try {
      const commCypher = `
        MATCH (j:Judgment)-[:CITED]->(l:Law)
        WHERE j.community IS NOT NULL
        RETURN j.community AS comm_id, l.name AS law_name, count(j) AS usage_count
        ORDER BY j.community, usage_count DESC
      `;
      const commRes = await sessionComm.run(commCypher);
      const commGroups = new Map<number, string[]>();
      commRes.records.forEach(rec => {
        const cid = toJSNumber(rec.get('comm_id'));
        const law = rec.get('law_name') as string;
        const list = commGroups.get(cid) || [];
        if (list.length < 2) {
          const shortLaw = law.replace(/^中華民國/, '');
          list.push(shortLaw);
          commGroups.set(cid, list);
        }
      });
      commGroups.forEach((laws, cid) => {
        commNameMap.set(cid, `法律分群 ${cid} (主要引用：${laws.join('、')})`);
      });
    } catch (commError) {
      console.warn('⚠️ [Neo4j] 社群命名統計失敗:', commError);
    } finally {
      await sessionComm.close();
    }

    if (allTargetIds.length > 0) {
      // 5.2 並行執行：(1) 向 Neo4j 查詢實體關係與推薦，並套用強過濾 (2) 向 Postgres 撈取長文本
      
      const fetchNeo4jDetails = async () => {
        const session = driverInstance.session();
        try {
          const cypher = `
            MATCH (j:Judgment)
            WHERE j.id IN $allTargetIds
              AND ($judge IS NULL OR EXISTS { (j)-[:JUDGED_BY]->(:Person {name: $judge}) })
              AND ($citedLaw IS NULL OR EXISTS { (j)-[:CITED]->(:Law {name: $citedLaw}) })
            
            // 1. 圖關係案例推薦 (共享最多引用法規之 Judgment)
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
            
            // 2. 關聯其他實體
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
              j.community AS community,
              collect(distinct judge.name) AS judges,
              collect(distinct defendant.name) AS defendants,
              collect(distinct plaintiff.name) AS plaintiffs,
              collect(distinct law.name) AS cited_laws,
              similar_cases
          `;
          const res = await session.run(cypher, { 
            allTargetIds,
            judge: judge && judge.trim() !== '' ? judge.trim() : null,
            citedLaw: citedLaw && citedLaw.trim() !== '' ? citedLaw.trim() : null
          });
          
          return res.records.map(rec => {
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

            return {
              id: rec.get('id') as string,
              court: rec.get('court') as string,
              courtLevel: rec.get('court_level') as string,
              caseType: rec.get('case_type') as string,
              reason: rec.get('reason') as string,
              community: rec.get('community') !== null && rec.get('community') !== undefined ? toJSNumber(rec.get('community')) : null,
              judges: rec.get('judges') || [],
              defendants: cleanedDefendants,
              plaintiffs: rec.get('plaintiffs') || [],
              citedLaws: rec.get('cited_laws') || [],
              similarRecommendations: cleanedSimilar
            };
          });
        } finally {
          await session.close();
        }
      };

      const fetchPostgresTexts = async () => {
        const client = await pgPool.connect();
        try {
          const sql = `
            SELECT id, main_text, fact_reason 
            FROM judgments 
            WHERE id = ANY($1);
          `;
          const res = await client.query(sql, [allTargetIds]);
          const textMap = new Map<string, { mainText: string, factReason: string }>();
          res.rows.forEach((r: any) => {
            textMap.set(r.id, {
              mainText: r.main_text || '',
              factReason: r.fact_reason || ''
            });
          });
          return textMap;
        } finally {
          client.release();
        }
      };

      const [neo4jResults, pgTextMap] = await Promise.all([
        fetchNeo4jDetails(),
        fetchPostgresTexts()
      ]);

      // 5.3 在記憶體中進行雙寫組裝
      neo4jResults.forEach(item => {
        const textData = pgTextMap.get(item.id) || { mainText: '', factReason: '' };
        
        detailsMap.set(item.id, {
          ...item,
          mainText: textData.mainText,
          factReason: textData.factReason,
          communityName: item.community !== null ? (commNameMap.get(item.community) || `法律分群 ${item.community}`) : null
        });
      });
    }

    // 6. 【第四步：將詳情裝配回三欄結果中】
    const assembleList = (candidates: { id: string, score: number }[], targetIds: string[]) => {
      return targetIds
        .map(id => {
          const detail = detailsMap.get(id);
          const cand = candidates.find(c => c.id === id);
          if (!detail) return null; // 排除因為 Neo4j 階段二硬過濾 (法官/法條) 被排除的判決
          return {
            ...detail,
            maxSectionScore: cand ? cand.score : 0,
            searchScore: cand ? cand.score : 0
          };
        })
        .filter(item => item !== null);
    };

    const finalKeywordList = assembleList(keywordCandidates.map(c => ({ id: c.id, score: c.score })), keywordTargetIds);
    const finalVectorList = assembleList(vectorCandidates.map(c => ({ id: c.id, score: c.score })), vectorTargetIds);
    
    const finalHybridList = hybridTargetIds
      .map(id => {
        const detail = detailsMap.get(id);
        const cand = sortedRRF.find(c => c.id === id);
        if (!detail) return null; // 排除被 Neo4j 硬過濾的判決
        return {
          ...detail,
          maxSectionScore: cand ? cand.score : 0,
          rrfScore: cand ? cand.score : 0
        };
      })
      .filter(item => item !== null);

    // 7. 回傳三種搜尋演算法的結果對比與耗時
    const searchResult = {
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
    };

    // 寫入 Redis 快取
    if (useRedis && redisClient && cacheKey) {
      try {
        await redisClient.set(cacheKey, JSON.stringify(searchResult), 'EX', 259200); // 3天過期
        console.log(`💾 [Redis 快取寫入成功] Key: ${cacheKey}`);
      } catch (redisWriteError) {
        console.error('❌ [Redis 寫入錯誤]:', redisWriteError);
      }
    }

    const tEndAPI = performance.now();

    return NextResponse.json({
      ...searchResult,
      cacheHit: false,
      executionTimeMs: Math.round(tEndAPI - tStartAPI),
    });

  } catch (error: any) {
    console.error('[API 錯誤] 搜尋檢索執行失敗:', error);
    return NextResponse.json(
      { error: error.message || '後端伺服器內部發生未知錯誤' },
      { status: 500 }
    );
  }
}
