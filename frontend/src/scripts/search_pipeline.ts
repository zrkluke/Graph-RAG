import neo4j from 'neo4j-driver';
import OpenAI from 'openai';
import * as dotenv from 'dotenv';
import * as path from 'path';

// 載入環境變數
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), 'frontend/.env.local') });

function toJSNumber(val: any): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return val;
  if (typeof val.toNumber === 'function') return val.toNumber();
  if (val.low !== undefined) return val.low;
  return Number(val) || 0;
}

export async function get_query_embedding(openai: OpenAI, text: string): Promise<number[]> {
  const cleanText = text.replace(/\n/g, ' ').trim();
  if (!cleanText) {
    throw new Error("查詢字串不能為空！");
  }
  const response = await openai.embeddings.create({
    model: 'text-embedding-3-small',
    input: cleanText
  });
  return response.data[0].embedding;
}

export async function search_similar_judgments(query_text: string, court_level?: string, case_type?: string, limit: number = 5) {
  const uri = process.env.NEO4J_URI;
  const username = process.env.NEO4J_USERNAME || 'neo4j';
  const password = process.env.NEO4J_PASSWORD;
  
  const openai_key = process.env.OPENAI_API_KEY;
  const openai_base = process.env.OPENAI_API_BASE;
  
  if (!uri || !password || !openai_key) {
    console.log("[錯誤] 請檢查環境變數中的連線與 API 金鑰設定！");
    return [];
  }

  const openai = new OpenAI({
    apiKey: openai_key,
    baseURL: openai_base || undefined
  });

  let queryVector: number[];
  try {
    queryVector = await get_query_embedding(openai, query_text);
  } catch (e) {
    console.log(`[錯誤] OpenAI 向量化失敗: ${e}`);
    return [];
  }

  const driver = neo4j.driver(uri, neo4j.auth.basic(username, password));
  try {
    const session = driver.session();
    try {
      const cypher_query = `
        // 1. 向量搜尋最相近的 Chunk，設定較大初篩空間
        CALL db.index.vector.queryNodes('chunk_embedding_index', 100, $queryVector)
        YIELD node AS chunk, score
        
        // 2. 透過關係還原至 Section 與 Judgment 判決書
        MATCH (s:Section)-[:HAS_CHUNK]->(chunk)
        MATCH (j:Judgment)-[:HAS_SECTION]->(s)
        
        // 3. 套用篩選
        WHERE ($court_level IS NULL OR j.court_level = $court_level)
          AND ($case_type IS NULL OR j.case_type = $case_type)
          
        // 4. 提取實體
        OPTIONAL MATCH (j)-[:JUDGED_BY]->(judge:Person)
        OPTIONAL MATCH (j)-[:DEFENDANT]->(defendant:Person)
        OPTIONAL MATCH (j)-[:PLAINTIFF]->(plaintiff:Person)
        OPTIONAL MATCH (j)-[:CITED]->(law:Law)
        
        // 5. 聚合數據與排序
        RETURN 
          j.id AS id,
          j.court AS court,
          j.court_level AS court_level,
          j.case_type AS case_type,
          j.reason AS reason,
          j.main_text AS main_text,
          max(score) AS score,
          collect(distinct judge.name) AS judges,
          collect(distinct defendant.name) AS defendants,
          collect(distinct plaintiff.name) AS plaintiffs,
          collect(distinct law.name) AS cited_laws
        ORDER BY score DESC
        LIMIT $limit
      `;

      const result = await session.run(cypher_query, {
        queryVector,
        court_level: court_level || null,
        case_type: case_type || null,
        limit: neo4j.int(limit)
      });

      return result.records.map(record => {
        const rawDefs = record.get('defendants') || [];
        const cleanedDefs = rawDefs.filter((name: string) => name && name !== '主　文' && name !== '主文');
        
        return {
          id: record.get('id'),
          court: record.get('court'),
          court_level: record.get('court_level'),
          case_type: record.get('case_type'),
          reason: record.get('reason'),
          main_text: record.get('main_text'),
          score: toJSNumber(record.get('score')),
          judges: record.get('judges') || [],
          defendants: cleanedDefs,
          plaintiffs: record.get('plaintiffs') || [],
          cited_laws: record.get('cited_laws') || []
        };
      });

    } finally {
      await session.close();
    }
  } finally {
    await driver.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  let queryText = "";
  let courtLevel: string | undefined;
  let caseType: string | undefined;
  let limit = 3;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--court-level' && args[i + 1]) {
      courtLevel = args[i + 1];
      i++;
    } else if (args[i] === '--case-type' && args[i + 1]) {
      caseType = args[i + 1];
      i++;
    } else if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1]);
      i++;
    } else if (!args[i].startsWith('--')) {
      queryText = args[i];
    }
  }

  if (!queryText) {
    console.log("用法: npm run db:search -- \"<您的查詢字串>\" [--court-level \"地方法院\"] [--case-type \"刑事\"] [--limit 3]");
    process.exit(1);
  }

  console.log(`正在搜尋相似判決，查詢字串: "${queryText}" ...`);
  const results = await search_similar_judgments(queryText, courtLevel, caseType, limit);
  
  console.log(`\n找到 ${results.length} 筆相似判決：\n`);
  results.forEach((r, idx) => {
    console.log(`[${idx + 1}] 判決字號: ${r.id} (相似度分數: ${r.score.toFixed(4)})`);
    console.log(`    法院: ${r.court} (${r.court_level}) | 案由: ${r.reason}`);
    console.log(`    法官: ${r.judges.join(', ') || '無'}`);
    console.log(`    被告: ${r.defendants.join(', ') || '無'}`);
    console.log(`    原告: ${r.plaintiffs.join(', ') || '無'}`);
    console.log(`    引用法條: ${r.cited_laws.slice(0, 5).join(', ')}${r.cited_laws.length > 5 ? '...' : ''}`);
    console.log(`    主文: ${r.main_text.replace(/\r?\n/g, ' ')}\n`);
  });
}

if (require.main === module) {
  main().catch(err => {
    console.error('搜尋出錯：', err);
    process.exit(1);
  });
}
