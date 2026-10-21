# 发版检查清单（design/116）

> 2026-10-18 建档。发版人按顺序勾，不再靠记忆。
> 背景：今天有 4 次发布被「测试卫生 / 环境噪声」挡住——不是产品红，是流程缺清单。

## 0. 前置（工作区干净）

- [ ] `git status` 无未提交的 `game/src`、`game/data`、`server/public`、`tools/*-check.js` 改动
- [ ] 项目内 `.livetest/` **不存在或为空**（测试临时目录已迁到 `os.tmpdir()/wuxia-tests/`；残留会触发打包 EPERM）
- [ ] `tools/_out_*` 台账产物未混进本次提交（.gitignore 已忽略）

## 1. 功能全量

```sh
sh .reg_full.sh
```
- [ ] `FAIL=0`，记下 `PASS` 数
- [ ] 确认输出里 **没有** `tools/perf-step-check.js` 的延迟红（套件内 perf 只判体积门 `--suite`）

## 2. 性能（发布前单独跑，不在套件里）

```sh
node tools/perf-step-check.js
```
- [ ] 三档行为正确：
  - `k < 1.3` → 正常判（B1 有 ✔/✘）
  - `1.3 ≤ k ≤ 2.0` → 「负载偏高·B1 未判」，零 ✔
  - `k > 2.0` → 「环境过载·B1 未判」
- [ ] `kCpu / kIo` 两个读数都打出来了（谁抬起来的可追溯）
- [ ] **安静窗口** 下 B1 必须真 12/0（这条是人工口径，自动注入只验行为）

### 2.1 三档离线钉档（复制即跑，2026-10-18 实测）

基线值：`calibration.ms = 9.31`、`calibration.ioMs = 19.58`
（换机器/重标后先跑 `node tools/perf-step-check.js --calib` 读 `refMs/refIoMs`，
再把下面前两个环境变量换成对应基线值；`kIo = PERF_IO_FORCE_MS / refIoMs`。）

```sh
# ① 正常档（k=1.00）：应当 13/0，B1 有 ✔
PERF_CALIB_FORCE_MS=9.31 PERF_IO_FORCE_MS=19.58 node tools/perf-step-check.js 90

# ② 偏宽·未判（k≈1.53）：B1 不判、零 ✔，汇总 8/0
PERF_CALIB_FORCE_MS=9.31 PERF_IO_FORCE_MS=30 node tools/perf-step-check.js 90

# ③ 过载·未判（k≈2.15）：B1 不判、零 ✔，汇总 8/0
PERF_CALIB_FORCE_MS=20 PERF_IO_FORCE_MS=19.58 node tools/perf-step-check.js 90
```

判定看三行：`环境标定 k=…`、`B1 单步延迟 — … 未判`、`汇总 通过 N · 失败 M`。
②③ 只要出现任何 `✔ B1` 就是回归；① 若在忙窗口出 ✘，换安静窗口重跑一次（不算回归）。

## 3. 量具自检（安静窗口）

```sh
node tools/_perf_accept.js
```
- [ ] 四条注入断言全过
- [ ] A1 在安静窗口应看到 B1 真全过（12/0）；忙窗口允许出 ✘（门在正确工作）

## 4. 文案与名词

```sh
node tools/lore-noun-check.js --strict
node tools/copy-promise-check.js
node tools/ai-flavor-check.js
```
- [ ] 三条全绿（承诺句里的解法必须真存在/真生效；名词待归零以 `--strict` 为准）

## 5. 线上核对

- [ ] `game/src/renderer/index.html` 的 `?v=` 已 bump，且 `server/public/` 双副本一致（`node tools/mirror-sync.js` 无输出/已同步）
- [ ] 部署后首页能起、控制台无 404（重点看 `ui.js` / `main.css` 的 `?v=`）
- [ ] 抽一条战斗：进战斗 → 面板有按钮 → 点「防御」→ 回合前进

## 6. 记录

- [ ] 把本次 commit hash、`PASS` 数、perf 三读数（kCpu/kIo/k 与 p50/p95）贴进发布记录

## 7. 套件耗时判读（2026-10-18 增，qa 口径）

接近/超过 120s 的套件**按缺陷处理**，不要调 default 超时（会把真红藏进超时里）。

- [ ] **只有一套暴涨、同轮别的套件正常** → 大概率结构性成本（新增了 `boot()×N` / 重活×N），去看代码与注释；
- [ ] **多套同比例变慢**（如都 3–6×） → 宿主负载（对照：`perf-step-check` 安静 ~11s、负载 74s）；
- [ ] 参考已拆的两颗雷：`smoke-auction` 400×boot（166s→复用 world 8s）、`smoke-b9-intro` 24×boot（90s→复用 engine 5s）。

