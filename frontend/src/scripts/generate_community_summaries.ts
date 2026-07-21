import neo4j from 'neo4j-driver';
import { getPostgresPool } from '../lib/postgres';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// 載入環境變數
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), 'frontend/.env.local') });

const NEO4J_URI = process.env.NEO4J_URI;
const NEO4J_USERNAME = process.env.NEO4J_USERNAME || 'neo4j';
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD;

if (!NEO4J_URI || !NEO4J_PASSWORD) {
  console.error("錯誤：缺少 Neo4j 連線環境變數！請確認環境設定。");
  process.exit(1);
}

interface CommunitySummary {
  community_id: number;
  judgment_count: number;
  representative_laws: string[];
  representative_crimes: string[];
  representative_items: string[];
  keywords: string[];
  representative_sentence: string;
}

// 繁體中文常用停用詞
const STOP_WORDS = new Set([
  '的', '了', '在', '是', '與', '等', '及', '或', '之', '而', '為', '以', '於', '有', '人', '被', 
  '所', '本', '此', '他', '她', '它', '因', '向', '自', '至', '並', '已', '經', '且', '將', '者', 
  '其', '但', '即', '又', '也', '雖', '然', '但', '至', '從', '到', '往', '返', '前', '後', '左', 
  '右', '中', '內', '外', '上', '下', '度', '分', '秒', '日', '月', '年', '時', '分', '毫克', 
  '公升', '被告', '原告', '法官', '判決', '原告人', '被告人', '訴訟', '代理人', '車輛', '駕駛', 
  '車禍', '發生', '進行', '地方', '法院', '裁判', '理由', '事實', '陳述', '主張', '認定',
  '中華民國', '刑事', '民事', '案件', '宣告', '處罰', '裁判書', '部分', '以上', '以下', 
  '以下空白', '因此', '如果', '一個', '一般', '其中'
]);

// 輔助函數：提取 N-grams
function extractNGrams(text: string, minLen = 2, maxLen = 4): Map<string, number> {
  const freqs = new Map<string, number>();
  // 使用標點符號與特殊字元切分片語，只在中文片語內部滑動
  const segments = text.split(/[，。；：、「」（）〔〕［］“”‘’？！\s\d\w\-\.\/\\\*⚖️🔗🎯🏆💡]/);
  
  for (const segment of segments) {
    const cleanSegment = segment.trim();
    if (cleanSegment.length < minLen) continue;
    
    for (let len = minLen; len <= maxLen; len++) {
      for (let i = 0; i <= cleanSegment.length - len; i++) {
        const gram = cleanSegment.substring(i, i + len);
        
        // 過濾包含停用詞的 n-gram（如果首字或尾字是停用詞，或整個詞在停用詞中則過濾）
        if (STOP_WORDS.has(gram) || STOP_WORDS.has(gram[0]) || STOP_WORDS.has(gram[gram.length - 1])) {
          continue;
        }
        
        freqs.set(gram, (freqs.get(gram) || 0) + 1);
      }
    }
  }
  return freqs;
}

