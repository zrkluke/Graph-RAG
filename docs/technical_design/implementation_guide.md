# Neo4j Graph RAG 實現指南

## 1. 環境設置

### 1.1 依賴安裝
```bash
# 安裝 Python 依賴
pip install -r requirements.txt

# 啟動 Neo4j 容器
docker-compose up -d
```

### 1.2 requirements.txt
```txt
neo4j==5.15.0
langchain==0.1.0
langchain-community==0.0.10
langchain-openai==0.0.5
sentence-transformers==2.2.2
torch==2.1.0
transformers==4.35.0
spacy==3.7.2
networkx==3.2.1
pandas==2.1.3
numpy==1.24.3
fastapi==0.104.1
uvicorn==0.24.0
python-multipart==0.0.6
pydantic==2.5.0
```

## 2. 核心組件實現

### 2.1 Neo4j 連接管理
```python
# src/database/neo4j_client.py
from neo4j import GraphDatabase
from typing import Dict, List, Any
import logging

class Neo4jClient:
    def __init__(self, uri: str, user: str, password: str):
        self.driver = GraphDatabase.driver(uri, auth=(user, password))
        self.logger = logging.getLogger(__name__)
    
    def close(self):
        self.driver.close()
    
    def execute_query(self, query: str, parameters: Dict = None) -> List[Dict]:
        """執行 Cypher 查詢"""
        with self.driver.session() as session:
            try:
                result = session.run(query, parameters or {})
                return [record.data() for record in result]
            except Exception as e:
                self.logger.error(f"查詢執行失敗: {e}")
                raise
    
    def create_constraints(self):
        """創建數據庫約束"""
        constraints = [
            "CREATE CONSTRAINT entity_id IF NOT EXISTS FOR (e:Entity) REQUIRE e.id IS UNIQUE",
            "CREATE CONSTRAINT document_id IF NOT EXISTS FOR (d:Document) REQUIRE d.id IS UNIQUE",
            "CREATE CONSTRAINT concept_id IF NOT EXISTS FOR (c:Concept) REQUIRE c.id IS UNIQUE"
        ]
        
        for constraint in constraints:
            try:
                self.execute_query(constraint)
            except Exception as e:
                self.logger.warning(f"約束創建失敗: {e}")
    
    def create_indexes(self):
        """創建索引"""
        indexes = [
            "CREATE INDEX entity_name_index IF NOT EXISTS FOR (e:Entity) ON (e.name)",
            "CREATE INDEX entity_type_index IF NOT EXISTS FOR (e:Entity) ON (e.type)",
            "CREATE INDEX document_source_index IF NOT EXISTS FOR (d:Document) ON (d.source)"
        ]
        
        for index in indexes:
            try:
                self.execute_query(index)
            except Exception as e:
                self.logger.warning(f"索引創建失敗: {e}")
```

### 2.2 實體抽取器
```python
# src/extractors/entity_extractor.py
import spacy
from typing import List, Dict, Tuple
from dataclasses import dataclass

@dataclass
class Entity:
    text: str
    label: str
    start: int
    end: int
    confidence: float

class EntityExtractor:
    def __init__(self, model_name: str = "zh_core_web_sm"):
        self.nlp = spacy.load(model_name)
    
    def extract_entities(self, text: str) -> List[Entity]:
        """從文本中抽取實體"""
        doc = self.nlp(text)
        entities = []
        
        for ent in doc.ents:
            entity = Entity(
                text=ent.text,
                label=ent.label_,
                start=ent.start_char,
                end=ent.end_char,
                confidence=0.9  # 可以根據需要調整
            )
            entities.append(entity)
        
        return entities
    
    def extract_relations(self, text: str, entities: List[Entity]) -> List[Dict]:
        """抽取實體間的關係"""
        # 這裡可以使用更複雜的關係抽取模型
        # 例如使用預訓練的關係抽取模型
        relations = []
        
        # 簡單的共現關係
        for i, ent1 in enumerate(entities):
            for j, ent2 in enumerate(entities[i+1:], i+1):
                if self._are_related(ent1, ent2, text):
                    relation = {
                        'source': ent1.text,
                        'target': ent2.text,
                        'type': 'RELATES_TO',
                        'confidence': 0.7
                    }
                    relations.append(relation)
        
        return relations
    
    def _are_related(self, ent1: Entity, ent2: Entity, text: str) -> bool:
        """判斷兩個實體是否相關"""
        # 簡單的距離判斷，可以改進為更複雜的語義判斷
        distance = abs(ent1.start - ent2.start)
        return distance < 100  # 在100個字符內認為相關
```

