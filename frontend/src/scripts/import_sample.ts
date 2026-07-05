import * as path from 'path';
import * as dotenv from 'dotenv';
import { parse_court_from_folder } from './court_parser';
import { getJsonFiles, import_files } from './import_judgments';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), 'frontend/.env.local') });

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

export async function import_sample(data_dir: string, sample_limit: number = 10000) {
  console.log(`[抽樣程式] 開始掃描資料夾: ${data_dir}`);
  const json_files = getJsonFiles(data_dir);
  const total_files = json_files.length;
  console.log(`[抽樣程式] 共找到 ${total_files} 筆檔案。`);
  
  if (total_files === 0) {
    console.log("[抽樣程式] 無任何檔案可供抽樣。");
    return { success_count: 0, error_count: 0 };
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
  
  console.log("[抽樣程式] 案件分佈統計：");
  for (const [type, list] of Object.entries(classified)) {
    console.log(`  - ${type}: ${list.length} 筆`);
  }
  
  let sampled_files: string[] = [];
  const target_limit = Math.min(sample_limit, total_files);
  console.log(`[抽樣程式] 計劃抽樣總數: ${target_limit} 筆`);
  
  for (const [type, list] of Object.entries(classified)) {
    if (list.length === 0) continue;
    const proportion = list.length / total_files;
    const category_limit = Math.round(target_limit * proportion);
    const shuffled_list = shuffle(list);
    const samples = shuffled_list.slice(0, category_limit);
    sampled_files = sampled_files.concat(samples);
  }
  
  sampled_files = shuffle(sampled_files).slice(0, target_limit);
  console.log(`[抽樣程式] 實際抽樣檔案總數: ${sampled_files.length} 筆，即將調用雙寫導入 Pipeline...`);
  
  // 直接重用 import_judgments 的高併發雙寫 import_files
  return await import_files(sampled_files);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  let dataDir = 'data/202604';
  let limit = 10000;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--dir' && args[i + 1]) {
      dataDir = args[i + 1];
      i++;
    } else if (args[i] === '--limit' && args[i + 1]) {
      limit = parseInt(args[i + 1]);
      i++;
    }
  }

  import_sample(dataDir, limit).catch(err => {
    console.error('執行抽樣匯入出錯：', err);
  });
}
