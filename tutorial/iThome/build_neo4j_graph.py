'''
https://ithelp.ithome.com.tw/articles/10348921
'''

from langchain_neo4j import GraphCypherQAChain, Neo4jGraph

graph = Neo4jGraph(url="bolt://localhost:7687", username="neo4j", password="password")

# Download data and insert into the graph
import requests
import_url = "https://gist.githubusercontent.com/Heng-xiu/a6417c4c34c80147cfbccdaa52925a55/raw/1126ea63fe28838d20af23441c4900ec768cfeb5/construction_site_safety.json"
import_query = requests.get(import_url).json()['query']
graph.query(import_query)