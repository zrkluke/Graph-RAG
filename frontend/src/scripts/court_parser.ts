import { SIMPLE_COURT_MAPPING, DISTRICT_COURT_MAPPING, HAC_COUNTY_MAPPING } from './court_mapping';

export interface CourtParseResult {
  unit_norm: string;
  court_root_norm: string;
  county: string;
  district: string | null;
  level: number;
  case_type: string | null;
}

export function to_generic_root_norm(unit_norm: string): string {
  if (unit_norm.includes("憲法法庭")) return "憲法法庭";
  if (unit_norm.includes("最高行政法院")) return "最高行政法院";
  if (unit_norm.includes("最高法院")) return "最高法院";
  if (unit_norm.includes("智慧財產")) return "智財商業法院";
  if (unit_norm.includes("簡易庭")) return "地方法院簡易庭";
  if (unit_norm.includes("地方庭")) return "高等行政法院地方庭";
  if (unit_norm.includes("行政法院")) return "高等行政法院";
  if (unit_norm.includes("高等法院")) return "高等法院";
  if (unit_norm.includes("少年") || unit_norm.includes("家事")) return "少家法院";
  if (unit_norm.includes("地方法院")) return "地方法院";
  return unit_norm;
}

export function parse_court_from_folder(folder_name: string): CourtParseResult | null {
  const match = folder_name.match(/(民事|刑事|行政|憲法|家事)$/);
  let case_type: string | null = null;
  let court_name = folder_name;
  if (match) {
    const raw_case_type = match[0];
    case_type = raw_case_type === '家事' ? '民事' : raw_case_type;
    court_name = folder_name.slice(0, match.index);
  }

  // 0. 憲法法庭
  if (court_name.includes("憲法法庭")) {
    return {
      unit_norm: "憲法法庭",
      court_root_norm: "憲法法庭",
      county: "臺北市",
      district: "中正區",
      level: 0,
      case_type,
    };
  }

  // 1. 最高行政法院
  if (court_name.includes("最高行政法院")) {
    return {
      unit_norm: "最高行政法院",
      court_root_norm: "最高行政法院",
      county: "臺北市",
      district: "中正區",
      level: 1,
      case_type,
    };
  }

  // 2. 最高法院
  if (court_name.includes("最高法院")) {
    return {
      unit_norm: "最高法院",
      court_root_norm: "最高法院",
      county: "臺北市",
      district: "中正區",
      level: 1,
      case_type,
    };
  }

  // 3. 智慧財產及商業法院
  if (court_name.includes("智慧財產及商業法院")) {
    return {
      unit_norm: "智慧財產及商業法院",
      court_root_norm: "智慧財產及商業法院",
      county: "新北市",
      district: "板橋區",
      level: 2,
      case_type,
    };
  }

  // 4. 高等行政法院地方庭
  if (court_name.includes("高等行政法院") && court_name.includes("地方庭")) {
    const city_match = court_name.match(/(臺北|臺中|高雄)高等行政法院/);
    if (city_match) {
      const city = city_match[1];
      const geo = HAC_COUNTY_MAPPING[city];
      return {
        unit_norm: `${city}高等行政法院地方庭`,
        court_root_norm: `${city}高等行政法院`,
        county: geo.county,
        district: geo.district,
        level: 3,
        case_type,
      };
    }
    console.log(`警告：無法解析高等行政法院地方庭城市 - ${folder_name}`);
    return null;
  }

  // 5. 高等行政法院
  if (court_name.includes("高等行政法院")) {
    const city_match = court_name.match(/(臺北|臺中|高雄)高等行政法院/);
    if (city_match) {
      const city = city_match[1];
      const geo = HAC_COUNTY_MAPPING[city];
      const unit_norm = `${city}高等行政法院`;
      return {
        unit_norm,
        court_root_norm: unit_norm,
        county: geo.county,
        district: geo.district,
        level: 2,
        case_type,
      };
    }
    console.log(`警告：無法解析高等行政法院城市 - ${folder_name}`);
    return null;
  }

  // 6. 高等法院
  if (court_name.includes("高等法院")) {
    const branch_match = court_name.match(/高等法院(.+)分院/);
    let county = "臺北市";
    if (branch_match) {
      const branch = branch_match[1];
      const county_map: Record<string, string> = {
        "臺中": "臺中市",
        "臺南": "臺南市",
        "花蓮": "花蓮縣",
        "高雄": "高雄市",
        "金門": "金門縣",
      };
      county = county_map[branch] || "未知";
    }
    return {
      unit_norm: court_name,
      court_root_norm: court_name,
      county,
      district: null,
      level: 2,
      case_type,
    };
  }

  // 7. 少年及家事法院
  if (court_name.includes("少年及家事法院")) {
    if (court_name === "臺灣高雄少年及家事法院") {
      return {
        unit_norm: "臺灣高雄少年及家事法院",
        court_root_norm: "臺灣高雄少年及家事法院",
        county: "高雄市",
        district: "楠梓區",
        level: 3,
        case_type,
      };
    }
    console.log(`警告：未支援的少年及家事法院 - ${court_name}`);
    return null;
  }

  // 8. 簡易庭
  if (court_name.includes("簡易庭")) {
    const simple_name = court_name.replace(/\(含.+\)/, '');
    const mapping = SIMPLE_COURT_MAPPING[simple_name];
    if (mapping) {
      return {
        unit_norm: mapping.parent_court + simple_name,
        court_root_norm: mapping.parent_court!,
        county: mapping.county,
        district: mapping.district,
        level: 4,
        case_type,
      };
    }
    console.log(`警告：未找到簡易庭對應 - ${simple_name}`);
    return null;
  }

  // 9. 地方法院
  if (court_name.includes("地方法院")) {
    const mapping = DISTRICT_COURT_MAPPING[court_name];
    if (mapping) {
      return {
        unit_norm: court_name,
        court_root_norm: court_name,
        county: mapping.county,
        district: mapping.district,
        level: 3,
        case_type,
      };
    }
    console.log(`警告：未找到地方法院對應 - ${court_name}`);
    return null;
  }

  console.log(`警告：無法解析法院名稱 - ${court_name}`);
  return null;
}
