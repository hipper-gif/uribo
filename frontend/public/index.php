<?php
// Nicolioセッションゲート（ADR-0003 D2・2026-09-15）
// うりぼーは自前ログインを持たず、公開URLに置くと素通しになるため、
// Nicolioのログインセッションを入口で要求する。未ログインはNicolioログインへ302。
// 共通部品の正本 = nicolio repo api/session_gate.php（デプロイ先 ../nicolio-api/）
require __DIR__ . '/../nicolio-api/session_gate.php';
nicolio_session_gate();
header('Cache-Control: no-cache, no-store, must-revalidate');
readfile(__DIR__ . '/index.html');
