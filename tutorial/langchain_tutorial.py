'''https://neo4j.com/labs/apoc/4.1/installation/#docker'''
'''https://neo4j.com/labs/apoc/5/installation/#docker'''
'''https://python.langchain.com/docs/integrations/graphs/neo4j_cypher/'''

from dotenv import load_dotenv
from langchain_neo4j import GraphCypherQAChain, Neo4jGraph
from langchain_openai import ChatOpenAI
from langchain_core.prompts.prompt import PromptTemplate



if __name__ == "__main__":
    # Setting up
    _ = load_dotenv()
    graph = Neo4jGraph(url="bolt://localhost:7687", username="neo4j", password="password")

    # Seeding the database
    result = graph.query(
        """
    MERGE (m:Movie {name:"Top Gun", runtime: 120})
    WITH m
    UNWIND ["Tom Cruise", "Val Kilmer", "Anthony Edwards", "Meg Ryan"] AS actor
    MERGE (a:Actor {name:actor})
    MERGE (a)-[:ACTED_IN]->(m)
    """
    )
    # print(result)

    # Refresh graph schema information
    graph.refresh_schema()
    # print(graph.schema)

    # Enhanced schema information
    enhanced_graph = Neo4jGraph(
        url="bolt://localhost:7687",
        username="neo4j",
        password="password",
        enhanced_schema=True,
    )
    # print(enhanced_graph.schema)

    # Querying the graph
    chain = GraphCypherQAChain.from_llm(
        ChatOpenAI(temperature=0),
        graph=graph,
        # verbose=True,
        allow_dangerous_requests=True,
    )
    response = chain.invoke({"query": "Who played in Top Gun?"})
    print(response)


    # Add examples in the Cypher generation prompt
    CYPHER_GENERATION_TEMPLATE = """Task:Generate Cypher statement to query a graph database.
    Instructions:
    Use only the provided relationship types and properties in the schema.
    Do not use any other relationship types or properties that are not provided.
    Schema:
    {schema}
    Note: Do not include any explanations or apologies in your responses.
    Do not respond to any questions that might ask anything else than for you to construct a Cypher statement.
    Do not include any text except the generated Cypher statement.
    Examples: Here are a few examples of generated Cypher statements for particular questions:
    # How many people played in Top Gun?
    MATCH (m:Movie {{name:"Top Gun"}})<-[:ACTED_IN]-()
    RETURN count(*) AS numberOfActors

    The question is:
    {question}"""

    CYPHER_GENERATION_PROMPT = PromptTemplate(
        input_variables=["schema", "question"], template=CYPHER_GENERATION_TEMPLATE
    )

    chain = GraphCypherQAChain.from_llm(
        ChatOpenAI(temperature=0),
        graph=graph,
        verbose=True,
        cypher_prompt=CYPHER_GENERATION_PROMPT,
        allow_dangerous_requests=True,
    )
    response = chain.invoke({"query": "How many people played in Top Gun?"})
    print(response)

    # Use separate LLMs for Cypher and answer generation
    chain = GraphCypherQAChain.from_llm(
        graph=graph,
        cypher_llm=ChatOpenAI(temperature=0, model="gpt-3.5-turbo"),
        qa_llm=ChatOpenAI(temperature=0, model="gpt-3.5-turbo-16k"),
        verbose=True,
        allow_dangerous_requests=True,
    )
    response = chain.invoke({"query": "Who played in Top Gun?"})
    print(response)

    # Ignore specified node and relationship types
    chain = GraphCypherQAChain.from_llm(
        graph=graph,
        cypher_llm=ChatOpenAI(temperature=0, model="gpt-3.5-turbo"),
        qa_llm=ChatOpenAI(temperature=0, model="gpt-3.5-turbo-16k"),
        verbose=True,
        exclude_types=["Actor"],
        # exclude_types=["Movie"],
        # include_types=["Movie"],
        allow_dangerous_requests=True,
    )
    # Inspect graph schema
    print(chain.graph_schema)

    # Validate generated Cypher statements
    chain = GraphCypherQAChain.from_llm(
        llm=ChatOpenAI(temperature=0, model="gpt-3.5-turbo"),
        graph=graph,
        verbose=True,
        validate_cypher=True,
        allow_dangerous_requests=True,
    )
    response = chain.invoke({"query": "Who played in Top Gun?"})
    print(response)

    # Provide context from database results as tool/function output
    chain = GraphCypherQAChain.from_llm(
        llm=ChatOpenAI(temperature=0, model="gpt-3.5-turbo"),
        graph=graph,
        verbose=True,
        use_function_response=True,
        allow_dangerous_requests=True,
    )
    response = chain.invoke({"query": "Who played in Top Gun?"})
    print(response)