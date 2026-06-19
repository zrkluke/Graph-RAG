# -*- coding: utf-8 -*-
"""
法律判決書社群偵測腳本 (Leiden / Louvain Fallback) ── 最佳化記憶體計算版

功能：
  1. 連線 Neo4j 資料庫。
  2. 獲取所有 Judgment 節點，建立節點與 igraph 索引映射。
  3. 基於「共享引用法規 (Law) 數量」在 Python 本地計算 Judgments 之間的邊與權重（以防 AuraDBFree 兩跳查詢超時）。
  4. 過濾掉過於通用的程序性法條（例如被引用超過 150 次的法規），以消除雜訊並提升社群區分度。
  5. 優先使用 Leiden 演算法計算社群，出錯或無依賴時 Fallback 使用 Louvain。
  6. 將計算出的社群 ID (整數) 批次寫回 Neo4j `Judgment` 節點的 `community` 屬性中。
"""
import os
import sys
import time
from pathlib import Path
from collections import defaultdict, Counter
from neo4j import GraphDatabase
from dotenv import load_dotenv

# 載入環境變數
env_path = Path(__file__).parent.parent / '.env.local'
if env_path.exists():
    load_dotenv(dotenv_path=env_path)
else:
    load_dotenv()

# 獲取 Neo4j 配置
NEO4J_URI = os.getenv('NEO4J_URI')
NEO4J_USERNAME = os.getenv('NEO4J_USERNAME') or os.getenv('NEO4J_USER') or 'neo4j'
NEO4J_PASSWORD = os.getenv('NEO4J_PASSWORD')

if not NEO4J_URI or not NEO4J_PASSWORD:
    print("錯誤：缺少 Neo4j 連線環境變數！請確認 .env.local 檔案配置。")
    sys.exit(1)


