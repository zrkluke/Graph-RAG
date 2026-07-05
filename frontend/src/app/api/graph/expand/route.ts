import { NextResponse } from 'next/server';
import neo4j, { Driver } from 'neo4j-driver';

declare global {
  var neo4jDriver: Driver | undefined;
}

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

function toJSNumber(val: any): number {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return val;
  if (typeof val.toNumber === 'function') return val.toNumber();
  if (val.low !== undefined) return val.low;
  return Number(val) || 0;
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const { nodeType, nodeId } = body;

    if (!nodeType || !nodeId) {
      return NextResponse.json({ error: '缺少必要的 nodeType 或 nodeId 參數！' }, { status: 400 });
    }

    const driverInstance = getNeo4jDriver();
    const session = driverInstance.session();

    const nodes: any[] = [];
    const edges: any[] = [];

    // 取得 Leiden 社群命名對照表 (動態載入以相容配色)
    const commNameMap = new Map<number, string>();
    try {
      const commCypher = `
        MATCH (j:Judgment)-[:CITED]->(l:Law)
        WHERE j.community IS NOT NULL
        RETURN j.community AS comm_id, l.name AS law_name, count(j) AS usage_count
        ORDER BY j.community, usage_count DESC
      `;
      const commRes = await session.run(commCypher);
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
    } catch (e) {
      console.error('[Expand API] 社群名稱加載失敗:', e);
    }

    try {
      if (nodeType === 'law') {
        // 雙擊法條節點：展開引用了該法規的其他 Judgment
        const cypher = `
          MATCH (l:Law {name: $nodeId})<-[:CITED]-(j:Judgment)
          RETURN 
            j.id AS id, 
            j.court AS court, 
            j.reason AS reason, 
            j.court_level AS court_level, 
            j.community AS community
          ORDER BY j.date DESC
          LIMIT 8
        `;
        const res = await session.run(cypher, { nodeId });
        res.records.forEach(rec => {
          const jId = rec.get('id');
          const comm = rec.get('community') !== null ? toJSNumber(rec.get('community')) : null;
          nodes.push({
            id: jId,
            label: jId.includes(',') ? jId.split(',').slice(-2, -1)[0] : jId,
            court: rec.get('court'),
            reason: rec.get('reason'),
            courtLevel: rec.get('court_level'),
            community: comm,
            communityName: comm !== null ? (commNameMap.get(comm) || `法律分群 ${comm}`) : null,
            type: 'judgment',
          });
          edges.push({
            from: jId,
            to: nodeId,
            type: 'CITED',
            label: '引用',
          });
        });

      } else if (nodeType === 'person') {
        // 雙擊人物節點：展開與該當事人/法官有關聯的其他 Judgment
        // 去掉 judge_, def_, plain_ 前綴
        const name = nodeId.replace(/^(judge_|def_|plain_)/, '');
        const cypher = `
          MATCH (p:Person {name: $name})<-[r:JUDGED_BY|DEFENDANT|PLAINTIFF|REPRESENTED_BY]-(j:Judgment)
          RETURN 
            j.id AS id, 
            type(r) AS rel_type,
            j.court AS court, 
            j.reason AS reason, 
            j.court_level AS court_level, 
            j.community AS community
          ORDER BY j.date DESC
          LIMIT 8
        `;
        const res = await session.run(cypher, { name });
        res.records.forEach(rec => {
          const jId = rec.get('id');
          const relType = rec.get('rel_type');
          const comm = rec.get('community') !== null ? toJSNumber(rec.get('community')) : null;
          nodes.push({
            id: jId,
            label: jId.includes(',') ? jId.split(',').slice(-2, -1)[0] : jId,
            court: rec.get('court'),
            reason: rec.get('reason'),
            courtLevel: rec.get('court_level'),
            community: comm,
            communityName: comm !== null ? (commNameMap.get(comm) || `法律分群 ${comm}`) : null,
            type: 'judgment',
          });
          edges.push({
            from: jId,
            to: nodeId,
            type: relType,
            label: relType === 'JUDGED_BY' ? '審判法官' : relType === 'DEFENDANT' ? '被告' : relType === 'PLAINTIFF' ? '原告' : '代理人',
          });
        });

      } else if (nodeType === 'judgment') {
        // 雙擊判決書節點：展開與該判決書共享最多引用法規的其他相似 Judgment 推薦 (二跳推薦)
        const cypher = `
          MATCH (j:Judgment {id: $nodeId})-[:CITED]->(l:Law)<-[:CITED]-(other:Judgment)
          WHERE other.id <> j.id
          RETURN 
            other.id AS id, 
            other.court AS court, 
            other.reason AS reason, 
            other.court_level AS court_level, 
            other.community AS community, 
            count(l) AS shared_count
          ORDER BY shared_count DESC, other.date DESC
          LIMIT 5
        `;
        const res = await session.run(cypher, { nodeId });
        res.records.forEach(rec => {
          const otherId = rec.get('id');
          const comm = rec.get('community') !== null ? toJSNumber(rec.get('community')) : null;
          const sharedCount = toJSNumber(rec.get('shared_count'));
          nodes.push({
            id: otherId,
            label: otherId.includes(',') ? otherId.split(',').slice(-2, -1)[0] : otherId,
            court: rec.get('court'),
            reason: rec.get('reason'),
            courtLevel: rec.get('court_level'),
            community: comm,
            communityName: comm !== null ? (commNameMap.get(comm) || `法律分群 ${comm}`) : null,
            type: 'judgment',
          });
          edges.push({
            from: nodeId,
            to: otherId,
            type: 'SIMILAR_TO',
            width: Math.max(1.5, sharedCount),
            label: `共引 ${sharedCount} 法`,
          });
        });
      }

    } finally {
      await session.close();
    }

    return NextResponse.json({ nodes, edges });

  } catch (error: any) {
    console.error('[API 錯誤] 圖譜節點展開失敗:', error);
    return NextResponse.json(
      { error: error.message || '後端伺服器內部發生未知錯誤' },
      { status: 500 }
    );
  }
}
