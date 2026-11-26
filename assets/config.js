// 這間店的設定：換店名、地址、LINE 都改這裡就好（改完記得把 index.html 裡 config.js 後面的 ?v= 換成今天日期）
window.CONFIG = {
    storeName: '早餐店',      // 【店名】：招牌、標題、日報上的店名
    storeInfo: '',            // 【店家地址或 LINE 官方帳號 ID】：印在日報最下面，讓看到的人找得到店
    liffId: '',               // 【LIFF ID】：店家在 LINE Developers 建好 LIFF app 後填（第二階段才用到）
    apiUrl: '',               // Google Apps Script 部署好的網址（第二階段才用到）
};
