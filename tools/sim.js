// 模擬機器人：直接載入遊戲頁面（index.html）裡的規則程式碼來跑，不另外抄一份規則。
// 用法：
//   node tools/sim.js                      跑 index.html，四種手速各 400 場
//   node tools/sim.js reference/zaocan.html 跑範本（拿來對照）
//   N=1000 node tools/sim.js               每種手速跑幾場
//   SPEEDS=1.2,0.9 node tools/sim.js    換別的手速
//   SHOP='{"burner":2,...}' node tools/sim.js reference/zaocan.html   範本的升級等級
// 機器人每 0.6／0.45／0.32／0.24 秒做一個動作；按住倒飲料的時候不能做別的。
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const file = path.resolve(process.argv[2] || path.join(__dirname, '..', 'index.html'));
const N = Number(process.env.N || 400);
const SPEEDS = process.env.SPEEDS ? process.env.SPEEDS.split(',').map(Number) : [0.6, 0.45, 0.32, 0.24];
const html = fs.readFileSync(file, 'utf8');
// 最後一段沒有 src 的 <script> 就是遊戲本體
const code = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]).pop();

// ---- 假的瀏覽器：畫圖、DOM、聲音全部什麼都不做 ----
const noop = () => { };
const anything = () => new Proxy(function () { }, {
    get: (t, k) => k === Symbol.toPrimitive ? () => 0 : k === 'then' ? undefined : k === 'measureText' ? () => ({ width: 10 }) : anything(),
    set: () => true,
    apply: () => anything(),
    construct: () => anything(),
});
function fakeEl() {
    return {
        classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
        style: {}, dataset: {}, textContent: '', innerHTML: '', disabled: false, src: '',
        addEventListener: noop, removeEventListener: noop, setAttribute: noop, getAttribute: () => null,
        animate: noop, scrollIntoView: noop, prepend: noop, append: noop, appendChild: noop, remove: noop,
        querySelector: () => fakeEl(), querySelectorAll: () => [], closest: () => null,
        getContext: () => anything(), getBoundingClientRect: () => ({ left: 0, top: 0, width: 360, height: 440 }),
        setPointerCapture: noop, focus: noop, toBlob: cb => cb(null),
    };
}
function makeContext() {
    const els = {};
    const storage = {};
    const shopLv = process.env.SHOP ? JSON.parse(process.env.SHOP) : {};
    const ctx = {
        console, Math, JSON, Date, Number, String, Object, Array, Promise, Symbol, Proxy, Error, Map, Set, RegExp, isNaN, parseInt, parseFloat,
        performance: { now: () => ctx.__now },
        __now: 0,
        setTimeout: () => 0, clearTimeout: noop, setInterval: () => 0, clearInterval: noop,
        requestAnimationFrame: () => 0,
        navigator: { userAgent: 'node', vibrate: () => true },
        localStorage: { getItem: k => storage[k] ?? null, setItem: (k, v) => { storage[k] = String(v); }, removeItem: k => { delete storage[k]; } },
        matchMedia: () => ({ matches: true, addEventListener: noop }),
        fetch: () => Promise.reject(new Error('offline')),
        Image: function () { return fakeEl(); },
        File: function () { return {}; },
        URL: { createObjectURL: () => '' },
        AudioContext: undefined,
        document: {
            getElementById: id => (els[id] = els[id] || fakeEl()),
            querySelector: () => fakeEl(), querySelectorAll: () => [],
            createElement: () => fakeEl(), addEventListener: noop,
            documentElement: fakeEl(), body: fakeEl(), head: fakeEl(),
            fonts: { load: () => Promise.resolve(), ready: Promise.resolve() },
            hidden: false,
        },
        // 範本才用得到的：丼步喱的錢包、LINE、存圖
        Wallet: { fmt: n => '$' + Math.round(n).toLocaleString('en-US'), shop: { lv: shopLv, spent: 0 }, earn: noop, money: 0, on: noop, saleBanner: () => '', shopPrice: p => p, priceTag: p => p, spend: () => false, setShop: noop },
        Line: { loggedIn: false },
        SaveImg: { inApp: false, save: noop, canShare: () => false },
        CONFIG: {},
    };
    ctx.window = ctx;
    ctx.globalThis = ctx;
    return vm.createContext(ctx);
}

// 把遊戲裡要用的東西拿出來（top-level 的 let／const 外面看不到，所以在後面補一段）
const EXPORT = `
;globalThis.__api = {
    get G() { return G; }, newRound, update, addFood, tapGrill, swipeGrill, pourStart, pourStop, tapWarm, deliver, trashWarm, need, doneness, burnAt,
    MENU, ROUND, CUP_MAX, HALF,
    warmN: () => WARM_N,
    lv: typeof lv === 'function' ? lv : () => 0,
    auto: () => typeof lv === 'function' ? lv('gauge') >= 2 : (typeof AUTO_POUR !== 'undefined' && AUTO_POUR),
    base: () => typeof baseEarn === 'function' ? baseEarn() : sumEarn(),
    total: () => sumEarn(),
    bill,
};`;

