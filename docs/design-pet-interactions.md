# 桌宠行为交互设计（P1 实现依据）

> 目标：在现有 P0 骨架（core 状态机 + 数值系统 + Live2D 渲染层）之上，落地丰富的行为交互。
> 范围：逗猫棒（鼠标追逐/扑击）、喂食、抚摸、待机行为链、数值联动。
> 原则：**输入事件 → core 状态机/数值 reducer → 动画指令流 → Live2D 播放**单向数据流；
> core 保持纯逻辑零平台依赖，可单测；所有参数集中可调（§11）。

---

## 1. 交互数据流（总览）

```
用户输入（鼠标/拖拽/点击/投喂/定时 tick）
   │
   ▼
core 层（纯 TS）
   ├─ PetStateMachine.transition(...)   状态机：优先级仲裁 + 冷却
   └─ reducePetInput(...)               数值 reducer：mood/satiety/affection/energy
   │
   ▼
动画指令流 { action, params, oneShot|loop, duration }
   │
   ▼
渲染层（Live2D）
   ├─ 播放动作（pixi-live2d-display）
   ├─ 朝向翻转（scaleX）、位移插值
   └─ 反馈：气泡 / 音效 / 粒子
```

关键约定：
- 渲染层**只消费指令流**，不直接读数值；
- 状态机与数值都持在主进程（或 core 单例），变更经 IPC/事件推给渲染层；
- 动画指令与状态解耦：一个状态可映射多个动作（如 idle → idle/yawn/groom）。

---

## 2. 状态机扩展

现有 7 态：`idle / walk / chase / sleep / drag / interact / click-through`
扩展为 11 态：

| 状态 | 含义 | 进入条件示例 |
|---|---|---|
| `idle` | 待机 | 默认；动作结束后回退 |
| `walk` | 行走 | 被动位移（拖拽之外的程序移动） |
| `watch` | 注视（逗猫棒） | 光标进入兴趣半径 R_watch 且静止 |
| `chase` | 追逐（逗猫棒） | 光标快速移动/接近 |
| `pounce` | 扑击 | chase 中光标静止或反向（蓄力→扑） |
| `sleep` | 睡觉 | 无操作计时器到期 |
| `drag` | 被拖拽 | 用户 mousedown + 位移 |
| `being-petted` | 被抚摸 | 点击（非拖拽）命中部位 |
| `eat` | 进食 | 投喂（drop/菜单） |
| `interact` | 通用互动反馈 | 连击/其他一次性反馈 |
| `click-through` | 点击穿透 | 鼠标移出窗口 |

### 优先级表（数值越大越抢占；转换需目标优先级 ≥ 当前，除非 force）

| 状态 | 优先级 | 冷却（ms） |
|---|---|---|
| `click-through` | 0 | 0 |
| `idle` | 10 | 0 |
| `watch` | 20 | 400（防注视/待机抖动） |
| `walk` | 30 | 0 |
| `sleep` | 40 | 0 |
| `eat` | 50 | 3000（进食冷却） |
| `being-petted` | 55 | 1200 |
| `interact` | 60 | 800 |
| `chase` | 70 | 0 |
| `pounce` | 75 | 1500 |
| `drag` | 100 | 0 |

> 注：`sleep` 优先级低于 eat/being-petted，可被唤醒动作打断；`drag` 最高，任何动画不打断用户拖拽。

---

## 3. 逗猫棒交互（鼠标追逐 + 扑击）

### 3.1 参数

| 参数 | 默认值 | 说明 |
|---|---|---|
| `R_watch` 兴趣半径 | 260 px | 光标进入 → watch（眼睛跟随） |
| `R_chase` 追逐半径 | 120 px | 光标距桌宠 < 此值且移动 → chase |
| `v_chase` 光标速度阈值 | 60 px/s | 超过才触发追逐（防静止误触） |
| `chase_speed` 桌宠移动速度 | 180 px/s | 向光标插值移动 |
| `pounce_delay` 扑击蓄力 | 300 ms | 蓄力动作后扑向落点 |
| `pounce_range` 扑击命中 | 80 px | 落点距光标 ≤ 此值算命中 |
| `pounce_cooldown` | 1500 ms | 扑击冷却 |
| `energy_cost` 扑击精力消耗 | 8 | 每次扑击扣 energy |

### 3.2 状态机规则

```
鼠标位置轮询（主进程 screen.getCursorScreenPoint，60Hz）
  ├─ 光标距桌宠中心 > R_watch            → 不干预（保持 idle/walk）
  ├─ R_chase < 距离 ≤ R_watch：
  │    光标速度 > v_chase → chase（追向光标）
  │    光标静止           → watch（注视，眼睛跟随）
  ├─ 距离 ≤ R_chase：
  │    光标移动           → chase
  │    光标静止 ≥ 300ms   → pounce（蓄力 → 扑向光标）
  └─ pounce 结束：若命中（≤ pounce_range）→ 兴奋反馈 + mood+6，否则轻微 -affection
```

