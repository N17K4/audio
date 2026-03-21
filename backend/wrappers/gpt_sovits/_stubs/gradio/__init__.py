"""gradio 桩模块 — GPT-SoVITS 的 tools/my_utils.py 会 import gradio，
但训练流程不需要 UI，只需 clean_path 等工具函数。
此桩提供空壳，使 import 不报错。"""


class _Stub:
    def __getattr__(self, name):
        return _Stub()

    def __call__(self, *args, **kwargs):
        return _Stub()


Info = Warning = Error = _Stub