### 2.3 圖構建器
```python
# src/builders/graph_builder.py
from typing import List, Dict, Any
from src.database.neo4j_client import Neo4jClient
from src.extractors.entity_extractor import EntityExtractor, Entity
import uuid

class GraphBuilder:
    def __init__(self, neo4j_client: Neo4jClient):
        self.client = neo4j_client
        self.extractor = EntityExtractor()
    
    def build_from_document(self, document: Dict[str, Any]) -> str:
        """從文檔構建知識圖譜"""
        # 創建文檔節點
        doc_id = self._create_document_node(document)
        
        # 抽取實體
        entities = self.extractor.extract_entities(document['content'])
        
        # 創建實體節點
        entity_nodes = []
        for entity in entities:
            entity_id = self._create_entity_node(entity)
            entity_nodes.append(entity_id)
            
            # 創建文檔-實體關係
            self._create_document_entity_relation(doc_id, entity_id, entity)
        
        # 抽取關係
        relations = self.extractor.extract_relations(document['content'], entities)
        
        # 創建實體間關係
        for relation in relations:
            self._create_entity_relation(relation)
        
        return doc_id
    
    def _create_document_node(self, document: Dict[str, Any]) -> str:
        """創建文檔節點"""
        doc_id = str(uuid.uuid4())
        query = """
        CREATE (d:Document {
            id: $doc_id,
            title: $title,
            content: $content,
            source: $source,
            created_at: datetime()
        })
        RETURN d.id
        """
        
        result = self.client.execute_query(query, {
            'doc_id': doc_id,
            'title': document.get('title', ''),
            'content': document['content'],
            'source': document.get('source', 'unknown')
        })
        
        return result[0]['d.id']
    
    def _create_entity_node(self, entity: Entity) -> str:
        """創建實體節點"""
        entity_id = str(uuid.uuid4())
        query = """
        MERGE (e:Entity {name: $name})
        ON CREATE SET
            e.id = $entity_id,
            e.type = $entity_type,
            e.created_at = datetime()
        ON MATCH SET
            e.updated_at = datetime()
        RETURN e.id
        """
        
        result = self.client.execute_query(query, {
            'entity_id': entity_id,
            'name': entity.text,
            'entity_type': entity.label
        })
        
        return result[0]['e.id']
    
    def _create_document_entity_relation(self, doc_id: str, entity_id: str, entity: Entity):
        """創建文檔-實體關係"""
        query = """
        MATCH (d:Document {id: $doc_id})
        MATCH (e:Entity {id: $entity_id})
        CREATE (d)-[:MENTIONS {
            position: $position,
            context: $context,
            confidence: $confidence
        }]->(e)
        """
        
        self.client.execute_query(query, {
            'doc_id': doc_id,
            'entity_id': entity_id,
            'position': entity.start,
            'context': entity.text,
            'confidence': entity.confidence
        })
    
    def _create_entity_relation(self, relation: Dict[str, Any]):
        """創建實體間關係"""
        query = """
        MATCH (e1:Entity {name: $source})
        MATCH (e2:Entity {name: $target})
        MERGE (e1)-[r:RELATES_TO {
            type: $relation_type,
            confidence: $confidence
        }]->(e2)
        """
        
        self.client.execute_query(query, {
            'source': relation['source'],
            'target': relation['target'],
            'relation_type': relation['type'],
            'confidence': relation['confidence']
        })
```

