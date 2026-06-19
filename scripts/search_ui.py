# -*- coding: utf-8 -*-
"""
法律判決書 Graph RAG 本地互動搜尋 UI (search_ui.py)

功能：
  1. 基於 Gradio 建立高質感、簡潔優雅的網頁介面。
  2. 提供自然語言情境描述輸入、法院層級與案件種類篩選。
  3. 即時與 search_pipeline.py 串接，在網頁渲染結構化搜尋結果。
"""
import os
import sys
import gradio as gr

# 保證 scripts 目錄內模組可以正常引用
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# 解決 Windows 終端機 (CP950) 輸出編碼問題
if sys.platform.startswith("win"):
    try:
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

from search_pipeline import search_similar_judgments

def perform_search(query, court_level, case_type, limit):
    """
    呼叫搜尋 Pipeline 並將結果渲染為精美的 HTML 內容。
    """
    if not query or not query.strip():
        return "<div style='color: #ef4444; padding: 10px; border-radius: 8px; background-color: #fef2f2; border: 1px solid #fee2e2;'>⚠️ 請輸入要搜尋的犯罪或糾紛情境描述！</div>"
    
    # 執行混合檢索
    results = search_similar_judgments(
        query_text=query,
        court_level=court_level if court_level != "全部" else None,
        case_type=case_type if case_type != "全部" else None,
        limit=int(limit)
    )
    
    if not results:
        return "<div style='color: #6b7280; padding: 20px; text-align: center; border: 1px dashed #d1d5db; border-radius: 8px;'>🔍 抱歉，未找到符合條件的相似判決書，請嘗試調整情境描述或過濾條件。</div>"
    
    # 統計被引用最多次的法條
    law_counts = {}
    for r in results:
        for law in r.get("cited_laws", []):
            law_counts[law] = law_counts.get(law, 0) + 1
    sorted_laws = sorted(law_counts.items(), key=lambda x: x[1], reverse=True)
    
    # 1. 建立頂部統計儀表板 (Dashboard)
    stats_html = f"""
    <div style="display: flex; gap: 15px; margin-bottom: 20px;">
        <div style="flex: 1; padding: 15px; border-radius: 12px; background: linear-gradient(135deg, #eff6ff, #dbeafe); border: 1px solid #bfdbfe; box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
            <div style="font-size: 0.875rem; color: #1e3a8a; font-weight: 600; margin-bottom: 4px;">🎯 檢索結果筆數</div>
            <div style="font-size: 1.75rem; font-weight: 800; color: #1d4ed8;">{len(results)} <span style="font-size: 1rem; font-weight: 500;">筆</span></div>
        </div>
        <div style="flex: 2; padding: 15px; border-radius: 12px; background: linear-gradient(135deg, #f0fdf4, #dcfce7); border: 1px solid #bbf7d0; box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
            <div style="font-size: 0.875rem; color: #14532d; font-weight: 600; margin-bottom: 4px;">📚 核心關聯法條 (Top 3)</div>
            <div style="font-size: 1rem; font-weight: 700; color: #15803d; line-height: 1.5;">
    """
    if sorted_laws:
        stats_html += "，".join([f"{law} ({count}次)" for law, count in sorted_laws[:3]])
    else:
        stats_html += "無關聯法條數據"
    stats_html += """
            </div>
        </div>
    </div>
    """
    
    # 2. 渲染各判決書卡片列表 (Cards)
    cards_html = ""
    for idx, r in enumerate(results, 1):
        # 相似度顏色標記
        score = r["max_section_score"]
        if score >= 0.80:
            badge_color = "#10b981"  # 綠色
        elif score >= 0.70:
            badge_color = "#f59e0b"  # 黃色
        else:
            badge_color = "#6b7280"  # 灰色
            
        judges = "，".join(r["judges"]) if r["judges"] else "未提供"
        defendants = "，".join(r["defendants"]) if r["defendants"] else "無"
        plaintiffs = "，".join(r["plaintiffs"]) if r["plaintiffs"] else "無"
        cited_laws = "，".join([f"<span style='background-color: #f3f4f6; color: #374151; padding: 2px 8px; border-radius: 4px; font-size: 0.85rem; margin-right: 5px; display: inline-block;'>{l}</span>" for l in r["cited_laws"]]) if r["cited_laws"] else "無"
        
        main_text_cleaned = r["main_text"].replace("\r\n", "<br>").replace("\n", "<br>")
        fact_reason_cleaned = r["fact_reason"].replace("\r\n", "<br>").replace("\n", "<br>")[:350] + "..."
        
        cards_html += f"""
        <div style="border: 1px solid #e5e7eb; border-radius: 12px; background-color: #ffffff; padding: 20px; margin-bottom: 20px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); transition: transform 0.2s;">
            <!-- 卡片頂部欄 -->
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px; border-bottom: 1px solid #f3f4f6; padding-bottom: 10px;">
                <div>
                    <span style="font-size: 1.15rem; font-weight: 700; color: #1f2937;">{r['court']} | {r['reason']}</span>
                    <div style="font-size: 0.85rem; color: #9ca3af; margin-top: 4px;">字號：{r['id']}</div>
                </div>
                <div style="background-color: {badge_color}; color: #ffffff; padding: 6px 12px; border-radius: 20px; font-size: 0.875rem; font-weight: 700; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    🎯 相似度 {score:.4f}
                </div>
            </div>
            
            <!-- 屬性與分類標籤 -->
            <div style="margin-bottom: 15px; display: flex; flex-wrap: wrap; gap: 8px; font-size: 0.875rem;">
                <span style="background-color: #eff6ff; color: #1e40af; padding: 3px 10px; border-radius: 6px; font-weight: 500;">📂 {r['case_type']}</span>
                <span style="background-color: #f3e8ff; color: #6b21a8; padding: 3px 10px; border-radius: 6px; font-weight: 500;">🏛️ {r['court_level']}</span>
                <span style="background-color: #fdf2f8; color: #9d174d; padding: 3px 10px; border-radius: 6px; font-weight: 500;">⚖️ 審判法官：{judges}</span>
            </div>
            
            <!-- 當事人 -->
            <div style="margin-bottom: 12px; font-size: 0.9rem; color: #4b5563;">
                👤 <strong>當事人</strong>：被告 ── <span style="color: #b91c1c; font-weight: 600;">{defendants}</span> | 原告 ── <span style="color: #15803d; font-weight: 600;">{plaintiffs}</span>
            </div>
            
            <!-- 引用法規 -->
            <div style="margin-bottom: 15px; font-size: 0.9rem; color: #4b5563; line-height: 1.6;">
                📖 <strong>引用法規</strong>：{cited_laws}
            </div>
            
            <!-- 判決主文 -->
            <div style="background-color: #fafafa; border-left: 4px solid #3b82f6; padding: 12px 16px; border-radius: 0 8px 8px 0; margin-bottom: 15px; font-size: 0.925rem; color: #1f2937; line-height: 1.6;">
                📢 <strong>判決主文</strong>：<br>{main_text_cleaned}
            </div>
            
            <!-- 事實與理由片段 -->
            <div style="font-size: 0.9rem; color: #4b5563; line-height: 1.6;">
                📝 <strong>事實及理由摘要</strong>：<br>
                <div style="color: #6b7280; background-color: #fbfbfb; padding: 10px; border-radius: 6px; border: 1px solid #f3f4f6; font-style: italic;">
                    {fact_reason_cleaned}
                </div>
            </div>
        </div>
        """
        
    return stats_html + cards_html

