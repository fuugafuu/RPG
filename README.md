# Vercelフロントエンド用ビルド

これは **フロント（静的）だけをVercel** に置くためのフォルダです。  
**Socket.IOサーバ**は別ホスト（Railway/Render/Fly など）に置いて、そのURLをクライアントに指定します。

## 使い方

1. どこかに `server.js`（既存のサーバ）をデプロイ  
   - 例: Render → Web Service → Node 18 → `npm start`  
   - `PORT` はプラットフォームが与える値を使用（コードは `process.env.PORT || 3000`）
   - CORSは既に `origin: '*'` にしてある修正版を使う

2. Vercel にこの `public/` をデプロイ（Static Site）

3. クライアントにサーバURLを教える方法（どれか）
   - `index.html` のコメント行を有効化して:  
     ```html
     <script>window.WS_URL="https://YOUR-SOCKET-HOST.onrender.com";</script>
     ```
   - またはURLパラメータ: `https://your-vercel.app/?ws=https://YOUR-SOCKET-HOST.onrender.com`

## ローカル確認
- サーバをローカル3000で起動（`npm run start`）
- 静的フロントを任意のポートで開き、`?ws=http://localhost:3000` を付ける

## 注意
- Vercelの静的サイトは `/socket.io/socket.io.js` を配信しないため、**CDNのクライアント**を使用しています。
- セキュリティを高める場合は、CORSの`origin`を自分のフロントドメインに限定してください。