### 2.4 查詢處理器
```python
# src/processors/query_processor.py
from typing import List, Dict, Any
from sentence_transformers import SentenceTransformer
import numpy as np

class QueryProcessor:
    def __init__(self, neo4j_client, embedding_model_name: str = "all-MiniLM-L6-v2"):
        self.client = neo4j_client
        self.embedding_model = SentenceTransformer(embedding_model_name)
    
    def process_query(self, query: str, top_k: int = 10) -> Dict[str, Any]:
        """處理查詢並返回結果"""
        # 1. 查詢理解
        entities = self._extract_query_entities(query)
        query_embedding = self._get_embedding(query)
        
        # 2. 圖搜尋
        graph_results = self._search_graph(entities, query_embedding, top_k)
        
        # 3. 上下文組裝
        context = self._assemble_context(graph_results)
        
        # 4. 結果排序
        ranked_results = self._rank_results(graph_results, query_embedding)
        
        return {
            'query': query,
            'entities': entities,
            'context': context,
            'results': ranked_results
        }
    
    def _extract_query_entities(self, query: str) -> List[str]:
        """從查詢中提取實體"""
        # 使用簡單的關鍵詞匹配，可以改進為更複雜的實體識別
        query_lower = query.lower()
        entities = []
        
        # 從數據庫中查找匹配的實體
        query = """
        MATCH (e:Entity)
        WHERE toLower(e.name) CONTAINS $query_term
        RETURN e.name
        LIMIT 10
        """
        
        for word in query_lower.split():
            if len(word) > 2:  # 過濾短詞
                results = self.client.execute_query(query, {'query_term': word})
                entities.extend([r['e.name'] for r in results])
        
        return list(set(entities))
    
    def _get_embedding(self, text: str) -> List[float]:
        """獲取文本的向量表示"""
        return self.embedding_model.encode(text).tolist()
    
    def _search_graph(self, entities: List[str], query_embedding: List[float], top_k: int) -> List[Dict]:
        """在圖中搜尋相關信息"""
        results = []
        
        # 1. 基於實體的搜尋
        if entities:
            entity_results = self._search_by_entities(entities, top_k)
            results.extend(entity_results)
        
        # 2. 基於語義相似性的搜尋
        semantic_results = self._search_by_semantic_similarity(query_embedding, top_k)
        results.extend(semantic_results)
        
        return results
    
    def _search_by_entities(self, entities: List[str], top_k: int) -> List[Dict]:
        """基於實體進行圖搜尋"""
        query = """
        MATCH path = (e:Entity)-[*1..3]-(related:Entity)
        WHERE e.name IN $entities
        WITH path, e, related, length(path) as distance
        ORDER BY distance
        RETURN path, e.name as source, related.name as target, distance
        LIMIT $top_k
        """
        
        return self.client.execute_query(query, {
            'entities': entities,
            'top_k': top_k
        })
    
    def _search_by_semantic_similarity(self, query_embedding: List[float], top_k: int) -> List[Dict]:
        """基於語義相似性搜尋"""
        # 注意：這裡需要 Neo4j Vector 插件支援
        query = """
        MATCH (e:Entity)
        WHERE e.embedding IS NOT NULL
        WITH e, gds.similarity.cosine(e.embedding, $query_embedding) AS similarity
        WHERE similarity > 0.7
        RETURN e, similarity
        ORDER BY similarity DESC
        LIMIT $top_k
        """
        
        return self.client.execute_query(query, {
            'query_embedding': query_embedding,
            'top_k': top_k
        })
    
    def _assemble_context(self, graph_results: List[Dict]) -> str:
        """組裝上下文信息"""
        context_parts = []
        
        for result in graph_results:
            if 'path' in result:
                # 從圖路徑中提取信息
                path_info = self._extract_path_info(result['path'])
                context_parts.append(path_info)
            elif 'e' in result:
                # 從實體中提取信息
                entity_info = f"實體: {result['e'].get('name', '')}"
                context_parts.append(entity_info)
        
        return "\n".join(context_parts)
    
    def _extract_path_info(self, path) -> str:
        """從圖路徑中提取文本信息"""
        # 這裡需要根據實際的圖結構來實現
        # 簡單示例
        return f"路徑信息: {str(path)}"
    
    def _rank_results(self, results: List[Dict], query_embedding: List[float]) -> List[Dict]:
        """對結果進行排序"""
        scored_results = []
        
        for result in results:
            # 計算相關性分數
            relevance_score = self._calculate_relevance(result, query_embedding)
            scored_results.append({
                **result,
                'relevance_score': relevance_score
            })
        
        # 按相關性分數排序
        return sorted(scored_results, key=lambda x: x['relevance_score'], reverse=True)
    
    def _calculate_relevance(self, result: Dict, query_embedding: List[float]) -> float:
        """計算結果與查詢的相關性"""
        # 簡單的相關性計算，可以改進為更複雜的算法
        if 'similarity' in result:
            return result['similarity']
        elif 'distance' in result:
            return 1.0 / (1.0 + result['distance'])
        else:
            return 0.5
```

