#!/usr/bin/env python3
"""
上传文件到又拍云
使用 AK/SK 认证方式
"""

import sys
import os
import hashlib
import hmac
import base64
from datetime import datetime
import requests
from pathlib import Path


def upload_to_upyun(
    bucket: str,
    operator_ak: str,
    operator_sk: str,
    local_file: str,
    remote_path: str
) -> bool:
    """
    上传文件到又拍云

    Args:
        bucket: 存储空间名称
        operator_ak: 操作员 AK（用作 operator 字段）
        operator_sk: 操作员 SK（用作签名密钥）
        local_file: 本地文件路径
        remote_path: 远程路径 (如 /releases/v1.0.0/file.zip)

    Returns:
        bool: 上传是否成功
    """

    file_path = Path(local_file)
    if not file_path.exists():
        print(f"❌ 文件不存在: {local_file}")
        return False

    file_size = file_path.stat().st_size
    print(f"📦 准备上传: {local_file}")
    print(f"   文件大小: {file_size / (1024**2):.2f} MB")
    print(f"   目标路径: {bucket}{remote_path}")

    # 计算文件 MD5
    md5_hash = hashlib.md5()
    with open(file_path, 'rb') as f:
        for chunk in iter(lambda: f.read(8192), b''):
            md5_hash.update(chunk)
    content_md5 = md5_hash.hexdigest()

    # 又拍云 API 端点
    api_url = f"https://v0.api.upyun.com/{bucket}{remote_path}"

    # 准备认证信息
    date_str = datetime.utcnow().strftime('%a, %d %b %Y %H:%M:%S GMT')

    # 生成签名
    # 格式: method&uri&date&content_length&content_md5
    sign_str = f"PUT&{remote_path}&{date_str}&{file_size}&{content_md5}"
    signature = base64.b64encode(
        hmac.new(
            operator_sk.encode('utf-8'),
            sign_str.encode('utf-8'),
            hashlib.sha1
        ).digest()
    ).decode('utf-8')

    auth_header = f"UpYun {operator_ak}:{signature}"

    # 准备请求头
    headers = {
        'Authorization': auth_header,
        'Date': date_str,
        'Content-MD5': content_md5,
        'Content-Length': str(file_size)
    }

    print(f"\n🔐 认证方式: UpYun HMAC-SHA1")
    print(f"   操作员: {operator_ak[:8]}...")

    # 上传文件
    try:
        print(f"\n⏳ 上传中...")
        with open(file_path, 'rb') as f:
            response = requests.put(
                api_url,
                data=f,
                headers=headers,
                timeout=300  # 5 分钟超时
            )

        if response.status_code in (200, 201):
            print(f"✅ 上传成功！")
            print(f"   HTTP {response.status_code}")
            print(f"   URL: https://{bucket}.b0.aicdn.com{remote_path}")
            return True
        else:
            print(f"❌ 上传失败！")
            print(f"   HTTP {response.status_code}")
            print(f"   响应: {response.text[:200]}")
            return False

    except requests.exceptions.RequestException as e:
        print(f"❌ 请求异常: {e}")
        return False


if __name__ == '__main__':
    if len(sys.argv) < 6:
        print("用法: python3 upload_to_upyun.py <bucket> <ak> <sk> <local_file> <remote_path>")
        print("示例: python3 upload_to_upyun.py audio1 ak_xxx sk_xxx dist.zip /releases/v1.0.0/file.zip")
        sys.exit(1)

    bucket = sys.argv[1]
    ak = sys.argv[2]
    sk = sys.argv[3]
    local_file = sys.argv[4]
    remote_path = sys.argv[5]

    success = upload_to_upyun(bucket, ak, sk, local_file, remote_path)
    sys.exit(0 if success else 1)
