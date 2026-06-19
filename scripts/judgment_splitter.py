# -*- coding: utf-8 -*-
from __future__ import annotations
"""
判決書段落切分器 (judgment_splitter.py)

功能：
  將判決書的「事實及理由」區塊進一步切分為細顆粒度的 Section 節點。
  支援民事、刑事、行政案件的結構特徵，並設有兜底機制以防止漏字。
"""
import re

def detect_heading(line: str) -> tuple[str, str] | None:
    """
    偵測行是否為特定的結構化子標題。
    回傳：(role, type) 或 None
    """
    # 1. 移除字間所有空白與全形空白，並除去結尾的冒號
    norm = line.replace(" ", "").replace("\u3000", "").strip().rstrip(":：")
    if not norm:
        return None
        
    # 2. 移除前置序號（例如：一、, ㈠, 1., 1、, 壹、, (一), ㈡等）
    norm_stripped = re.sub(r'^[一二三四五六七八九十百壹貳參肆伍陸柒捌玖拾\d]+[、.．：:]', '', norm)
    norm_stripped = re.sub(
        r'^[㈠㈡㈢㈣㈤㈥㈦㈧㈨㈩①②③④⑤⑥⑦⑧⑨⑩⑴⑵⑶⑷⑸⑹⑺⑻⑼⑽⒈⒉⒊⒋⒌⒍⒎⒏⒐⒑]', 
        '', 
        norm_stripped
    )
    norm_stripped = re.sub(
        r'^[\(（][一二三四五六七八九十百壹貳參肆伍陸柒捌玖拾\d]+[\)）][．、.：:]?', 
        '', 
        norm_stripped
    )
    norm_stripped = norm_stripped.strip().rstrip(":：")
    
    # 3. 精確匹配標準標題名稱
    # 程序事項
    if norm_stripped in ["程序事項", "程序方面", "程序部分", "程序事項"]:
        return "court", "procedure"
    # 事實概要 (行政特有)
    if norm_stripped in ["事實概要"]:
        return "court", "facts_summary"
    # 原告主張
    if norm_stripped in [
        "原告主張", "原告起訴主張", "原告主張略以", "聲請人主張", 
        "上訴人主張", "原告起訴主張及聲明", "本件原告主張", 
        "公訴人起訴意旨", "起訴意旨", "告訴人起訴意旨", "原告起訴主張及聲明如下"
    ]:
        return "plaintiff", "claims"
    # 被告答辯
    if norm_stripped in [
        "被告答辯", "被告答辯略以", "被告答辯則以", "被告抗辯", 
        "被告則以", "被告答辯及聲明", "答辯人答辯略以", "被告主張"
    ]:
        return "defendant", "claims"
    # 兩造不爭執事項
    if norm_stripped in ["兩造不爭執事項", "不爭執事項", "不爭執之事實", "不爭執事項略以"]:
        return "court", "uncontested"
    # 得心證理由 / 本院判斷
    if norm_stripped in [
        "本院之判斷", "本院判斷", "得心證之理由", "理由", 
        "本院之見解", "本院判斷如下", "本院之判斷：", "得心證的理由"
    ]:
        return "court", "reasoning"
    # 犯罪事實
    if norm_stripped in ["犯罪事實", "事實", "犯罪之事實", "背景事實"]:
        return "court", "facts"
    # 證據能力 (刑事特有)
    if norm_stripped in ["證據能力", "證據能力部分", "關於證據能力"]:
        return "court", "evidence_ability"
    # 論罪科刑 (刑事特有)
    if norm_stripped in ["論罪科刑", "量刑理由", "量刑說明"]:
        return "court", "sentencing"
    # 沒收 (刑事特有)
    if norm_stripped in ["沒收", "關於沒收"]:
        return "court", "confiscation"
        
    return None

def split_judgment_into_sections(case_type: str, fact_reason: str) -> list[dict]:
    """
    將事實及理由的全文大文本進行 Section 拆分。
    回傳結構：
      [
        {
          "index": 1,
          "role": "court",
          "type": "procedure",
          "text": "..."
        },
        ...
      ]
    """
    if not fact_reason or not fact_reason.strip():
        return []
        
    lines = fact_reason.split("\r\n")
    sections = []
    
    # 預設起始區塊為 reasoning (法院論證) 作為兜底
    current_section = {
        "role": "court",
        "type": "reasoning",
        "lines": []
    }
    
    for line in lines:
        heading_info = detect_heading(line)
        
        if heading_info:
            role, type_name = heading_info
            
            # 若當前區塊有內容，先存檔
            if current_section["lines"]:
                # 過濾並組合當前段落文字
                text = "\r\n".join(current_section["lines"]).strip()
                if text:
                    sections.append({
                        "role": current_section["role"],
                        "type": current_section["type"],
                        "text": text
                    })
            
            # 開啟新區塊，但此標題行本身如果不為空，也做為新區塊的第一行（或可選擇不保留標題）
            # 我們選擇保留該標題行，提供完整的結構脈絡
            current_section = {
                "role": role,
                "type": type_name,
                "lines": [line]
            }
        else:
            current_section["lines"].append(line)
            
    # 存檔最後一個區塊
    if current_section["lines"]:
        text = "\r\n".join(current_section["lines"]).strip()
        if text:
            sections.append({
                "role": current_section["role"],
                "type": current_section["type"],
                "text": text
            })
            
    # 賦予 1-based index，並進行簡單的淨化過濾
    final_sections = []
    idx = 1
    for sec in sections:
        cleaned_text = sec["text"].strip()
        if cleaned_text:
            final_sections.append({
                "index": idx,
                "role": sec["role"],
                "type": sec["type"],
                "text": cleaned_text
            })
            idx += 1
            
    return final_sections
