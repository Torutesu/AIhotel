// エントリポイント（C-10）。
//
// 実体は app.ts（Express アプリの組み立て）と server.ts（listen とシャットダウン）に
// 分離している。Docker イメージは `node dist/index.js` を実行するため、
// このファイルは server.ts を読み込むだけの薄い入口として残す。
import './server.js'

export { app, app as default } from './app.js'
