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
import requests
from datetime import datetime
from email.utils import formatdate

# Windows 编码修复：设置 stdout 为 UTF-8
if sys.platform == 'win32':
    import io
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')


def upload_to_upyun(bucket, credential1, credential2, local_file, remote_path):
    """
    上传文件到又拍云（支持 AK/SK 或 OPERATOR/PASSWORD 认证）

    Args:
        bucket: 空间名
        credential1: AK 或 OPERATOR（操作员）
        credential2: SK 或 PASSWORD（密码）
        local_file: 本地文件路径
        remote_path: 远程路径（如 /releases/v1.0.0/file.zip）

    Returns:
        bool: 是否上传成功
    """

    if not os.path.exists(local_file):
        print(f"[ERROR] 本地文件不存在: {local_file}")
        return False

    file_size = os.path.getsize(local_file)

    try:
        print(f"📦 准备上传: {local_file}")
        print(f"   文件大小: {file_size / (1024*1024):.2f} MB")
        print(f"   远程路径: {remote_path}")

        # 读取文件内容
        with open(local_file, 'rb') as f:
            file_content = f.read()

        # 计算 MD5
        md5_hash = hashlib.md5(file_content).hexdigest()

        # 使用 HMAC-SHA1 进行签名（credential1=AK/OPERATOR, credential2=SK/PASSWORD）
        sign_data = f"PUT\n{remote_path}\n{credential1}\n{md5_hash}\n{int(file_size)}\n"
        hmac_sha1 = hmac.new(credential2.encode(), sign_data.encode(), hashlib.sha1)
        authorization = f"UpYun {credential1}:{base64.b64encode(hmac_sha1.digest()).decode()}"

        # 上传
        url = f"https://v0.api.upyun.com{remote_path}"
        date_header = formatdate(timeval=None, localtime=False, usegmt=True)
        headers = {
            'Authorization': authorization,
            'Content-MD5': md5_hash,
            'Date': date_header,
        }

        print(f"   上传地址: {url}")
        print(f"[DEBUG] MD5: {md5_hash}")
        print(f"[DEBUG] Authorization: {headers['Authorization'][:50]}...")
        print(f"[DEBUG] Date: {headers['Date']}")
        response = requests.put(url, data=file_content, headers=headers, timeout=300)

        if response.status_code in [200, 201]:
            print(f"✅ 上传成功")
            return True
        else:
            print(f"[ERROR] 上传失败，状态码: {response.status_code}")
            print(f"   响应: {response.text[:200]}")
            return False

    except requests.exceptions.RequestException as e:
        print(f"[ERROR] 请求异常: {e}")
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