export async function generateSummaries() {
  console.log("====== 開始生成「無 LLM 社群特徵摘要」 ======");
  const startTime = Date.now();

  const driver = neo4j.driver(NEO4J_URI!, neo4j.auth.basic(NEO4J_USERNAME, NEO4J_PASSWORD!));
  const pgPool = getPostgresPool();
  
  try {
    const session = driver.session();
    
    // 1. 查詢所有不重複的社群 ID 及其判決書數量
    console.log("正在從 Neo4j 查詢社群分佈...");
    const commsResult = await session.run(`
      MATCH (j:Judgment)
      WHERE j.community IS NOT NULL
      RETURN j.community AS commId, count(j) AS cnt
      ORDER BY cnt DESC
    `);
    
    const allCommunities: { id: number; count: number }[] = commsResult.records.map((rec: any) => ({
      id: Number(rec.get('commId')),
      count: Number(rec.get('cnt'))
    }));
    
    const MIN_COMMUNITY_SIZE = 5;
    const communities = allCommunities.filter(c => c.count >= MIN_COMMUNITY_SIZE);
    
    console.log(`共發現 ${allCommunities.length} 個社群，過濾掉微型社群 (小於 ${MIN_COMMUNITY_SIZE} 筆判決) 後，剩下 ${communities.length} 個活躍社群。`);
    if (communities.length === 0) {
      console.log("無符合篩選大小之活躍社群，結束程序。");
      await session.close();
      return;
    }

    const allCommunitySummaries: CommunitySummary[] = [];
    
    // 準備計算 TF-IDF。我們需要統計每個 N-gram 出現在多少個社群中 (DF)
    const communityNGrams: Map<number, Map<string, number>> = new Map();
    const docFrequency = new Map<string, number>(); // 詞 -> 出現的社群數
    const communityChunksMap = new Map<number, string[]>(); // 社群 ID -> chunks 文本陣列，避免重複查詢

    // 2. 批次查詢每個社群的判決書 ID，並從 Postgres 撈取文本，提取 N-grams
    console.log("\n📖 步驟 A：從 Postgres 撈取 Chunks 並統計社群詞頻...");
    for (const comm of communities) {
      const commId = comm.id;
      
      // 獲取該社群所有的判決書 ID
      const jidsResult = await session.run(`
        MATCH (j:Judgment) WHERE j.community = $commId RETURN j.id AS id
      `, { commId });
      const judgmentIds = jidsResult.records.map((rec: any) => rec.get('id') as string);
      
      if (judgmentIds.length === 0) continue;

      // 限制大社群的採樣數量，最多只取前 50 筆判決進行特徵提取，避免大社群 OOM
      const sampledIds = judgmentIds.length > 50 ? judgmentIds.slice(0, 50) : judgmentIds;

      // 自 Postgres 撈取 Chunks 文字
      const pgClient = await pgPool.connect();
      let chunkTexts: string[] = [];
      try {
        const res = await pgClient.query(`
          SELECT text FROM chunks WHERE judgment_id = ANY($1)
        `, [sampledIds]);
        chunkTexts = res.rows.map(r => r.text);
      } finally {
        pgClient.release();
      }

      // 快取 Chunks 文本以供步驟 B 萃取代表句重複使用
      communityChunksMap.set(commId, chunkTexts);

      // 合併文本以提取 N-grams
      const chunksText = chunkTexts.join('\n');
      const ngrams = extractNGrams(chunksText);
      communityNGrams.set(commId, ngrams);

      // 累加 DF (Document Frequency)
      for (const word of ngrams.keys()) {
        docFrequency.set(word, (docFrequency.get(word) || 0) + 1);
      }
      console.log(`  - 社群 ${commId}: 讀取 ${judgmentIds.length} 筆判決 (採樣 ${sampledIds.length} 筆)，提取了 ${ngrams.size} 個特徵詞`);
    }

    // 3. 計算 TF-IDF 並對每個社群進行特徵提取
    console.log("\n📊 步驟 B：計算 TF-IDF 關鍵詞與圖譜實體統計...");
    const N = communities.length; // 總社群數

    for (const comm of communities) {
      const commId = comm.id;
      const ngrams = communityNGrams.get(commId) || new Map<string, number>();
      
      // 計算 TF-IDF
      const tfidfList: { word: string; score: number }[] = [];
      for (const [word, tf] of ngrams.entries()) {
        const df = docFrequency.get(word) || 0;
        const idf = Math.log2(N / (df + 1)) + 1;
        tfidfList.push({ word, score: tf * idf });
      }
      
      // 排序並取 Top 10 關鍵詞
      const topKeywords = tfidfList
        .sort((a, b) => b.score - a.score)
        .slice(0, 10)
        .map(x => x.word);

      // 4. 統計社群關聯之實體 (Top 3 法規, 罪名, 事證)
      const lawsRes = await session.run(`
        MATCH (j:Judgment)-[:CITED]->(l:Law) WHERE j.community = $commId
        RETURN l.name AS name, count(j) AS count ORDER BY count DESC LIMIT 3
      `, { commId });
      const representativeLaws = lawsRes.records.map((rec: any) => rec.get('name') as string);

      const crimesRes = await session.run(`
        MATCH (j:Judgment)-[:CHARGED_WITH]->(c:Crime) WHERE j.community = $commId
        RETURN c.name AS name, count(j) AS count ORDER BY count DESC LIMIT 3
      `, { commId });
      const representativeCrimes = crimesRes.records.map((rec: any) => rec.get('name') as string);

      const itemsRes = await session.run(`
        MATCH (j:Judgment)-[:FOUND_WITH]->(i:Item) WHERE j.community = $commId
        RETURN i.name AS name, count(j) AS count ORDER BY count DESC LIMIT 5
      `, { commId });
      const representativeItems = itemsRes.records.map((rec: any) => rec.get('name') as string);

      // 5. 萃取代表句 (方法三) - 直接使用步驟 A 快取的 chunksText，消除重複資料庫查詢
      const chunkTexts = communityChunksMap.get(commId) || [];
      let sentences: string[] = [];
      chunkTexts.forEach(txt => {
        const sents = txt.split(/[。]/).map(s => s.trim()).filter(s => s.length >= 30 && s.length <= 120);
        sentences.push(...sents);
      });

      // 去重
      sentences = Array.from(new Set(sentences));

      // 對句子評分：包含 Top 關鍵字、代表法條、代表罪名的數量
      let bestSentence = "無符合之代表性判決陳述。";
      let maxScore = -1;

      for (const sent of sentences) {
        let score = 0;
        
        // 關鍵字匹配
        topKeywords.forEach(kw => {
          if (sent.includes(kw)) score += 1.5;
        });
        
        // 法條匹配
        representativeLaws.forEach((law: string) => {
          // 去除中華民國等前綴加速匹配
          const shortLaw = law.replace(/^中華民國/, '');
          if (sent.includes(shortLaw)) score += 2;
        });

        // 罪名匹配
        representativeCrimes.forEach((crime: string) => {
          if (sent.includes(crime)) score += 2;
        });

        // 長度懲罰與獎勵（我們偏好 50~90 字的句子，訊息量較飽滿）
        if (sent.length >= 50 && sent.length <= 90) {
          score += 1;
        }

        if (score > maxScore) {
          maxScore = score;
          bestSentence = sent + "。"; // 補回句號
        }
      }

      allCommunitySummaries.push({
        community_id: commId,
        judgment_count: comm.count,
        representative_laws: representativeLaws,
        representative_crimes: representativeCrimes,
        representative_items: representativeItems,
        keywords: topKeywords,
        representative_sentence: bestSentence
      });
      
      console.log(`  🎉 社群 ${commId} 摘要建立完畢！關鍵詞：${topKeywords.slice(0, 5).join('、')} | 代表句長度：${bestSentence.length} 字`);
    }

    // 6. 輸出成 JSON 檔案
    const outputDir = path.resolve(process.cwd(), 'src/resources');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    const outputPath = path.resolve(outputDir, 'community_summaries.json');
    fs.writeFileSync(outputPath, JSON.stringify(allCommunitySummaries, null, 2), 'utf8');
    
    console.log(`\n💾 社群特徵摘要成功寫入檔案: ${outputPath}`);
    await session.close();

  } catch (error) {
    console.error("生成社群摘要出錯：", error);
  } finally {
    await driver.close();
    await pgPool.end();
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`====== 社群特徵摘要生成完畢！總耗時: ${duration} 秒 ======`);
}

// 當直接執行此檔案時
if (require.main === module) {
  generateSummaries().catch(err => {
    console.error('執行摘要生成出錯：', err);
  });
}
