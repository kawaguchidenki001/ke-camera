# GAS(Code.gs)を「保存先フォルダ指定」に対応させる手順

アプリ(北方カメラ v1.9.8 以降)は、送信のたびに **parent** というパラメータで
保存先(親)フォルダのIDを送ります。GAS 側でこれを受け取るようにすると、
アプリのメニュー「保存先フォルダを設定」で保存先を変更できるようになります。

`parent` が空のときは、これまでどおり GAS に設定してある既定フォルダを使います。
（つまり、この対応を入れても今までの動作は変わりません）

---

## 1) 次の関数を Code.gs の末尾に貼り付ける

```javascript
/**
 * 保存先(親)フォルダを返す。
 * アプリから parent が送られてきたらそのフォルダ、無ければ従来の既定フォルダ。
 */
function getParentFolder_(e) {
  var pid = (e && e.parameter && e.parameter.parent)
    ? String(e.parameter.parent).trim() : "";
  if (pid) {
    try {
      return DriveApp.getFolderById(pid);
    } catch (err) {
      // ID が違う/権限が無い場合は既定フォルダにフォールバック
    }
  }
  return getDefaultParentFolder_();   // ← 下記 2) を参照
}

/** 従来の既定フォルダ(ここは今お使いのコードに合わせてください) */
function getDefaultParentFolder_() {
  return DriveApp.getFolderById(PARENT_FOLDER_ID);   // 既存の定数名に合わせる
}
```

## 2) 既定フォルダの取得部分を合わせる

今の Code.gs で親フォルダを取得している行(例)を `getDefaultParentFolder_` の中に移します。

よくある書き方の例:
- `DriveApp.getFolderById(PARENT_FOLDER_ID)`
- `DriveApp.getFolderById('1AbC...')`
- `DriveApp.getRootFolder()`

## 3) 部屋フォルダを作っている箇所を差し替える

`folder`(例: `A4棟-405`)のフォルダを探す/作る処理で、親フォルダの取得を
`getParentFolder_(e)` に変えます。

**変更前(例)**
```javascript
var parent = DriveApp.getFolderById(PARENT_FOLDER_ID);
var it = parent.getFoldersByName(folderName);
var roomFolder = it.hasNext() ? it.next() : parent.createFolder(folderName);
```

**変更後**
```javascript
var parent = getParentFolder_(e);          // ← ここだけ変更
var it = parent.getFoldersByName(folderName);
var roomFolder = it.hasNext() ? it.next() : parent.createFolder(folderName);
```

※ `e` が渡っていない関数の場合は、呼び出し元から `e` を引数で渡してください。

## 4) (任意) 接続テストで保存先名を表示する

`doGet` の `ping` の応答に、実際の保存先名を返すようにすると、
アプリの「GAS 接続テスト」で保存先を確認できます。

```javascript
if (action === 'ping') {
  var f = getParentFolder_(e);
  return jsonp_(e, { ok: true, folder: f.getName() });
}
```

## 5) 再デプロイ

Apps Script エディタで **デプロイ → デプロイを管理 → 編集(鉛筆) →
バージョン「新バージョン」→ デプロイ** を実行してください。
（URL は変わりません）

---

## 使い方(アプリ側)

1. Google Drive で保存したいフォルダを開く
2. アドレスバーのURLをコピー
   （例: `https://drive.google.com/drive/folders/1AbC...`）
3. アプリのメニュー(左上の ≡) → **「保存先フォルダを設定」**
4. URL を貼り付けて「追加」→ 自動で接続テストが走ります

- 元に戻すときは、同じ画面の「**初期の保存先に戻す**」を選びます
- 設定は端末ごとに保存されます（端末ごとに違う保存先にもできます）

## 注意

- 指定するフォルダは、**GAS を実行しているアカウントが編集できる**必要があります
  （共有ドライブや共有フォルダの場合は、そのアカウントを編集者に追加してください）
- 権限が無い/IDが違う場合は、自動的に既定フォルダに保存されます（写真は失われません）
