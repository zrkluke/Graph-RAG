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

export async function POST(request: Request) {
  try {
    // 1. 解析前端 Body 傳參
    const body = await request.json().catch(() => ({}));
    const { query, courtLevel, caseType, limit = 3 } = body;

    if (!query || typeof query !== 'string' || !query.trim()) {
      return NextResponse.json({ error: '請提供有效的案情情境描述！' }, { status: 400 });
    }

    // 2. 使用 OpenAI 將案情文字向量化 (Embedding)
    const embeddingResponse = await openai.embeddings.create({
      model: 'text-embedding-3-small',
      input: query.replace(/\n/g, ' ').trim(),
    });
    const queryVector = embeddingResponse.data[0].embedding;

    // 3. 連線 Neo4j 資料庫執行混合 Cypher 檢索
    const driverInstance = getNeo4jDriver();
    const session = driverInstance.session();

    try {
      // 混合檢索 Cypher 查詢 (1:1 翻譯 Python 原型查詢，並適配 Next.js 命名規範)
      const cypherQuery = `
        // 1. 向量搜尋最相近的 Section，設定初篩空間為 100 筆
        CALL db.index.vector.queryNodes('section_embedding_index', 100, $queryVector)
        YIELD node AS sec, score
        
        // 2. 透過 HAS_SECTION 關係關聯回 Judgment 判決書
        MATCH (j:Judgment)-[:HAS_SECTION]->(sec)
        
        // 3. 套用法院層級與案件種類過濾
        WHERE ($courtLevel IS NULL OR j.court_level = $courtLevel)
          AND ($caseType IS NULL OR j.case_type = $caseType)
          
        // 4. 提取去重後的法官、原告、被告與引用法規
        OPTIONAL MATCH (j)-[:JUDGED_BY]->(judge:Person)
        OPTIONAL MATCH (j)-[:DEFENDANT]->(defendant:Person)
        OPTIONAL MATCH (j)-[:PLAINTIFF]->(plaintiff:Person)
        OPTIONAL MATCH (j)-[:CITED]->(law:Law)
        
        // 5. 聚合數據，取 Section 匹配的最高得分作為該 Judgment 的相似度分數
        RETURN 
          j.id AS id,
          j.court AS court,
          j.court_level AS court_level,
          j.case_type AS case_type,
          j.reason AS reason,
          j.main_text AS main_text,
          j.fact_reason AS fact_reason,
          max(score) AS max_section_score,
          collect(distinct judge.name) AS judges,
          collect(distinct defendant.name) AS defendants,
          collect(distinct plaintiff.name) AS plaintiffs,
          collect(distinct law.name) AS cited_laws
        ORDER BY max_section_score DESC
        LIMIT toInteger($limit)
      `;

      const queryParams = {
        queryVector,
        courtLevel: courtLevel && courtLevel !== '全部' ? courtLevel : null,
        caseType: caseType && caseType !== '全部' ? caseType : null,
        limit: Number(limit),
      };

      const result = await session.run(cypherQuery, queryParams);

      // 4. 對回傳資料進行格式清洗，排除被告人中的雜訊
      const records = result.records.map((rec) => {
        const rawDefendants = rec.get('defendants') || [];
        const cleanedDefendants = rawDefendants.filter(
          (name: string) => name && name !== '主　文' && name !== '主文'
        );

        return {
          id: rec.get('id'),
          court: rec.get('court'),
          courtLevel: rec.get('court_level'),
          caseType: rec.get('case_type'),
          reason: rec.get('reason'),
          mainText: rec.get('main_text'),
          factReason: rec.get('fact_reason'),
          maxSectionScore: rec.get('max_section_score'),
          judges: rec.get('judges') || [],
          defendants: cleanedDefendants,
          plaintiffs: rec.get('plaintiffs') || [],
          citedLaws: rec.get('cited_laws') || [],
        };
      });

      return NextResponse.json({ results: records });
    } finally {
      await session.close();
    }
  } catch (error: any) {
    console.error('[API 錯誤] 混合檢索執行失敗:', error);
    return NextResponse.json(
      { error: error.message || '後端伺服器內部發生未知錯誤' },
      { status: 500 }
    );
  }
}
