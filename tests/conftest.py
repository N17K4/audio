"""pytest 配置：将 backend/ 加入 sys.path，使所有测试可直接导入后端模块。"""
import sys
from pathlib import Path

# backend/ 目录加入导入路径
sys.path.insert(0, str(Path(__file__).parent.parent / "backend"))
