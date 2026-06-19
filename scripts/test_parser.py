# -*- coding: utf-8 -*-
"""
單元測試驗證腳本
驗證法院解析、正文清理、法條與當事人抽取邏輯
"""
import unittest
import os
import sys

# 確保載入 scripts 中的模組
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from court_parser import parse_court_from_folder, to_generic_root_norm
from text_cleaner import clean_judgment_text
from statute_parser import extract_statutes
from import_judgments import extract_parties_and_judges
from judgment_splitter import split_judgment_into_sections


class TestJudgmentsParser(unittest.TestCase):
    
    def test_court_parser(self):
        """測試法院名稱與層級解析"""
        res_civil = parse_court_from_folder("臺灣臺北地方法院民事")
        self.assertIsNotNone(res_civil)
        self.assertEqual(res_civil["unit_norm"], "臺灣臺北地方法院")
        self.assertEqual(res_civil["court_root_norm"], "臺灣臺北地方法院")
        self.assertEqual(to_generic_root_norm(res_civil["unit_norm"]), "地方法院")
        self.assertEqual(res_civil["case_type"], "民事")
        
        res_crim = parse_court_from_folder("最高法院刑事")
        self.assertIsNotNone(res_crim)
        self.assertEqual(res_crim["unit_norm"], "最高法院")
        self.assertEqual(res_crim["court_root_norm"], "最高法院")
        self.assertEqual(to_generic_root_norm(res_crim["unit_norm"]), "最高法院")
        self.assertEqual(res_crim["case_type"], "刑事")
        
        res_admin = parse_court_from_folder("臺北高等行政法院行政")
        self.assertIsNotNone(res_admin)
        self.assertEqual(res_admin["unit_norm"], "臺北高等行政法院")
        self.assertEqual(res_admin["court_root_norm"], "臺北高等行政法院")
        self.assertEqual(to_generic_root_norm(res_admin["unit_norm"]), "高等行政法院")
        self.assertEqual(res_admin["case_type"], "行政")

    def test_statute_parser(self):
        """測試法條提取"""
        test_text = "被告違反刑法第185條之3第1項、第276條規定，且違反民法第184條第1項前段及第2項前段。"
        statutes = extract_statutes(test_text)
        
        # 轉為標準名稱格式
        laws_list = [f"{law}第{art}條{sub}" for law, art, sub, _ in statutes]
        
        self.assertIn("中華民國刑法第185之3條第1項", laws_list)
        self.assertIn("中華民國刑法第276條", laws_list)
        self.assertIn("民法第184條第1項前段", laws_list)
        self.assertIn("民法第184條第2項前段", laws_list)

    def test_parties_extraction_from_mock_text(self):
        """使用模擬判決書內容測試關係人提取"""
        mock_jfull = (
            "臺灣臺北地方法院民事判決\n"
            "111年度消字第17號\n"
            "原      告  張小三\n"
            "            李小四\n"
            "共      同\n"
            "訴訟代理人  王大律師\n"
            "被      告  趙小五即六六商行\n"
            "訴訟代理人  錢二律師\n"
            "上列當事人間請求損害賠償事件，判決如下：\n"
            "主文\n"
            "原告之訴駁回。\n"
            "事實及理由\n"
            "一、原告主張...\n"
            "中　　華　　民　　國　　115 　年　　4 　　月　　30　　日\n"
            "                  民事第三庭  法  官  孫法官\n"
            "                              書記官  李書記\n"
        )
        
        parties = extract_parties_and_judges(mock_jfull)
        
        self.assertIn("張小三", parties["plaintiffs"])
        self.assertIn("李小四", parties["plaintiffs"])
        self.assertIn("趙小五即六六商行", parties["defendants"])
        self.assertIn("王大律師", parties["representatives"])
        self.assertIn("錢二律師", parties["representatives"])
        self.assertIn("孫法官", parties["judges"])

    def test_judgment_splitter(self):
        """測試判決書段落拆分與兜底機制"""
        mock_fact_reason = (
            "一、程序事項：\r\n"
            "本件原告起訴後，代表人有變更...\r\n"
            "二、事實概要：\r\n"
            "原告不服被告所為裁罰，提起訴願...\r\n"
            "三、原告主張略以：\r\n"
            "被告認事用法有違誤...\r\n"
            "四、被告答辯則以：\r\n"
            "原告逾期未提撥準備金，裁處有據...\r\n"
            "五、本院之判斷：\r\n"
            "經查，本件原告確實違反規定..."
        )
        
        sections = split_judgment_into_sections("行政", mock_fact_reason)
        
        # 應正確拆分為 5 個 Section
        self.assertEqual(len(sections), 5)
        
        # 驗證每個 Section 的角色與類型
        self.assertEqual(sections[0]["index"], 1)
        self.assertEqual(sections[0]["role"], "court")
        self.assertEqual(sections[0]["type"], "procedure")
        self.assertIn("程序事項", sections[0]["text"])
        self.assertIn("代表人有變更", sections[0]["text"])
        
        self.assertEqual(sections[1]["index"], 2)
        self.assertEqual(sections[1]["role"], "court")
        self.assertEqual(sections[1]["type"], "facts_summary")
        self.assertIn("事實概要", sections[1]["text"])
        
        self.assertEqual(sections[2]["index"], 3)
        self.assertEqual(sections[2]["role"], "plaintiff")
        self.assertEqual(sections[2]["type"], "claims")
        
        self.assertEqual(sections[3]["index"], 4)
        self.assertEqual(sections[3]["role"], "defendant")
        self.assertEqual(sections[3]["type"], "claims")
        
        self.assertEqual(sections[4]["index"], 5)
        self.assertEqual(sections[4]["role"], "court")
        self.assertEqual(sections[4]["type"], "reasoning")
        self.assertIn("本院之判斷", sections[4]["text"])
        
        # 測試兜底機制 (Fallback)
        fallback_text = "本件被告於民國115年4月1日打傷原告，經本院審理..."
        fallback_sections = split_judgment_into_sections("刑事", fallback_text)
        self.assertEqual(len(fallback_sections), 1)
        self.assertEqual(fallback_sections[0]["role"], "court")
        self.assertEqual(fallback_sections[0]["type"], "reasoning")
        self.assertEqual(fallback_sections[0]["text"], fallback_text)


if __name__ == "__main__":
    unittest.main()