### 2.5 LLM 集成
```python
# src/llm/llm_integration.py
from langchain_openai import ChatOpenAI
from langchain.schema import HumanMessage, SystemMessage
from typing import Dict, Any
import os

class LLMIntegration:
    def __init__(self, api_key: str = None):
        self.api_key = api_key or os.getenv("OPENAI_API_KEY")
        self.llm = ChatOpenAI(
            model="gpt-3.5-turbo",
            temperature=0.7,
            api_key=self.api_key
        )
    
    def generate_answer(self, query: str, context: str) -> str:
        """基於上下文生成答案"""
        system_prompt = """
        你是一個基於知識圖譜的智能助手。請根據提供的上下文信息回答用戶的問題。
        要求：
        1. 答案要準確、完整
        2. 如果上下文中沒有相關信息，請明確說明
        3. 使用中文回答
        4. 保持客觀、專業的語氣
        """
        
        user_prompt = f"""
        用戶問題: {query}
        
        相關上下文:
        {context}
        
        請根據上述上下文回答用戶的問題。
        """
        
        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_prompt)
        ]
        
        try:
            response = self.llm.invoke(messages)
            return response.content
        except Exception as e:
            return f"生成答案時發生錯誤: {str(e)}"
    
    def generate_follow_up_questions(self, query: str, context: str) -> List[str]:
        """生成後續問題"""
        system_prompt = """
        基於用戶的問題和相關上下文，生成3個相關的後續問題。
        這些問題應該能夠幫助用戶進一步探索相關主題。
        """
        
        user_prompt = f"""
        用戶問題: {query}
        
        相關上下文:
        {context}
        
        請生成3個相關的後續問題。
        """
        
        messages = [
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_prompt)
        ]
        
        try:
            response = self.llm.invoke(messages)
            # 解析回答中的問題
            questions = self._extract_questions(response.content)
            return questions
        except Exception as e:
            return []
    
    def _extract_questions(self, text: str) -> List[str]:
        """從文本中提取問題"""
        # 簡單的問題提取邏輯
        lines = text.split('\n')
        questions = []
        
        for line in lines:
            line = line.strip()
            if line.endswith('?') and len(line) > 10:
                questions.append(line)
        
        return questions[:3]  # 最多返回3個問題
```

## 3. API 服務實現

### 3.1 FastAPI 應用
```python
# src/api/main.py
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Any
from src.database.neo4j_client import Neo4jClient
from src.builders.graph_builder import GraphBuilder
from src.processors.query_processor import QueryProcessor
from src.llm.llm_integration import LLMIntegration
import os

app = FastAPI(title="Neo4j Graph RAG API", version="1.0.0")

# 初始化組件
neo4j_client = Neo4jClient(
    uri=os.getenv("NEO4J_URI", "bolt://localhost:7687"),
    user=os.getenv("NEO4J_USER", "neo4j"),
    password=os.getenv("NEO4J_PASSWORD", "password")
)

graph_builder = GraphBuilder(neo4j_client)
query_processor = QueryProcessor(neo4j_client)
llm_integration = LLMIntegration()

# 數據模型
class DocumentInput(BaseModel):
    title: str
    content: str
    source: str = "unknown"

class QueryInput(BaseModel):
    query: str
    top_k: int = 10

class QueryResponse(BaseModel):
    query: str
    answer: str
    context: str
    entities: List[str]
    follow_up_questions: List[str]
    processing_time: float

@app.on_event("startup")
async def startup_event():
    """應用啟動時的初始化"""
    neo4j_client.create_constraints()
    neo4j_client.create_indexes()

@app.on_event("shutdown")
async def shutdown_event():
    """應用關閉時的清理"""
    neo4j_client.close()

@app.post("/documents", response_model=Dict[str, str])
async def add_document(document: DocumentInput):
    """添加文檔到知識圖譜"""
    try:
        doc_id = graph_builder.build_from_document({
            'title': document.title,
            'content': document.content,
            'source': document.source
        })
        return {"message": "文檔添加成功", "document_id": doc_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"添加文檔失敗: {str(e)}")

@app.post("/query", response_model=QueryResponse)
async def process_query(query_input: QueryInput):
    """處理查詢並返回答案"""
    import time
    start_time = time.time()
    
    try:
        # 處理查詢
        query_results = query_processor.process_query(
            query_input.query, 
            query_input.top_k
        )
        
        # 生成答案
        answer = llm_integration.generate_answer(
            query_input.query,
            query_results['context']
        )
        
        # 生成後續問題
        follow_up_questions = llm_integration.generate_follow_up_questions(
            query_input.query,
            query_results['context']
        )
        
        processing_time = time.time() - start_time
        
        return QueryResponse(
            query=query_input.query,
            answer=answer,
            context=query_results['context'],
            entities=query_results['entities'],
            follow_up_questions=follow_up_questions,
            processing_time=processing_time
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"查詢處理失敗: {str(e)}")

@app.get("/health")
async def health_check():
    """健康檢查"""
    try:
        # 測試數據庫連接
        neo4j_client.execute_query("RETURN 1")
        return {"status": "healthy", "database": "connected"}
    except Exception as e:
        raise HTTPException(status_code=503, detail=f"服務不可用: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

## 4. 使用示例

### 4.1 基本使用流程
```python
# example_usage.py
from src.database.neo4j_client import Neo4jClient
from src.builders.graph_builder import GraphBuilder
from src.processors.query_processor import QueryProcessor
from src.llm.llm_integration import LLMIntegration

