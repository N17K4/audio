#!/usr/bin/env python3
"""
上传文件到又拍云
使用 AK/SK 认证方式
"""

import sys
import os
import hashlib
import hmac∏1
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