def main():
    print("====== 開始執行法律判決書社群偵測 (本地高效版) ======")
    start_time = time.time()
    
    # 1. 連線 Neo4j 資料庫
    print(f"正在連線至 Neo4j 資料庫: {NEO4J_URI} ...")
    driver = GraphDatabase.driver(NEO4J_URI, auth=(NEO4J_USERNAME, NEO4J_PASSWORD))
    
    try:
        with driver.session() as session:
            # 2. 獲取所有 Judgment 節點的內部 ID
            print("正在獲取所有判決書節點...")
            nodes_query = "MATCH (j:Judgment) RETURN id(j) AS id, j.id AS case_no"
            nodes_result = session.run(nodes_query)
            
            judgments = []
            for record in nodes_result:
                judgments.append({
                    'id': record['id'],
                    'case_no': record['case_no']
                })
            
            total_nodes = len(judgments)
            print(f"成功獲取 {total_nodes} 筆判決書。")
            if total_nodes == 0:
                print("資料庫中無任何判決書，結束程式。")
                return

            # 建立 Neo4j 內部 ID 到 igraph 節點索引 (0 to N-1) 的雙向映射
            node_to_idx = {j['id']: i for i, j in enumerate(judgments)}
            idx_to_node = {i: j['id'] for i, j in enumerate(judgments)}
            
            # 3. 查詢一跳關係：每個判決書引用的法條
            print("正在查詢判決書所引用的法規 (單跳極速版)...")
            citation_query = """
            MATCH (j:Judgment)-[:CITED]->(l:Law)
            RETURN id(j) AS j_id, l.name AS law_name
            """
            citation_result = session.run(citation_query)
            
            # 建立法條對判決書 ID 的映射
            law_to_judgments = defaultdict(list)
            for record in citation_result:
                j_id = record['j_id']
                law_name = record['law_name']
                law_to_judgments[law_name].append(j_id)
            
            print(f"成功查詢。涉及的法規總數：{len(law_to_judgments)}")

            # 4. 在本地 Python 記憶體中計算共享法條的邊與權重
            print("正在計算判決書間共享法規的關聯邊...")
            edges_counter = Counter()
            ignored_laws_count = 0
            
            # 設定過濾閥值：如果某個法條被超過 150 筆判決引用，視為通用雜訊（如程序性法條）並忽略
            UPPER_LIMIT = 150
            
            for law_name, j_ids in law_to_judgments.items():
                if len(j_ids) < 2:
                    continue
                if len(j_ids) > UPPER_LIMIT:
                    ignored_laws_count += 1
                    # 可以在 debug 時印出被忽略的通用法規
                    continue
                
                # 在共享該法條的所有判決書兩兩之間建立無向邊並計數 (加權)
                # 由於限制了長度在 UPPER_LIMIT 以內，此處的組合數最大為 C(150, 2) = 11,175，計算速度極快且不影響效能
                for i in range(len(j_ids)):
                    for j in range(i + 1, len(j_ids)):
                        u = j_ids[i]
                        v = j_ids[j]
                        if u == v:
                            continue
                        # 確保 source_id < target_id
                        if u > v:
                            u, v = v, u
                        edges_counter[(u, v)] += 1
            
            print(f"過濾了 {ignored_laws_count} 條過於通用的法條 (被引用數 > {UPPER_LIMIT})。")
            print(f"在 Python 中計算出有關係的邊總數：{len(edges_counter)}")

            # 將邊與權重轉換為 igraph 能接收的索引形式
            edges_list = []
            weights_list = []
            for (u_id, v_id), weight in edges_counter.items():
                u_idx = node_to_idx.get(u_id)
                v_idx = node_to_idx.get(v_id)
                if u_idx is not None and v_idx is not None:
                    edges_list.append((u_idx, v_idx))
                    weights_list.append(float(weight))
            
            print(f"實際建立於圖譜中的有效邊數：{len(edges_list)}")

            # 5. 使用 igraph 構建無向圖
            print("正在構建 igraph 網絡圖...")
            import igraph
            g = igraph.Graph(n=total_nodes, directed=False)
            if edges_list:
                g.add_edges(edges_list, attributes={'weight': weights_list})
            else:
                print("警訊：無任何共享法規的邊，所有節點將獨立成群。")

            # 6. 執行社群偵測 (Leiden 優先，Louvain Fallback)
            membership = None
            algorithm_used = ""
            
            try:
                print("嘗試載入並執行 Leiden 演算法...")
                import leidenalg
                # 執行 Leiden 演算法（優化 Modularity）
                partition = leidenalg.find_partition(
                    g, 
                    leidenalg.ModularityVertexPartition, 
                    weights=weights_list if edges_list else None
                )
                membership = partition.membership
                algorithm_used = "Leiden 演算法"
            except Exception as e:
                print(f"無法執行 Leiden 演算法 ({str(e)})。降級使用 Louvain 演算法...")
                try:
                    # 使用 igraph 內建的 Louvain (community_multilevel)
                    partition = g.community_multilevel(
                        weights=weights_list if edges_list else None
                    )
                    membership = partition.membership
                    algorithm_used = "Louvain 演算法"
                except Exception as ex:
                    print(f"計算社群時發生嚴重錯誤: {str(ex)}")
                    sys.exit(1)

            # 統計社群分佈
            unique_communities = set(membership)
            total_communities = len(unique_communities)
            print(f"社群劃分完成。演算法：{algorithm_used}。總社群數：{total_communities}。")
            
            # 建立社群成員計數
            comm_counts = {}
            for m in membership:
                comm_counts[m] = comm_counts.get(m, 0) + 1
            
            # 排序顯示前 10 大社群
            sorted_comms = sorted(comm_counts.items(), key=lambda x: x[1], reverse=True)
            print("最大前 10 個社群之節點數量統計：")
            for c_id, count in sorted_comms[:10]:
                print(f"  - 社群 ID {c_id}: {count} 筆判決")

            # 7. 批次寫回 Neo4j
            print("正在將社群標籤批次寫入資料庫...")
            write_data = []
            for i, comm_id in enumerate(membership):
                write_data.append({
                    'id': idx_to_node[i],
                    'community': int(comm_id)
                })
            
            # 使用 UNWIND 批次更新
            update_query = """
            UNWIND $batches AS batch
            MATCH (j:Judgment)
            WHERE id(j) = batch.id
            SET j.community = batch.community
            """
            
            batch_size = 2000
            for k in range(0, len(write_data), batch_size):
                sub_batch = write_data[k:k+batch_size]
                session.run(update_query, batches=sub_batch)
                print(f"  已寫入 {k + len(sub_batch)} / {len(write_data)} 筆節點")

            print("社群資料成功回填 Neo4j 屬性 `community`。")
            
    finally:
        driver.close()
        
    duration = time.time() - start_time
    print(f"====== 社群偵測執行完畢！總耗時: {duration:.2f} 秒 ======")


if __name__ == '__main__':
    main()
