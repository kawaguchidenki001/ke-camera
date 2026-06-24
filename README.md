# KE-Camera ・ 小黒板カメラ

工事黒板を写真に焼き込んで Google Drive に自動保存する、現場用 PWA(Progressive Web App)。

## 特徴

- **インストール不要** ブラウザだけで動く。スマホ・タブレットのホーム画面に追加すればネイティブアプリのように使える
- **電子黒板の焼き込み** 工事名・工種・施工者・撮影内容・撮影年月日・連番を 1 枚の写真にまとめて保存
- **Google Drive 自動保存** 撮影 → 確認 → ワンタップで Drive 上の指定フォルダへ
- **工事マスタは Google Sheets** 工事情報・保存先フォルダを表で一元管理
- **取引先含めて使える** 認証は `drive.file` スコープのみなので Google の検証なしで誰でも使える
- **オフライン起動可** Service Worker で本体はキャッシュ済み。撮影は電波無くても可能(アップロードはオンライン時)
- **GitHub Pages にデプロイ可** 静的ホスティングのみで運用可能

## 動作要件

- HTTPS 環境(カメラ API の必須条件)。GitHub Pages はデフォルトで HTTPS
- モダンブラウザ(iOS Safari 14+ / Android Chrome / Edge / Firefox)
- カメラへのアクセス許可
- Google アカウント(ログインのため)

## ファイル構成

```
ke-camera/
├── index.html              # SPA のメイン HTML
├── style.css               # スタイル
├── manifest.json           # PWA マニフェスト
├── sw.js                   # Service Worker
├── js/
│   ├── app.js              # メインエントリ(状態管理 / イベント)
│   ├── config.js           # 定数・既定値
│   ├── storage.js          # localStorage 管理
│   ├── ui.js               # 画面遷移 / トースト / モーダル
│   ├── auth.js             # Google OAuth 2.0(GIS)
│   ├── sheets.js           # 工事マスタ読み取り
│   ├── drive.js            # Drive アップロード
│   ├── camera.js           # カメラ起動
│   └── composer.js         # 黒板 → 写真への焼き込み
├── icons/
│   ├── icon.svg            # マスター SVG
│   ├── icon-192.png        # PWA 192×192
│   ├── icon-512.png        # PWA 512×512
│   └── icon-maskable-512.png  # Maskable
└── docs/
    ├── SETUP.md            # セットアップ手順(必読)
    ├── USAGE.md            # 使い方
    └── sheet-template.csv  # 工事マスタの列構造サンプル
```

## はじめかた

1. **`docs/SETUP.md` を見ながら Google Cloud + Google Sheets + GitHub Pages を準備**
2. 公開 URL を開く → 「設定」へ
3. OAuth クライアント ID / API キー / シート ID / 既定 Drive フォルダ ID を入力 → 保存
4. ホームに戻って「Google でログイン」
5. 工事を選んで黒板を入力 → 撮影 → Drive に保存 🎉

詳細は `docs/SETUP.md` と `docs/USAGE.md` を参照。

## 設計上の重要ポイント

### OAuth スコープを `drive.file` に限定している理由

`drive.file` スコープは「アプリ自身が作った/開いたファイルにのみアクセスできる」もの。Google による OAuth 検証(verification)の対象外で、外部公開しても誰でも認可なしで利用できる。`drive` や `drive.readonly` のような広域スコープを使うと検証が必要になり、取引先や協力会社にすぐ使ってもらえなくなる。

### 工事マスタを「APIキー方式」で読む理由

工事マスタは Google Sheets を「リンクを知っている全員に閲覧可能」設定にし、API キー経由で読み取る。これにより OAuth スコープに Sheets を含めずに済み、検証不要な設計を保てる。**API キーには HTTP リファラ制限を必ず掛けること**(設定手順は SETUP.md 参照)。

### Service Worker で外部 API はキャッシュしない

Google API(認証・Drive・Sheets)へのリクエストは Service Worker で介入せず、常にネットワークを使う。これは認証ヘッダ・動的データを古いキャッシュで上書きしないため。

## ライセンス

社内利用を想定。再配布する場合は適宜判断のこと。

## バージョン

v0.1.0 (2026-06)
