import { NextResponse } from 'next/server';
import { run_community_detection } from '@/scripts/community_detection';

export async function POST() {
  try {
    console.log('[API Admin] 管理員點擊觸發 LPA 社群偵測運算...');
    
    // 執行社群偵測演算法，並回填 Neo4j 屬性
    await run_community_detection();

    return NextResponse.json({
      success: true,
      message: '社群偵測（LPA）執行成功！已成功重新劃分圖譜社群並回填 Neo4j 屬性。',
    });
  } catch (error: any) {
    console.error('[API Community Detection Error]:', error);
    return NextResponse.json(
      { error: error.message || '社群偵測執行失敗' },
      { status: 500 }
    );
  }
}