### 3.3 心情/精力联动

- pounce 命中：`mood +6, energy -8`（复用 reducer 的 play-game 思路，新增 pounce 事件）
- 连续 3 次未命中：`affection -2`，且 pounce 冷却 ×1.5（情绪低落）
- `energy < 20`：不再触发 chase/pounce（改为 watch），并更快入睡

### 3.4 开关与防干扰

- 设置项「逗猫棒模式」：关闭时只保留 watch（眼神跟随），不 chase/pounce；
- 扑击冷却 + 距离下限（R_chase_min=60px）防止光标贴近时鬼畜抖动；
- 全屏其他 app 使用时（桌宠被遮挡）不轮询（省电）。

---

## 4. 喂食交互

### 4.1 触发方式

| 方式 | 实现 |
|---|---|
| 拖拽食物到桌宠 | 渲染层 dragover/drop 拿文件路径；内置「食物」：图片/常见食物文件，或从托盘/面板拖出食物图标 |
| 右键菜单「投喂」 | 弹内置食物列表（鱼、罐头、饼干、牛奶…） |
| 拖拽任意文件 | 视为"随便喂点"，数值收益减半 |

### 4.2 规则

```
投喂进入 eat 态（优先级 50）
  ├─ 播放进食动画（loop，~3s）
  ├─ 数值：satiety +15, mood +8, affection +3, energy +5（食物表可配）
  ├─ 反馈：气泡「好吃！」+ 音效 + 心情表情
  ├─ 饱和限制：satiety ≥ 95 → 拒绝（气泡「吃不下了」），不进入 eat
  └─ eat 冷却 3000ms；拖拽悬停 500ms 即触发（无需 drop）
```

### 4.3 食物表（可配置，随素材包扩展）

| 食物 | satiety | mood | affection | 备注 |
|---|---|---|---|---|
| 鱼 | +18 | +10 | +4 | 最爱 |
| 罐头 | +14 | +8 | +3 | |
| 饼干 | +10 | +5 | +2 | |
| 牛奶 | +8 | +6 | +3 | |
| 随机文件 | +7 | +3 | +1 | 减半收益 |

### 4.4 心情联动

- 喂食后 30s 内 mood 衰减暂停（饱足感）；
- `satiety < 20`：头顶冒「饿」气泡 + 主动靠近鼠标（求投喂）；
- `satiety < 10`：生气表情（moodOf 已实现：饥饿优先触发 angry）。

---

## 5. 抚摸 / 摸头

### 5.1 触发与部位判定

```
mousedown（非拖拽：位移 ≤ 4px 记为点击）
  ├─ Live2D HitArea 命中 head → being-petted(head)
  ├─ Live2D HitArea 命中 body → being-petted(body)
  └─ 未命中形象（透明区）→ 不响应（穿透语义）
```

### 5.2 数值与反馈

| 部位 | affection | mood | 反馈 |
|---|---|---|---|
| head | +6 | +5 | 眯眼舒服表情 + 呼噜音效 + 心形粒子 |
| body | +3 | +2 | 蹭手动作 + 心形粒子 |

- 冷却：`being-petted` 状态 1200ms；
- **连击衰减**：同一部位 3s 内重复抚摸收益 ×0.5，×0.25，之后归零（防刷）；间隔 5s 重置；
- 与拖拽互斥：位移 > 4px 立即转 `drag`，取消抚摸判定。

---

## 6. 待机行为链（自动行为）

### 6.1 计时规则

| 无操作时长 | 行为 |
|---|---|
| 0–30s | idle 待机（随机眨眼/呼吸） |
| 30–90s | 待机链：随机播「理毛 / 打哈欠 / 伸懒腰」 |
| > 90s | sleep（蜷缩睡觉，长循环） |
| 任意时刻 | 鼠标移动 / 点击 / 投喂 → 惊起（wake → idle 或按规则转 chase） |

### 6.2 心情对行为参数的影响（统一在 reducer 输出侧换算）

| 数值条件 | 行为参数调整 |
|---|---|
| mood < 30 | 打哈欠频率 ×2；走路速度 ×0.8；不主动 chase |
| mood ≥ 75 | 待机插入 happy 动作（蹦跳）；走路速度 ×1.2 |
| energy < 20 | 入睡计时缩短（90s → 45s）；扑击冷却 ×1.5 |
| satiety < 20 | 每 20s 冒「饿」气泡一次 |

### 6.3 惊起逻辑

- sleep 中鼠标移入兴趣半径或点击 → `wake` 一次性动作 → `idle`；
- 惊起有 500ms 无冷却窗口，防止"刚醒又睡"。

---

## 7. 动画资产映射表（Live2D 动作清单）

