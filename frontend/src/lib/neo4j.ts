import neo4j, { Driver } from 'neo4j-driver';

declare global {
  var neo4jDriver: Driver | undefined;
}

export function getNeo4jDriver(): Driver {
  if (!globalThis.neo4jDriver) {
    const uri = process.env.NEO4J_URI;
    const user = process.env.NEO4J_USERNAME || 'neo4j';
    const password = process.env.NEO4J_PASSWORD;

    if (!uri || !password) {
      throw new Error('缺少 Neo4j 連線環境變數！');
    }

    console.log('🔌 [Neo4j] 初始化連線驅動...');
    globalThis.neo4jDriver = neo4j.driver(uri, neo4j.auth.basic(user, password));
  }
  return globalThis.neo4jDriver;
}
