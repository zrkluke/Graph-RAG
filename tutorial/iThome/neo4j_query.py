'''
https://ithelp.ithome.com.tw/articles/10348921

查詢 Graph 的兩種方式
1. Cypher 形式，GraphCypherQAChain
直接將自然語言轉換成為 Cypher 進行檢索
2. semantic 形式，VectorSearch
將自然語言轉成向量之後，在 Neo4j 資料庫中查詢'
'''




# 方法一、向量檢索
import os
from dotenv import load_dotenv
from langchain_neo4j.vectorstores.neo4j_vector import Neo4jVector
from langchain_openai import OpenAIEmbeddings, ChatOpenAI
from langchain.chains.retrieval import create_retrieval_chain
from langchain.chains.combine_documents import create_stuff_documents_chain
from langchain_core.prompts import ChatPromptTemplate


def vector_search():
    os.environ["NEO4J_URI"] = "bolt://localhost:7687"
    os.environ["NEO4J_USERNAME"] = "neo4j"
    os.environ["NEO4J_PASSWORD"] = "password"

    ''' Create an safety_incidets vector and Instantiate Neo4j vector from graph'''
    safety_incidents_vector_index = Neo4jVector.from_existing_graph(
        OpenAIEmbeddings(),
        index_name='safety_incidents',
        node_label="Incident",
        text_node_properties=['id', 'date', 'severity', 'description'],
        embedding_node_property='embedding',
    )

    '''在此範例中，我們為 from_existing_graph 方法使用了以下特定於圖的參數。

    index_name：我們將其改為'safety_incidents'，這更好地反映了我們的用例。
    node_label：我們使用"Incident"作為標籤，因為我們主要關注的是事故節點。
    text_node_properties：我們包括了事故的id、日期、嚴重程度和描述。這些屬性提供了關於每個事故的關鍵信息，可以用來生成有意義的向量。
    embedding_node_property：我們保留'embedding'作為存儲嵌入向量的屬性名。
    '''

    # 現在向量索引已經啟動，我們可以像LangChain中的任何其他向量索引一樣使用它。
    response = safety_incidents_vector_index.similarity_search(
        query="最近有沒有工人中暑的事故？",
        k=5,
    )
    print(len(response))
    for i, doc in enumerate(response):
        print(f"結果 {i+1}:")
        print(doc.page_content)
        print("---")

    # 結合多個條件的複雜查詢：
    response = safety_incidents_vector_index.similarity_search(
        "有沒有工人因為沒戴安全帽受傷的事故？最嚴重的是哪次？",
        filter={
            "$or": [
                {"description": {"$like": "安全帽"}},
                {"description": {"$like": "頭部防護"}},
                {"severity": {"$in": ["高"]}}
            ],

        },
        k=3
    )
    for i, doc in enumerate(response):
        print(f"事故 {i+1}:")
        print(doc.page_content)
        print("---")

    '''您可以觀察到，我們使用 text_node_properties 參數中定義的屬性建立了映射或類似字典的字串的回應。

    現在，我們可以透過將向量索引包裝到 RetrievalQA 模組中來輕鬆建立聊天機器人回應。'''

    system_prompt = (
        "Use the given context to answer the question. "
        "If you don't know the answer, say you don't know. "
        "Use three sentence maximum and keep the answer concise. "
        "Context: {context}"
    )
    prompt = ChatPromptTemplate.from_messages(
        [
            ("system", system_prompt),
            ("human", "{input}"),
        ]
    )   
    question_answer_chain = create_stuff_documents_chain(
        llm=ChatOpenAI(),
        prompt=prompt,
    )
    retrieval_qa_chain = create_retrieval_chain(
        retriever=safety_incidents_vector_index.as_retriever(),
        combine_docs_chain=question_answer_chain,
    )
    response = retrieval_qa_chain.invoke(
        {"input": "最近有沒有工人中暑的事故？"}
    )
    print(response)


# 方法二、Graph Cypher search
from langchain_neo4j import GraphCypherQAChain, Neo4jGraph
from langchain_core.prompts.prompt import PromptTemplate


def cypher_search():
    graph = Neo4jGraph(url="bolt://localhost:7687", username="neo4j", password="password")
    graph.refresh_schema()

    cypher_chain = GraphCypherQAChain.from_llm(
        cypher_llm = ChatOpenAI(temperature=0, model_name='gpt-4o-mini'),
        qa_llm = ChatOpenAI(temperature=0),
        graph=graph,
        verbose=True,
        validate_cypher= True,
        return_direct = True,
        allow_dangerous_requests=True, # 設定為 True，以允許生成的 Cypher 查詢執行危險操作
    )

    response = cypher_chain.invoke(
        {"query": "有多少起高空墜落發生?"}
    )
    print(response) # {'query': '有多少起高空墜落發生?', 'result': [{'高空墜落事件數量': 0}]}
    '''顯然地透過強大的閉源模型 Gpt4o-mini 也是會產生錯誤的內容，
    原因是生成的Cypher查詢在尋找名為"高空墜落"的IncidentType，但在我們的資料中，我們使用的是"墜落"而不是"高空墜落"。

    顯然的模型缺乏語義理解，沒有理解"高空墜落"和"墜落"在這個上下文中是等同的。
    '''

    # 提高 GraphCypherQA 生成 Cypher 機率
    # 策略ㄧ、直接 Fewshot 在 Prompt 當中
    # 策略二、使用 Prompt Selector




if __name__ == "__main__":
    # setup
    _ = load_dotenv()

    # 方法一、Vector search
    # vector_search()

    # 方法二、Graph Cypher search
    cypher_search()
