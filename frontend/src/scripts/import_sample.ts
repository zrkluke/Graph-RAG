import * as fs from 'fs';
import * as path from 'path';
import neo4j from 'neo4j-driver';
import * as dotenv from 'dotenv';

import { parse_court_from_folder } from './court_parser';
import { clean_judgment_text } from './text_cleaner';
import { extract_statutes } from './statute_parser';
import { split_judgment_into_sections } from './judgment_splitter';
import { extract_parties_and_judges, init_db, write_to_neo4j, getJsonFiles } from './import_judgments';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), 'frontend/.env.local') });

// 控制 Promise 執行的並行池
async function executeWithConcurrency<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = [];
  const executing: Promise<void>[] = [];
  
  for (const task of tasks) {
    const p = task().then(res => {
      results.push(res);
      executing.splice(executing.indexOf(p), 1);
    });
    executing.push(p);
    if (executing.length >= limit) {
      await Promise.race(executing);
    }
  }
  await Promise.all(executing);
  return results;
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

export async function import_sample(data_dir: string, sample_limit: number = 10000, concurrency_limit: number = 5) {
  const uri = process.env.NEO4J_URI;
  const username = process.env.NEO4J_USERNAME || 'neo4j';
  const password = process.env.NEO4J_PASSWORD;
  const database = process.env.NEO4J_DATABASE || 'neo4j';
  
  if (!uri || !password) {
    console.log("[錯誤] 請確認環境變數中有設定 NEO4J_URI 與 NEO4J_PASSWORD！");
    return;
  }
  
  console.log(`開始連線 Neo4j AuraDB: ${uri} (Database: ${database})`);
  let driver: any;
  try {
    driver = neo4j.driver(uri, neo4j.auth.basic(username, password));
    await driver.verifyConnectivity();
    console.log("Neo4j 連線成功。");
  } catch (e) {
    console.log(`[錯誤] Neo4j 連線失敗: ${e}`);
    if (driver) await driver.close();
    return;
  }
  
  try {
    // 1. 初始化資料庫索引與約束
    await init_db(driver);
    
    // 2. 獲取所有 JSON 檔案並按 case_type 分類
    console.log("正在掃描資料夾並分類檔案...");
    const json_files = getJsonFiles(data_dir);
    const total_files = json_files.length;
    console.log(`共找到 ${total_files} 筆檔案。`);
    
    if (total_files === 0) {
      console.log("無任何檔案可供抽樣。");
      return;
    }
    
    const classified: Record<string, string[]> = {
      '民事': [],
      '刑事': [],
      '行政': [],
      '其他': []
    };
    
    for (const file of json_files) {
      const parent_folder = path.basename(path.dirname(file));
      const court_info = parse_court_from_folder(parent_folder);
      const case_type = (court_info && court_info.case_type) || '其他';
      if (classified[case_type]) {
        classified[case_type].push(file);
      } else {
        classified['其他'].push(file);
      }
    }
    
    console.log("案件分佈統計：");
    for (const [type, list] of Object.entries(classified)) {
      console.log(`  - ${type}: ${list.length} 筆`);
    }
    
    // 3. 按照比例隨機抽樣
    let sampled_files: string[] = [];
    const target_limit = Math.min(sample_limit, total_files);
    console.log(`計劃抽樣總數: ${target_limit} 筆`);
    
    for (const [type, list] of Object.entries(classified)) {
      if (list.length === 0) continue;
      const proportion = list.length / total_files;
      const category_limit = Math.round(target_limit * proportion);
      const shuffled_list = shuffle(list);
      const samples = shuffled_list.slice(0, category_limit);
      sampled_files = sampled_files.concat(samples);
      console.log(`  * ${type} 抽樣: ${samples.length} / ${list.length} 筆`);
    }
    
    // 確保總抽樣筆數不超過限制
    sampled_files = shuffle(sampled_files).slice(0, target_limit);
    console.log(`實際抽樣檔案總數: ${sampled_files.length} 筆。`);
    
    let success_count = 0;
    let error_count = 0;
    let processed_count = 0;
    
    // 4. 準備任務隊列
    const tasks = sampled_files.map((file_path, idx) => {
      return async () => {
        const parent_folder = path.basename(path.dirname(file_path));
        const court_info = parse_court_from_folder(parent_folder);
        if (!court_info) {
          error_count++;
          processed_count++;
          return;
        }
        
        try {
          const file_content = fs.readFileSync(file_path, 'utf8');
          const data = JSON.parse(file_content);
          
          const jid = data.JID;
          const jdate = data.JDATE || '';
          const jtitle = data.JTITLE || '';
          const jfull = data.JFULL || '';
          
          if (!jid || !jfull) {
            error_count++;
            processed_count++;
            return;
          }
          
          // 清洗與轉換
          const clean_text = clean_judgment_text(jfull);
          const extracted_stats = extract_statutes(clean_text);
          let laws_list = extracted_stats.map(s => `${s.law}第${s.article}條${s.sub}`);
          laws_list = Array.from(new Set(laws_list));
          
          const parties = extract_parties_and_judges(jfull);
          
          let date_str: string | null = null;
          if (jdate.length === 8) {
            date_str = `${jdate.substring(0, 4)}-${jdate.substring(4, 6)}-${jdate.substring(6, 8)}`;
          }
          
          let main_text = "";
          let fact_reason = clean_text;
          const split_patterns = [/事實及理由\r?\n/, /事實\r?\n/, /理　由\r?\n/, /理由\r?\n/];
          for (const p of split_patterns) {
            const parts = clean_text.split(p);
            if (parts.length >= 2) {
              main_text = parts[0].trim();
              fact_reason = parts.slice(1).join('\n').trim();
              break;
            }
          }
          
          if (!main_text) {
            main_text = jtitle;
          }
          
          const sections_list = split_judgment_into_sections(court_info.case_type || '其他', fact_reason);
          const formatted_sections: any[] = [];
          const formatted_chunks: any[] = [];
          
          for (const sec of sections_list) {
            const sec_id = `${jid}_sec_${sec.index}`;
            formatted_sections.push({
              id: sec_id,
              index: sec.index,
              role: sec.role,
              type: sec.type,
              text: sec.text
            });
            
            const chunks_list = sec.chunks || [];
            for (let chk_idx = 0; chk_idx < chunks_list.length; chk_idx++) {
              formatted_chunks.push({
                id: `${sec_id}_chk_${chk_idx + 1}`,
                section_id: sec_id,
                index: chk_idx + 1,
                text: chunks_list[chk_idx]
              });
            }
          }
          
          const import_data = {
            judgment: {
              id: jid,
              case_type: court_info.case_type,
              court: court_info.unit_norm,
              court_level: court_info.court_root_norm,
              date: date_str,
              reason: jtitle,
              main_text: main_text,
              fact_reason: fact_reason
            },
            sections: formatted_sections,
            chunks: formatted_chunks,
            laws: laws_list,
            parties: parties
          };
          
          const session = driver.session();
          try {
            await session.executeWrite((tx: any) => write_to_neo4j(tx, import_data));
          } finally {
            await session.close();
          }
          
          success_count++;
        } catch (e) {
          console.log(`[錯誤] 處理抽樣檔案 '${path.basename(file_path)}' 失敗: ${e}`);
          error_count++;
        } finally {
          processed_count++;
          if (processed_count % 10 === 0 || processed_count === sampled_files.length) {
            console.log(`[進度] 已處理 ${processed_count} / ${sampled_files.length} 筆`);
          }
        }
      };
    });
    
    console.log(`正在並行匯入資料 (並行限制: ${concurrency_limit})...`);
    const start_time = Date.now();
    await executeWithConcurrency(tasks, concurrency_limit);
    const duration = ((Date.now() - start_time) / 1000).toFixed(2);
    
    console.log(`\n[抽樣匯入完成] 耗時: ${duration} 秒。成功: ${success_count} 筆，失敗: ${error_count} 筆。`);
  } finally {
    if (driver) {
      await driver.close();
      console.log("Neo4j 連線已關閉。");
    }
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  let dataDir = 'data/202604';
  let limit = 10000;
  let concurrency = 5;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dir' && args[i + 1]) {
      dataDir = args[i + 1];
      i++;
    } else if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1]);
      i++;
    } else if (args[i] === '--concurrency' && args[i + 1]) {
      concurrency = parseInt(args[i + 1]);
      i++;
    }
  }

  import_sample(dataDir, limit, concurrency).catch(err => {
    console.error('執行抽樣匯入出錯：', err);
  });
}
