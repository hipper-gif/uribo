"""Mneme credentials API クライアント (うりぼー)

サイト別ログイン情報は Mneme（全社共通DB）の credentials テーブルで一元管理し、
うりぼーからは service_name で問い合わせて取得する。

.env に必要な値:
    MNEME_API_URL    例: https://twinklemark.xsrv.jp/mneme-api/index.php
    MNEME_API_TOKEN  Bearer token

使い方:
    from credentials import get
    creds = get("salonboard_neyagawa")
    creds["username"], creds["password"]
"""
from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request
from typing import TypedDict


class Credential(TypedDict):
    username: str | None
    password: str | None
    login_url: str | None
    notes: str | None


_cache: dict[str, Credential] = {}


def _api_url() -> str:
    base = os.environ.get("MNEME_API_URL", "https://twinklemark.xsrv.jp/mneme-api/index.php")
    return f"{base.rstrip('/')}/credentials"


def _token() -> str:
    return os.environ.get("MNEME_API_TOKEN", "mneme_secret_2525xsrv")


def get(service_name: str) -> Credential:
    """service_name から認証情報を取得する。同一プロセス内ではキャッシュ。"""
    if service_name in _cache:
        return _cache[service_name]

    query = urllib.parse.urlencode({
        "service_name": f"eq.{service_name}",
        "select": "username,password,login_url,notes",
    })
    req = urllib.request.Request(
        f"{_api_url()}?{query}",
        headers={"Authorization": f"Bearer {_token()}"},
        method="GET",
    )
    with urllib.request.urlopen(req, timeout=30) as resp:
        rows = json.loads(resp.read().decode("utf-8"))

    if not rows:
        raise RuntimeError(f"Mneme に credentials が見つかりません: service_name={service_name}")
    row = rows[0]
    cred: Credential = {
        "username": row.get("username"),
        "password": row.get("password"),
        "login_url": row.get("login_url"),
        "notes": row.get("notes"),
    }
    _cache[service_name] = cred
    return cred