def main():
    # 建立 Gradio UI 介面，使用 Clean, Modern 主題
    theme = gr.themes.Soft(
        primary_hue="blue",
        secondary_hue="gray",
        neutral_hue="slate",
        font=[gr.themes.GoogleFont("Outfit"), "sans-serif"]
    )
    
    with gr.Blocks(theme=theme, title="智慧型法律判決書 Graph RAG 檢索系統") as demo:
        # 標題與引導
        gr.HTML("""
        <div style="text-align: center; margin-bottom: 25px; padding-top: 15px;">
            <h1 style="color: #1e3a8a; font-size: 2.2rem; font-weight: 800; margin-bottom: 8px; letter-spacing: -0.5px;">⚖️ 智慧型法律判決書 Graph RAG 搜尋系統</h1>
            <p style="color: #6b7280; font-size: 1.05rem; max-width: 600px; margin: 0 auto; line-height: 1.5;">
                輸入自然語言描述糾紛或犯罪情境，利用<b>語意向量</b>與<b>知識圖譜關聯</b>，即時匹配最相似的判決案例、被告人物與引用法條。
            </p>
        </div>
        """)
        
        with gr.Row():
            # 左側：搜尋輸入與過濾欄
            with gr.Column(scale=1):
                gr.HTML("""
                <div style="font-weight: 700; font-size: 1.1rem; color: #1f2937; margin-bottom: 12px; border-left: 4px solid #1d4ed8; padding-left: 8px;">
                    🔍 搜尋配置
                </div>
                """)
                
                query_input = gr.Textbox(
                    label="情境或犯罪描述",
                    placeholder="請輸入例如：被告喝酒後騎乘重機車，被警察攔檢酒精濃度超標...",
                    lines=5,
                    max_lines=10
                )
                
                with gr.Row():
                    court_level_input = gr.Dropdown(
                        choices=["全部", "地方法院", "高等法院", "最高法院"],
                        value="全部",
                        label="法院層級"
                    )
                    case_type_input = gr.Dropdown(
                        choices=["全部", "民事", "刑事", "行政"],
                        value="全部",
                        label="案件種類"
                    )
                    
                limit_input = gr.Slider(
                    minimum=1,
                    maximum=10,
                    value=3,
                    step=1,
                    label="顯示結果筆數"
                )
                
                search_btn = gr.Button("開始檢索", variant="primary", size="lg")
                
                gr.HTML("""
                <div style="margin-top: 20px; padding: 15px; border-radius: 8px; background-color: #f8fafc; border: 1px solid #e2e8f0; font-size: 0.85rem; color: #64748b; line-height: 1.5;">
                    💡 <b>小提示：</b><br>
                    - 請儘量描述具體的情節（如工具、傷勢、酒精濃度、是否逃逸等），這能提高向量匹配的精確度。<br>
                    - 檢索速度完全不受 CPU 阻礙，全賴 Neo4j 向量索引秒級反彈！
                </div>
                """)
                
            # 右側：搜尋結果展示區
            with gr.Column(scale=2):
                gr.HTML("""
                <div style="font-weight: 700; font-size: 1.1rem; color: #1f2937; margin-bottom: 12px; border-left: 4px solid #1d4ed8; padding-left: 8px;">
                    📋 匹配結果與圖譜統計
                </div>
                """)
                
                output_area = gr.HTML(
                    value="<div style='color: #9ca3af; text-align: center; padding: 50px 0; border: 1px dashed #e5e7eb; border-radius: 8px;'>💡 請於左側輸入描述，點選「開始檢索」查閱結果。</div>"
                )
                
        # 綁定按鈕事件與按下 Enter 鍵搜尋
        search_btn.click(
            fn=perform_search,
            inputs=[query_input, court_level_input, case_type_input, limit_input],
            outputs=output_area
        )
        query_input.submit(
            fn=perform_search,
            inputs=[query_input, court_level_input, case_type_input, limit_input],
            outputs=output_area
        )
        
    demo.launch(server_name="127.0.0.1", server_port=7860, share=False)

if __name__ == "__main__":
    main()