# 初始化組件
neo4j_client = Neo4jClient("bolt://localhost:7687", "neo4j", "password")
graph_builder = GraphBuilder(neo4j_client)
query_processor = QueryProcessor(neo4j_client)
llm_integration = LLMIntegration()

# 1. 添加文檔
document = {
    "title": "人工智能發展史",
    "content": "人工智能始於1956年的達特茅斯會議，由約翰·麥卡錫等人提出。",
    "source": "維基百科"
}

doc_id = graph_builder.build_from_document(document)
print(f"文檔已添加，ID: {doc_id}")

# 2. 處理查詢
query = "人工智能是什麼時候開始的？"
results = query_processor.process_query(query)

# 3. 生成答案
answer = llm_integration.generate_answer(query, results['context'])
print(f"問題: {query}")
print(f"答案: {answer}")
```

### 4.2 批量處理
```python
# batch_processing.py
import json
from src.builders.graph_builder import GraphBuilder
from src.database.neo4j_client import Neo4jClient

def batch_process_documents(documents_file: str):
    """批量處理文檔"""
    neo4j_client = Neo4jClient("bolt://localhost:7687", "neo4j", "password")
    graph_builder = GraphBuilder(neo4j_client)
    
    with open(documents_file, 'r', encoding='utf-8') as f:
        documents = json.load(f)
    
    for i, doc in enumerate(documents):
        try:
            doc_id = graph_builder.build_from_document(doc)
            print(f"處理文檔 {i+1}/{len(documents)}: {doc_id}")
        except Exception as e:
            print(f"處理文檔失敗: {e}")
    
    neo4j_client.close()

# 使用示例
batch_process_documents("documents.json")
```

## 5. 測試

### 5.1 單元測試
```python
# tests/test_graph_builder.py
import pytest
from src.builders.graph_builder import GraphBuilder
from src.database.neo4j_client import Neo4jClient

class TestGraphBuilder:
    @pytest.fixture
    def neo4j_client(self):
        return Neo4jClient("bolt://localhost:7687", "neo4j", "password")
    
    @pytest.fixture
    def graph_builder(self, neo4j_client):
        return GraphBuilder(neo4j_client)
    
    def test_create_document_node(self, graph_builder):
        document = {
            "title": "測試文檔",
            "content": "這是一個測試文檔的內容。",
            "source": "test"
        }
        
        doc_id = graph_builder._create_document_node(document)
        assert doc_id is not None
        assert len(doc_id) > 0
    
    def test_create_entity_node(self, graph_builder):
        from src.extractors.entity_extractor import Entity
        
        entity = Entity(
            text="測試實體",
            label="PERSON",
            start=0,
            end=4,
            confidence=0.9
        )
        
        entity_id = graph_builder._create_entity_node(entity)
        assert entity_id is not None
```

### 5.2 集成測試
```python
# tests/test_integration.py
import pytest
from src.api.main import app
from fastapi.testclient import TestClient

client = TestClient(app)

def test_health_check():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "healthy"

def test_add_document():
    document = {
        "title": "測試文檔",
        "content": "這是一個測試文檔的內容。",
        "source": "test"
    }
    
    response = client.post("/documents", json=document)
    assert response.status_code == 200
    assert "document_id" in response.json()

def test_process_query():
    query = {
        "query": "測試查詢",
        "top_k": 5
    }
    
    response = client.post("/query", json=query)
    assert response.status_code == 200
    assert "answer" in response.json()
```

## 6. 部署配置

### 6.1 Dockerfile
```dockerfile
FROM python:3.9-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src/ ./src/
COPY tests/ ./tests/

EXPOSE 8000

CMD ["python", "-m", "uvicorn", "src.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### 6.2 環境變數配置
```bash
# .env
NEO4J_URI=bolt://localhost:7687
NEO4J_USER=neo4j
NEO4J_PASSWORD=password
OPENAI_API_KEY=your_openai_api_key
```

這個實現指南提供了完整的 Neo4j Graph RAG 系統實現，包括：

1. **核心組件實現**: 數據庫連接、實體抽取、圖構建、查詢處理、LLM 集成
2. **API 服務**: 基於 FastAPI 的 RESTful API
3. **使用示例**: 基本使用和批量處理
4. **測試框架**: 單元測試和集成測試
5. **部署配置**: Docker 和環境配置

所有代碼都遵循最佳實踐，具有良好的可讀性、可維護性和可擴展性。
