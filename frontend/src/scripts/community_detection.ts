import neo4j from 'neo4j-driver';
import * as dotenv from 'dotenv';
import * as path from 'path';

// 載入環境變數
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), 'frontend/.env.local') });

const NEO4J_URI = process.env.NEO4J_URI;
const NEO4J_USERNAME = process.env.NEO4J_USERNAME || 'neo4j';
const NEO4J_PASSWORD = process.env.NEO4J_PASSWORD;

if (!NEO4J_URI || !NEO4J_PASSWORD) {
  console.error("錯誤：缺少 Neo4j 連線環境變數！請確認 .env.local 檔案配置。");
  process.exit(1);
}

// 鄰居與權重結構
interface Neighbor {
  nodeIdx: number;
  weight: number;
}

export async function run_community_detection() {
  console.log("====== 開始執行法律判決書社群偵測 (LPA 演算法版) ======");
  const startTime = Date.now();

  console.log(`正在連線至 Neo4j 資料庫: ${NEO4J_URI} ...`);
  const driver = neo4j.driver(NEO4J_URI!, neo4j.auth.basic(NEO4J_USERNAME, NEO4J_PASSWORD!));

  try {
    const session = driver.session();
    
    // 1. 獲取所有 Judgment 節點的內部 ID 與外部 ID
    console.log("正在獲取所有判決書節點...");
    const nodesResult = await session.run("MATCH (j:Judgment) RETURN id(j) AS id, j.id AS case_no");
    
    const judgments: { neoId: number; case_no: string }[] = [];
    nodesResult.records.forEach(record => {
      // 在 neo4j-driver 中，id(j) 回傳的是 Integer 物件或 number，使用 toNumber() 安全轉換
      const neoId = record.get('id');
      const idVal = typeof neoId.toNumber === 'function' ? neoId.toNumber() : Number(neoId);
      judgments.push({
        neoId: idVal,
        case_no: record.get('case_no')
      });
    });

    const totalNodes = judgments.length;
    console.log(`成功獲取 ${totalNodes} 筆判決書。`);
    if (totalNodes === 0) {
      console.log("資料庫中無任何判決書，結束程式。");
      await session.close();
      return;
    }

    // 建立 Neo4j 內部 ID 到 0-based 陣列索引的雙向映射
    const neoIdToIdx = new Map<number, number>();
    const idxToNeoId: number[] = [];
    judgments.forEach((j, idx) => {
      neoIdToIdx.set(j.neoId, idx);
      idxToNeoId[idx] = j.neoId;
    });

    // 2. 查詢引用法條
    console.log("正在查詢判決書所引用的法規...");
    const citationResult = await session.run(`
      MATCH (j:Judgment)-[:CITED]->(l:Law)
      RETURN id(j) AS j_id, l.name AS law_name
    `);
    
    const lawToJudgments = new Map<string, number[]>();
    citationResult.records.forEach(record => {
      const neoId = record.get('j_id');
      const j_id = typeof neoId.toNumber === 'function' ? neoId.toNumber() : Number(neoId);
      const law_name = record.get('law_name');
      
      const list = lawToJudgments.get(law_name) || [];
      list.push(j_id);
      lawToJudgments.set(law_name, list);
    });
    console.log(`涉及的法規總數：${lawToJudgments.size}`);

    // 3. 在記憶體中計算共享法規的邊與權重
    console.log("正在計算判決書間共享法規的關聯邊...");
    const edgesCounter = new Map<string, number>();
    let ignoredLawsCount = 0;
    const UPPER_LIMIT = 150; // 過濾通用程序法條

    for (const [law_name, j_ids] of lawToJudgments.entries()) {
      if (j_ids.length < 2) continue;
      if (j_ids.length > UPPER_LIMIT) {
        ignoredLawsCount++;
        continue;
      }

      // 建立無向邊並計數 (加權)
      for (let i = 0; i < j_ids.length; i++) {
        for (let j = i + 1; j < j_ids.length; j++) {
          let u = j_ids[i];
          let v = j_ids[j];
          if (u === v) continue;
          if (u > v) {
            const temp = u;
            u = v;
            v = temp;
          }
          const key = `${u}_${v}`;
          edgesCounter.set(key, (edgesCounter.get(key) || 0) + 1);
        }
      }
    }
    console.log(`過濾了 ${ignoredLawsCount} 條過於通用的法條 (被引用數 > ${UPPER_LIMIT})。`);
    console.log(`計算出有關係的邊總數：${edgesCounter.size}`);

    // 4. 建立鄰接表
    const adj: Neighbor[][] = Array.from({ length: totalNodes }, () => []);
    let activeEdgesCount = 0;

    for (const [key, weight] of edgesCounter.entries()) {
      const [uIdStr, vIdStr] = key.split('_');
      const uId = Number(uIdStr);
      const vId = Number(vIdStr);
      
      const uIdx = neoIdToIdx.get(uId);
      const vIdx = neoIdToIdx.get(vId);
      
      if (uIdx !== undefined && vIdx !== undefined) {
        adj[uIdx].push({ nodeIdx: vIdx, weight });
        adj[vIdx].push({ nodeIdx: uIdx, weight });
        activeEdgesCount++;
      }
    }
    console.log(`實際建立於圖譜中的有效邊數：${activeEdgesCount}`);

    // 5. 執行標籤傳播演算法 (Label Propagation Algorithm - LPA)
    console.log("正在執行社群劃分 (LPA 演算法)...");
    let labels: number[] = Array.from({ length: totalNodes }, (_, i) => i);
    const maxIterations = 20;
    let converged = false;

    for (let iter = 1; iter <= maxIterations; iter++) {
      let changedCount = 0;
      const newLabels = [...labels];
      
      // 隨機打亂節點順序以防順序偏差 (Tie-breaking randomness)
      const order = shuffle(Array.from({ length: totalNodes }, (_, i) => i));

      for (const i of order) {
        const neighbors = adj[i];
        if (neighbors.length === 0) continue;

        // 統計鄰居的標籤權重和
        const labelWeights = new Map<number, number>();
        for (const nb of neighbors) {
          const l = labels[nb.nodeIdx];
          labelWeights.set(l, (labelWeights.get(l) || 0) + nb.weight);
        }

        // 尋找最大權重的標籤
        let maxLabel = labels[i];
        let maxWeight = -1;
        for (const [l, w] of labelWeights.entries()) {
          if (w > maxWeight) {
            maxWeight = w;
            maxLabel = l;
          } else if (w === maxWeight) {
            // 權重相同時，以確定性的方式決策（例如取較小的 label），保證重現性
            if (l < maxLabel) {
              maxLabel = l;
            }
          }
        }

        if (maxLabel !== labels[i]) {
          newLabels[i] = maxLabel;
          changedCount++;
        }
      }

      labels = newLabels;
      console.log(`  - 迭代 ${iter}: ${changedCount} 筆標籤發生變更`);
      if (changedCount === 0) {
        converged = true;
        console.log(`  - LPA 已收斂於第 ${iter} 次迭代。`);
        break;
      }
    }

    if (!converged) {
      console.log(`  - LPA 已達最大迭代次數 (${maxIterations})。`);
    }

    // 6. 整理與規整化社群 ID
    const uniqueLabels = Array.from(new Set(labels));
    const labelToCommId = new Map<number, number>();
    uniqueLabels.forEach((l, idx) => {
      labelToCommId.set(l, idx);
    });

    const membership = labels.map(l => labelToCommId.get(l)!);
    console.log(`社群劃分完成。總社群數：${uniqueLabels.length}。`);

    // 統計社群分佈
    const commCounts = new Map<number, number>();
    membership.forEach(commId => {
      commCounts.set(commId, (commCounts.get(commId) || 0) + 1);
    });

    const sortedComms = Array.from(commCounts.entries()).sort((a, b) => b[1] - a[1]);
    console.log("最大前 10 個社群之節點數量統計：");
    sortedComms.slice(0, 10).forEach(([c_id, count]) => {
      console.log(`  - 社群 ID ${c_id}: ${count} 筆判決`);
    });

    // 7. 批次將社群寫回 Neo4j
    console.log("正在將社群標籤批次寫入資料庫...");
    const writeData = membership.map((comm_id, idx) => ({
      id: idxToNeoId[idx],
      community: comm_id
    }));

    const updateQuery = `
      UNWIND $batches AS batch
      MATCH (j:Judgment)
      WHERE id(j) = batch.id
      SET j.community = batch.community
    `;

    const batchSize = 2000;
    for (let k = 0; k < writeData.length; k += batchSize) {
      const subBatch = writeData.slice(k, k + batchSize);
      await session.run(updateQuery, { batches: subBatch });
      console.log(`  已寫入 ${Math.min(k + batchSize, writeData.length)} / ${writeData.length} 筆節點`);
    }

    console.log("社群資料成功回填 Neo4j 屬性 `community`。");
    await session.close();

  } finally {
    await driver.close();
    console.log("Neo4j 連線已關閉。");
  }

  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log(`====== 社群偵測執行完畢！總耗時: ${duration} 秒 ======`);
}

function shuffle<T>(array: T[]): T[] {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = arr[i];
    arr[i] = arr[j];
    arr[j] = temp;
  }
  return arr;
}

if (require.main === module) {
  run_community_detection().catch(err => {
    console.error('執行社群偵測出錯：', err);
  });
}