| 动作 key | 触发状态/事件 | 类型 | 说明 |
|---|---|---|---|
| `idle` | idle | loop | 基础待机 |
| `idle_yawn` | 待机链随机 | once | 打哈欠 |
| `idle_groom` | 待机链随机 | once | 理毛 |
| `idle_stretch` | 待机链随机 | once | 伸懒腰 |
| `happy` | mood ≥ 75 待机插入 | once | 开心蹦跳 |
| `sad` | mood < 30 待机插入 | loop | 低落低头 |
| `sleep` | sleep | loop | 蜷缩睡觉 |
| `wake` | 惊起 | once | 惊醒动作 |
| `walk` | walk | loop | 行走（scaleX 翻转朝向） |
| `watch` | watch | once | 注视蓄力 |
| `chase` | chase | loop | 追赶 |
| `pounce` | pounce | once | 扑击（含蓄力-扑） |
| `eat` | eat | loop 3s | 进食 |
| `pet_head` | being-petted(head) | once | 摸头舒服 |
| `pet_body` | being-petted(body) | once | 摸身舒服 |
| `angry` | satiety<10 / 被连续打扰 | loop 短 | 生气 |

> 动作 key 与素材包约定一致；Live2D 模型缺少某动作时渲染层静默回退 `idle`。

---

## 8. 事件 → reducer → 指令映射（core 侧实现点）

| 输入事件 | 状态机转换 | 数值 reducer | 输出指令 |
|---|---|---|---|
| 点击（命中 head） | → being-petted | affection+6, mood+5 | `pet_head` |
| 点击（命中 body） | → being-petted | affection+3, mood+2 | `pet_body` |
| 投喂食物 | → eat | satiety+15, mood+8, affection+3, energy+5 | `eat` + 气泡 |
| 光标快速移动 | → chase | — | `chase` |
| 光标静止（近距离） | → pounce | energy-8；命中 mood+6 | `pounce` |
| 无操作 90s | → sleep | — | `sleep` |
| 鼠标移动/点击（sleep） | → idle | — | `wake` |
| 定时 tick（60s） | — | 衰减 mood/satiety/energy | 心情气泡（按需） |

> core 新增 reducer 事件：`{ kind: 'pounce', hit: boolean }`、`{ kind: 'feed', food: FoodId }`（替代默认 feed），其余复用现有 `pet-stats.ts`。

---

## 9. 新增/修改的 core 接口

```ts
// pet-state-machine.ts：扩展状态
type PetState = 'idle' | 'walk' | 'watch' | 'chase' | 'pounce' | 'sleep'
  | 'drag' | 'being-petted' | 'eat' | 'interact' | 'click-through';

// 新增配置化选项（构造时注入，便于按素材包/心情调参）
interface PetBehaviorConfig {
  rWatch: number; rChase: number; vChase: number;
  pounceDelay: number; pounceRange: number; pounceCooldown: number;
  idleChainAfterMs: number; sleepAfterMs: number;
  foodTable: Record<FoodId, StatDelta>;
}

// pet-stats.ts：新增事件
type PetActionInput = ... | { kind: 'pounce'; hit: boolean } | { kind: 'feed'; food: FoodId };
```

---

## 10. P1 实现清单（优先级排序）

**MVP（先做，覆盖用户点名的三类交互）**
1. 状态机扩展（11 态 + 优先级/冷却表）—— core 单测覆盖
2. 逗猫棒：watch/chase/pounce + 开关 + 扑击冷却
3. 抚摸：HitArea 部位判定 + 数值 + 连击衰减
4. 喂食：拖拽/菜单触发 + 食物表 + 饱和限制
5. 待机链：理毛/打哈欠/伸懒腰/睡觉/惊起
6. 心情联动：走路速度 + 待机动作频率 + 扑击意愿

**进阶（P2+）**
7. 洗澡/清洁、迷你小游戏（接金币）、抓窗口/爬墙、多只同屏
8. 心情联动 AI 语气（function calling 传入心情状态）
9. 行为参数按素材包/设置页可视化调参

---

## 11. 参数表汇总（调参入口）

| 参数 | 默认 | 归属 |
|---|---|---|
| R_watch / R_chase / v_chase | 260 / 120 px / 60 px·s⁻¹ | 逗猫棒 |
| chase_speed | 180 px/s | 逗猫棒 |
| pounce_delay / pounce_range / cooldown | 300 ms / 80 px / 1500 ms | 逗猫棒 |
| 抚摸连击衰减 | 3s 内 ×0.5 → ×0.25 → 0 | 抚摸 |
| being-petted 冷却 | 1200 ms | 抚摸 |
| eat 冷却 / 拖拽悬停 | 3000 ms / 500 ms | 喂食 |
| 饱和阈值 / 饥饿提示 | satiety 95 / 20 | 喂食 |
| 待机链起始 / 入睡 | 30 s / 90 s | 待机链 |
| 心情阈值 | 30（低落）/ 75（开心） | 联动 |
| 扑击精力消耗 | 8 | 联动 |

---

*本设计直接对应 P1 实现；所有参数集中在 `PetBehaviorConfig`，默认值如上，后续可做设置页/素材包覆盖。*