function runRound(api, ctx, step) {
    api.newRound();
    const DT = 1 / 60;
    let t = 0, nextAct = 0, holding = false;
    const G = () => api.G;
    // 這一刻還缺什麼：客人點了、還沒送到，也還沒在保溫台／煎台／杯子裡的
    function demand() {
        const g = G(), want = [];
        g.custs.forEach((cu, i) => { if (cu && cu.state === 'wait') cu.items.forEach(o => { if (!o.done) want.push({ key: o.key, v: o.v, i, left: cu.left }); }); });
        const have = g.warm.map(w => ({ key: w.key, v: w.v }))
            .concat(g.grill.filter(x => x && !x.burnt).map(x => ({ key: x.key, v: x.v || null, grill: true })))
            .concat(g.cup.key && (g.cup.fill > 0 || g.cup.ready || g.cup.pour) ? [{ key: g.cup.key }] : []);
        const left = want.slice().sort((a, b) => a.left - b.left);
        const out = [];
        for (const w of left) {
            const k = have.findIndex(h => h.key === w.key && (!w.v || !h.v || h.v === w.v));
            if (k >= 0) { const h = have.splice(k, 1)[0]; if (h.grill && w.v) { /* 煎台上的蛋：記下要哪一種 */ } } else out.push(w);
        }
        return out;
    }
    // 煎台上的蛋要做成半熟還是全熟：看現在缺的
    function eggTarget() {
        const g = G();
        const want = [];
        g.custs.forEach(cu => { if (cu && cu.state === 'wait') cu.items.forEach(o => { if (!o.done && o.key === 'egg') want.push(o.v); }); });
        g.warm.forEach(w => { if (w.key === 'egg') { const k = want.indexOf(w.v); if (k >= 0) want.splice(k, 1); } });
        return want;
    }
    function act() {
        const g = G(), M = api.MENU;
        // 1. 焦的丟掉
        let i = g.grill.findIndex(x => x && x.burnt);
        if (i >= 0) { api.tapGrill(i); return true; }
        // 2. 保溫台上有人要的：送給等最久（剩最少）的
        let best = null;
        g.warm.forEach((w, j) => g.custs.forEach((cu, ci) => { if (cu && cu.state === 'wait' && api.need(cu, w) >= 0 && (!best || cu.left < best.left)) best = { j, ci, left: cu.left }; }));
        if (best) { api.deliver(best.j, best.ci); return true; }
        // 3. 煎台：該翻的翻、該夾的夾（最快焦的先）
        const eggs = eggTarget();
        let cand = null;
        g.grill.forEach((x, k) => {
            if (!x || x.burnt) return;
            const m = M[x.key], d = api.doneness(x);
            let ok = false;
            if (x.side === 1 && m.flip) ok = d >= 1;
            else if (x.key === 'egg') {
                const wantHalf = eggs.includes('half'), wantFull = eggs.includes('full');
                ok = (d >= api.HALF && d < 1 && wantHalf) || d >= 1 && (wantFull || !wantHalf) || d >= 1;
                if (d >= api.HALF && d < 1 && !wantHalf) ok = false;
            } else ok = d >= 1;
            if (ok && g.warm.length >= api.warmN() && !(x.side === 1 && m.flip)) ok = false;
            if (ok && (!cand || d > cand.d)) cand = { k, d, x };
        });
        if (cand) {
            const x = cand.x;
            if (x.key === 'roll' && x.side === 2) api.swipeGrill(cand.k, 60, 4, 0.2);   // 300 px/s，直直滑
            else api.tapGrill(cand.k);
            if (x.key === 'egg' && x.side === 2) { const v = api.doneness(x) < 1 ? 'half' : 'full'; const e = eggs.indexOf(v); if (e >= 0) eggs.splice(e, 1); }
            return true;
        }
        // 4. 缺的東西：飲料先倒（杯子空著才倒），食物放上煎台
        const need = demand();
        const drink = need.find(w => M[w.key].drink);
        const c = g.cup;
        if (drink && !c.key && !c.ready && !c.pour) {
            if (api.pourStart(drink.key)) { if (!api.auto()) holding = true; return true; }
        }
        const food = need.find(w => !M[w.key].drink);
        if (food && g.grill.some(x => !x)) { api.addFood(food.key); return true; }
        // 5. 保溫台滿了而且有沒人要的：丟掉
        if (g.warm.length >= api.warmN()) {
            const j = g.warm.findIndex(w => !g.custs.some(cu => cu && cu.state === 'wait' && api.need(cu, w) >= 0));
            if (j >= 0) { api.trashWarm(j); return true; }
        }
        return false;
    }
    while (!G().ended && t < 200) {
        if (holding) {
            // 按住倒：倒到 0.9 左右放開（按住的時候不能做別的）
            if (G().cup.fill >= 0.9 || !G().cup.pour) { api.pourStop(); holding = false; nextAct = t + step; }
        } else if (t >= nextAct) {
            if (act()) nextAct = t + step; else nextAct = t + 1 / 30;
        }
        t += DT; ctx.__now += DT * 1000;
        api.update(DT);
    }
    const g = G();
    // 驗收：明細每一列加起來一定要等於合計
    const billSum = api.bill().reduce((a, r) => a + r[3], 0);
    if (billSum !== api.total()) throw new Error(`明細加總 ${billSum} 不等於合計 ${api.total()}`);
    return { base: api.base(), total: api.total(), served: g.tally.served, angry: g.tally.angry };
}

const ctx = makeContext();
vm.runInContext(code + EXPORT, ctx, { filename: path.basename(file) });
const api = ctx.__api;
console.log(`檔案：${path.relative(process.cwd(), file)}　每種手速 ${N} 場${process.env.SHOP ? '　升級：' + process.env.SHOP : ''}`);
for (const s of SPEEDS) {
    let base = 0, total = 0, served = 0, angry = 0;
    for (let k = 0; k < N; k++) { const r = runRound(api, ctx, s); base += r.base; total += r.total; served += r.served; angry += r.angry; }
    console.log(`每 ${s} 秒一個動作：平均 ${Math.round(base / N)}（加碼前）／${Math.round(total / N)}（合計）　出餐 ${(served / N).toFixed(1)} 位　氣走 ${(angry / N).toFixed(1)} 位`);
}
