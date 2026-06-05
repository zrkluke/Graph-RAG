Neo4j-GraphRAG/
├─ docker-compose.yml                 # 主要 compose（本機開發）
├─ docker-compose.prod.yml            # 產品環境覆寫（可選）
├─ .env.example                       # 根層環境變數樣板（Compose 讀）
├─ Makefile                           # 常用指令（build/up/down/logs/seed）
├─ README.md
├─ .gitignore
├─ infra/                             # 部署/基建（可選：k8s/terraform/ansible）
│  ├─ k8s/
│  └─ nginx/                          # 若要反向代理
├─ env/                               # 服務級環境變數檔（不進版控或放 *.example）
│  ├─ backend.env
│  ├─ frontend.env
│  └─ neo4j.env
├─ backend/                           # 後端（例如 FastAPI）
│  ├─ Dockerfile
│  ├─ .dockerignore
│  ├─ pyproject.toml / requirements.txt
│  ├─ app/
│  │  ├─ main.py
│  │  ├─ api/                         # REST/GraphQL 路由
│  │  ├─ rag/                         # RAG 邏輯（retriever / re-ranker / graph calls）
│  │  ├─ graph/                       # Neo4j 驅動、Cypher、DAO
│  │  ├─ schemas/                     # pydantic/DTO
│  │  ├─ services/                    # 業務服務層
│  │  ├─ workers/                     # 背景任務（可選）
│  │  └─ config/
│  └─ tests/
├─ frontend/                          # 前端（例如 Next.js/React）
│  ├─ Dockerfile
│  ├─ .dockerignore
│  ├─ package.json
│  ├─ next.config.js / vite.config.ts
│  └─ src/
│     ├─ pages/ or app/
│     ├─ components/
│     ├─ lib/
│     └─ env.d.ts
├─ neo4j/                             # 若要自訂 Neo4j 映像（含 APOC/插件）
│  ├─ Dockerfile                      # 可選：若用官方 image 就不需要
│  ├─ conf/                           # neo4j.conf（若要覆寫）
│  └─ plugins/                        # 自帶插件 jar（APOC/Graph Data Science 等）
├─ data/                              # 卷掛載目錄（不進版控或加至 .gitignore）
│  └─ neo4j/
│     ├─ data/                        # 資料檔
│     ├─ import/                      # 匯入 CSV/JSON
│     ├─ logs/
│     └─ backups/
├─ migrations/                        # 圖譜結構/seed（Cypher 腳本）
│  ├─ 001_init_schema.cypher
│  ├─ 010_seed_nodes.cypher
│  └─ 020_constraints.cypher
└─ scripts/
   ├─ seed.sh                         # 執行 migrations/* 進 neo4j
   ├─ wait-for-it.sh                  # 服務啟動順序輔助
   └─ export_graph.sh                 # 匯出/備份工具
