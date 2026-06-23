import * as fs from 'fs';
import * as path from 'path';
import neo4j from 'neo4j-driver';
import * as dotenv from 'dotenv';

import { parse_court_from_folder } from './court_parser';
import { clean_judgment_text } from './text_cleaner';
import { extract_statutes } from './statute_parser';
import { split_judgment_into_sections } from './judgment_splitter';

// 載入環境變數
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), 'frontend/.env.local') }); // 支援從根目錄執行時

export interface ExtractedParties {
  judges: string[];
  plaintiffs: string[];
  defendants: string[];
  representatives: string[];
}

export function extract_parties_and_judges(full_text: string): ExtractedParties {
  const lines = full_text.split('\n');
  
  // 1. 提取法官
  let judges: string[] = [];
  for (const line of lines) {
    const line_stripped = line.trim();
    // 尋找法官行，例如「法官 陳筠諼」或「審判長法官 陳筠諼」
    const judge_match = line_stripped.match(/(?:審判長法官|獨任法官|實習法官|法[ \t\u3000]*官)[ \t\u3000]*([^\r\n\s\u3000]+)/);
    if (judge_match) {
      let name = judge_match[1];
      // 過濾常見噪音字詞
      if (name && !["書記官", "正本", "以上", "處分", "判決"].some(k => name.includes(k))) {
        name = name.split(/[（(]/)[0].trim();
        if (name.length >= 2 && name.length <= 10) {  // 台灣人名通常在 2 至 10 字間
          judges.push(name);
        }
      }
    }
  }
  judges = Array.from(new Set(judges));

  // 2. 提取原告、被告、訴訟代理人 (在前 150 行當事人區塊中)
  let plaintiffs: string[] = [];
  let defendants: string[] = [];
  let representatives: string[] = [];
  
  let end_idx = lines.length;
  for (let idx = 0; idx < Math.min(lines.length, 150); idx++) {
    const line = lines[idx];
    if (["上列當事人間", "上開當事人間", "當事人間", "判決如下", "裁定如下", "主文", "事實及理由"].some(k => line.includes(k))) {
      end_idx = idx;
      break;
    }
  }
      
  let current_role: 'PLAINTIFF' | 'DEFENDANT' | 'REPRESENTATIVE' | null = null;
  
  for (let idx = 0; idx < end_idx; idx++) {
    const line_raw = lines[idx];
    const line_stripped = line_raw.trim();
    if (!line_stripped) {
      continue;
    }
      
    if (["共同", "共", "同"].includes(line_stripped)) {
      continue;
    }
      
    const is_p = line_raw.match(/^[ \t\u3000]*(?:上列)?原[ \t\u3000]*告[ \t\u3000]+([^\r\n]+)/);
    const is_d = line_raw.match(/^[ \t\u3000]*(?:上列)?被[ \t\u3000]*告[ \t\u3000]+([^\r\n]+)/);
    const is_rep = line_raw.match(/^[ \t\u3000]*(?:訴訟|法定|指定|複|共同)?代理人[ \t\u3000]+([^\r\n]+)/) ||
                   line_raw.match(/^[ \t\u3000]*(?:選任|指定|共同)?辯護人[ \t\u3000]+([^\r\n]+)/);
                 
    let name_part: string | null = null;
    if (is_p) {
      current_role = 'PLAINTIFF';
      name_part = is_p[1].trim();
    } else if (is_d) {
      current_role = 'DEFENDANT';
      name_part = is_d[1].trim();
    } else if (is_rep) {
      current_role = 'REPRESENTATIVE';
      name_part = is_rep[1].trim();
    } else {
      // 支援排版縮排的共同原告或被告
      if (current_role && (line_raw.startsWith(' ') || line_raw.startsWith('\t') || line_raw.startsWith('\u3000'))) {
        name_part = line_stripped;
      }
    }
                
    if (name_part) {
      // 清洗名字，切除住址、身份證號等資訊
      let name_clean = name_part.split(/[ \t\u3000]+(?:住|設|送達代收人|身分證|統一編號)/)[0];
      name_clean = name_clean.split(/[（(]/)[0].trim();
      
      if (name_clean) {
        if (!["共同", "共", "同", "原告", "被告", "訴訟代理人", "法定代理人", "辯護人", "上列"].includes(name_clean)) {
          if (current_role === 'PLAINTIFF') {
            plaintiffs.push(name_clean);
          } else if (current_role === 'DEFENDANT') {
            defendants.push(name_clean);
          } else if (current_role === 'REPRESENTATIVE') {
            representatives.push(name_clean);
          }
        }
      }
    }
  }
                        
  plaintiffs = Array.from(new Set(plaintiffs));
  defendants = Array.from(new Set(defendants));
  representatives = Array.from(new Set(representatives));
  
  return {
    judges,
    plaintiffs,
    defendants,
    representatives
  };
}

export async function init_db(driver: any) {
  const session = driver.session();
  try {
    console.log("建立 Unique Constraints...");
    await session.run("CREATE CONSTRAINT judgment_id_unique IF NOT EXISTS FOR (j:Judgment) REQUIRE j.id IS UNIQUE");
    await session.run("CREATE CONSTRAINT section_id_unique IF NOT EXISTS FOR (s:Section) REQUIRE s.id IS UNIQUE");
    await session.run("CREATE CONSTRAINT chunk_id_unique IF NOT EXISTS FOR (c:Chunk) REQUIRE c.id IS UNIQUE");
    await session.run("CREATE CONSTRAINT law_name_unique IF NOT EXISTS FOR (l:Law) REQUIRE l.name IS UNIQUE");
    await session.run("CREATE CONSTRAINT person_name_unique IF NOT EXISTS FOR (p:Person) REQUIRE p.name IS UNIQUE");
    
    console.log("建立 Full-Text Index...");
    await session.run(`
      CREATE FULLTEXT INDEX judgment_text_index IF NOT EXISTS 
      FOR (n:Judgment) 
      ON EACH [n.main_text, n.fact_reason]
    `);
  } finally {
    await session.close();
  }
}

export async function write_to_neo4j(tx: any, data: any) {
  // 1. 寫入 Judgment 節點
  const judgment_query = `
  MERGE (j:Judgment {id: $id})
  ON CREATE SET 
    j.case_type = $case_type,
    j.court = $court,
    j.court_level = $court_level,
    j.date = case when $date is not null then date($date) else null end,
    j.reason = $reason,
    j.main_text = $main_text,
    j.fact_reason = $fact_reason
  ON MATCH SET
    j.case_type = $case_type,
    j.court = $court,
    j.court_level = $court_level,
    j.date = case when $date is not null then date($date) else null end,
    j.reason = $reason,
    j.main_text = $main_text,
    j.fact_reason = $fact_reason
  `;
  await tx.run(judgment_query, data.judgment);
  
  // 1.5 批次寫入 Section 節點並與 Judgment 連接
  if (data.sections && data.sections.length > 0) {
    const section_query = `
    UNWIND $sections AS sec
    MERGE (s:Section {id: sec.id})
    ON CREATE SET 
      s.role = sec.role,
      s.type = sec.type,
      s.text = sec.text
    ON MATCH SET
      s.role = sec.role,
      s.type = sec.type,
      s.text = sec.text
    WITH sec, s
    MERGE (j:Judgment {id: $id})
    MERGE (j)-[:HAS_SECTION {index: sec.index}]->(s)
    `;
    await tx.run(section_query, { id: data.judgment.id, sections: data.sections });
  }
      
  // 1.6 批次寫入 Chunk 節點並與 Section 連接
  if (data.chunks && data.chunks.length > 0) {
    const chunk_query = `
    UNWIND $chunks AS chk
    MERGE (c:Chunk {id: chk.id})
    ON CREATE SET 
      c.text = chk.text
    ON MATCH SET
      c.text = chk.text
    WITH chk, c
    MERGE (s:Section {id: chk.section_id})
    MERGE (s)-[:HAS_CHUNK {index: chk.index}]->(c)
    `;
    await tx.run(chunk_query, { chunks: data.chunks });
  }
      
  // 2. 批次寫入並連接 Law 節點
  if (data.laws && data.laws.length > 0) {
    const law_query = `
    UNWIND $laws AS law_name
    MERGE (l:Law {name: law_name})
    WITH law_name, l
    MERGE (j:Judgment {id: $id})
    MERGE (j)-[:CITED]->(l)
    `;
    await tx.run(law_query, { id: data.judgment.id, laws: data.laws });
  }
      
  // 3. 批次寫入並連接 Person 節點 (原告)
  if (data.parties.plaintiffs && data.parties.plaintiffs.length > 0) {
    const p_query = `
    UNWIND $plaintiffs AS p_name
    MERGE (p:Person {name: p_name})
    WITH p_name, p
    MERGE (j:Judgment {id: $id})
    MERGE (j)-[:PLAINTIFF]->(p)
    `;
    await tx.run(p_query, { id: data.judgment.id, plaintiffs: data.parties.plaintiffs });
  }
      
  // 4. 批次寫入並連接 Person 節點 (被告)
  if (data.parties.defendants && data.parties.defendants.length > 0) {
    const d_query = `
    UNWIND $defendants AS d_name
    MERGE (p:Person {name: d_name})
    WITH d_name, p
    MERGE (j:Judgment {id: $id})
    MERGE (j)-[:DEFENDANT]->(p)
    `;
    await tx.run(d_query, { id: data.judgment.id, defendants: data.parties.defendants });
  }
      
  // 5. 代理人
  if (data.parties.representatives && data.parties.representatives.length > 0) {
    const r_query = `
    UNWIND $representatives AS r_name
    MERGE (p:Person {name: r_name})
    WITH r_name, p
    MERGE (j:Judgment {id: $id})
    MERGE (j)-[:REPRESENTED_BY]->(p)
    `;
    await tx.run(r_query, { id: data.judgment.id, representatives: data.parties.representatives });
  }
      
  // 6. 法官
  if (data.parties.judges && data.parties.judges.length > 0) {
    const j_query = `
    UNWIND $judges AS j_name
    MERGE (p:Person {name: j_name})
    WITH j_name, p
    MERGE (j:Judgment {id: $id})
    MERGE (j)-[:JUDGED_BY]->(p)
    `;
    await tx.run(j_query, { id: data.judgment.id, judges: data.parties.judges });
  }
}

export function getJsonFiles(dir: string): string[] {
  let results: string[] = [];
  if (!fs.existsSync(dir)) return [];
  const list = fs.readdirSync(dir);
  for (const file of list) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    if (stat && stat.isDirectory()) {
      results = results.concat(getJsonFiles(filePath));
    } else {
      if (file.endsWith('.json') && !file.startsWith('.')) {
        results.push(filePath);
      }
    }
  }
  return results;
}

export async function import_judgments(data_dir: string, limit?: number) {
  const uri = process.env.NEO4J_URI;
  const username = process.env.NEO4J_USERNAME || 'neo4j';
  const password = process.env.NEO4J_PASSWORD;
  const database = process.env.NEO4J_DATABASE || 'neo4j';
  
  if (!uri || !password) {
    console.log("[錯誤] 請確認環境變數中有設定 NEO4J_URI 與 NEO4J_PASSWORD！");
    return;
  }
      
  console.log(`開始連線 Neo4j AuraDB: ${uri} (Database: ${database})`);
  
  let driver;
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
    // 初始化資料庫索引與約束
    await init_db(driver);
    
    // 2. 尋找所有判決書 JSON 檔案
    let json_files = getJsonFiles(data_dir);
    const total_files = json_files.length;
    console.log(`找到 ${total_files} 筆判決書檔案。`);
    
    if (limit) {
      json_files = json_files.slice(0, limit);
      console.log(`已啟用限制：僅處理前 ${json_files.length} 筆檔案。`);
    }
        
    let success_count = 0;
    let error_count = 0;
    
    for (let idx = 0; idx < json_files.length; idx++) {
      const file_path = json_files[idx];
      const parent_folder = path.basename(path.dirname(file_path));
      
      // 解析法院資訊與案件種類
      const court_info = parse_court_from_folder(parent_folder);
      if (!court_info) {
        console.log(`[${idx + 1}/${json_files.length}] 警告：無法解析資料夾名稱 '${parent_folder}'，略過。`);
        error_count++;
        continue;
      }
          
      try {
        const file_content = fs.readFileSync(file_path, 'utf8');
        const data = JSON.parse(file_content);
        
        const jid = data.JID;
        const jdate = data.JDATE || '';
        const jtitle = data.JTITLE || '';
        const jfull = data.JFULL || '';
        
        if (!jid || !jfull) {
          console.log(`[${idx + 1}/${json_files.length}] 警告：檔案缺少 JID 或 JFULL，略過。`);
          error_count++;
          continue;
        }
        
        // 清洗與轉換
        const clean_text = clean_judgment_text(jfull);
        
        // 抽取法條與關係人
        const extracted_stats = extract_statutes(clean_text);
        let laws_list = extracted_stats.map(s => `${s.law}第${s.article}條${s.sub}`);
        laws_list = Array.from(new Set(laws_list));
        
        const parties = extract_parties_and_judges(jfull);
        
        // 格式化日期為 YYYY-MM-DD
        let date_str: string | null = null;
        if (jdate.length === 8) {
          date_str = `${jdate.substring(0, 4)}-${jdate.substring(4, 6)}-${jdate.substring(6, 8)}`;
        }
        
        // 分離「主文」與「事實及理由」
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
          main_text = jtitle;  // fallback
        }
        
        // 進行 Section 段落切分
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
          
          // 處理 Section 底下的 Chunks
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
        
        // 寫入 Neo4j
        const session = driver.session();
        try {
          await session.executeWrite(tx => write_to_neo4j(tx, import_data));
        } finally {
          await session.close();
        }
            
        success_count++;
        if ((idx + 1) % 5 === 0 || (idx + 1) === json_files.length) {
          console.log(`[${idx + 1}/${json_files.length}] 成功匯入 JID: {${jid}}`);
        }
      } catch (ex) {
        console.log(`[${idx + 1}/${json_files.length}] [錯誤] 匯入檔案 '${path.basename(file_path)}' 失敗: ${ex}`);
        error_count++;
      }
    }
    
    console.log(`\n[匯入完成] 成功：${success_count} 筆，失敗：${error_count} 筆。`);
  } finally {
    if (driver) {
      await driver.close();
      console.log("Neo4j 連線已關閉。");
    }
  }
}

// CLI 執行處理
if (require.main === module) {
  const args = process.argv.slice(2);
  let dataDir = 'data/202604';
  let limit: number | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dir' && args[i + 1]) {
      dataDir = args[i + 1];
      i++;
    } else if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1]);
      i++;
    }
  }

  import_judgments(dataDir, limit).catch(err => {
    console.error('執行匯入出錯：', err);
  });
}
