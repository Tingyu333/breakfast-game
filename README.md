# 早餐店打工遊戲

給【店名】做的手機小遊戲：客人從店家的 LINE 官方帳號點連結進來玩，上排行榜。玩法照丼步喱的「早餐・煎」。

- 遊戲：`index.html`（店名、地址等設定在 `assets/config.js`）
- 規格：`docs/SPEC.md`（每次開工先讀這份；第〇節是跟範本不一樣的地方）
- 版本紀錄：`changelog.md`
- 模擬機器人：`node tools/sim.js`（跑範本對照：`node tools/sim.js reference/zaocan.html`）
- 範本：`reference/`（從丼步喱複製來的原版，只參考、不直接上線）
  - `zaocan.html`：遊戲本體
  - `zaocan.md`：說明書
  - `saveimg.js`：存日報圖片（處理 LINE 內建瀏覽器不能下載）
