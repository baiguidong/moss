# AI 玩具项目方案(草案 · 持续完善)

> 最后更新:2026-07-02。本文件是产品级总方案,后续边验证边补充。

## 一、产品定位

- **市场**:国内为主(需生成式 AI 服务备案)
- **人群**:儿童陪伴(内容安全要求最高,需家长端管控)
- **价格**:高端,¥300+(硬件/模型预算充足,可上最好的实时语音方案)
- **竞争力核心**:超低延迟自然对话 + 可爱有情感的独家音色 + 强内容安全 + 家长端管控 + 长期记忆

## 二、技术选型(全部国内合规)

AI 玩具本质是 `ASR → LLM → TTS`,或用**端到端实时语音大模型**一步到位。本项目主打后者。

- **主链路(护城河):端到端实时语音大模型**
  - 首选:火山引擎豆包·端到端实时语音大模型(成熟、情感自然、字节自研玩具已验证)
  - 备选:MiniMax
- **兜底/成本优化链路**:ASR(豆包/讯飞流式)+ LLM(豆包 lite 扛日常、DeepSeek 做知识问答,按复杂度路由)+ TTS(豆包/MiniMax)
- **TTS 差异化**:做 1–2 个**独家 IP 音色(音色克隆)**,而非通用音色——竞品都能调同一个 API,音色和人设是能垄断的部分
- **内容安全(生死线)**:厂商自带审核 + 自建敏感词/意图过滤,防诱导、暴力、成人话题;做不好会被下架
- **记忆能力**:记住孩子名字/喜好/历史对话——留存与复购关键,当前市场普遍做得差

## 三、硬件方案(¥300+ 档)

- **主控**:ESP32-S3(联网+采集+播放);要屏幕/更强本地能力可上 ESP32-P4+S3 或 RK 系列
- **音频**:降噪麦阵列(ES7210)+ 功放(ES8311/MAX98357A)+ 小喇叭,远场拾音重要(孩子不会贴着说)
- **离线唤醒**:ESP-SR 做唤醒词("你好小X")
- **交互**:圆形屏(GC9A01)做表情 或 LED + 可选舵机做动作,提升"活物感"
- **电源**:锂电池 + Type-C 快充,续航是家长关注点

## 四、后端架构(核心资产都在这)

```
玩具(ESP32-S3)
   │ WiFi (WebSocket 音频流)
   ▼
中间层服务(核心资产,换硬件不用改)
   ├─ 端到端实时语音大模型(豆包)  ← 主对话
   ├─ 记忆系统(孩子名字/喜好/历史)
   ├─ 人设/角色引擎(prompt 编排)
   ├─ 内容安全层
   ├─ 家长端管控(App:对话记录、时长、主题)
   └─ 计费/用量统计
```

ESP32 只做采集+播放+网络,AI 逻辑全在中间层,换模型/加记忆/审核都灵活。

## 五、合作模式(与玩具厂合伙)

- 能力互补:玩具厂强在外观/模具/供应链/量产/3C 认证/线下渠道;你强在 AI/软件/后端/模型选型
- 推荐模式:**合资/分成 + 你主导 AI 和数据**
- 必须握在自己手里的三样:**后端服务、用户/订阅关系、独家音色 IP**
- 谈判要点:核心资产归属、订阅收入分配、数据归属与合规责任、独家/排他、退出机制
- 打法:先用能实际对话的 MVP 样机去谈,比 PPT 有说服力 10 倍

## 六、合规(国内必做)

1. 生成式 AI 服务备案(面向 C 端必须)
2. 玩具 3C 认证(实体产品强制)
3. 儿童个人信息保护(录音属敏感数据:告知 + 家长同意 + 加密存储)
4. 电池/材料安全

## 七、分阶段落地(降风险开发法)

先在 macOS 上把最不确定的"服务端对接外部 API"跑通,再花钱买硬件。

- **阶段 0(进行中):火山凭证连通性验证** ← 见下方详情
- **阶段 1:macOS 完整 Demo** — Node 服务端 + 浏览器客户端(麦克风采集→WS→豆包实时语音→返回音频→播放)。浏览器完美模拟玩具;**服务端将来接 ESP32 几乎不用改**
- **阶段 2:ESP32 样机** — 固件:连 WiFi → I2S 录音 → WebSocket 上传 → 收音频 → I2S 播放。用 ESP-BOX/ESP32-S3 AI 语音套件起步
- **阶段 3:产品化** — 记忆、家长 App、内容安全、独家音色、外观模具、合规认证

### 样机成本(阶段 0–2)

- 硬件:焊接方案 ~¥150/台;推荐 ESP-BOX 套件 2–3 台 ~¥600–1200
- AI/云:开发期靠各家免费额度,~¥0–200/月;服务端先跑本机
- 时间:1 人约 2–4 周出可流畅对话的样机

---

## 阶段 0 详情:火山豆包端到端实时语音 —— 连通性测试

### 目标
验证现有火山凭证能否连上豆包端到端实时语音大模型。连不上则后续全部白搭。

> 注意:先前提供的 `AKLT...` 是火山 IAM 的 **Access Key ID**(OpenAPI 签名用),**不是**本接口凭证。端到端实时语音用「语音技术」应用的 **APPID + Access Token**。

### 前置条件(火山控制台获取)
控制台 →「语音技术」→ 应用,确认已开通「端到端实时语音大模型」,取:
- **APPID** → 请求头 `X-Api-App-Key`
- **Access Token** → 请求头 `X-Api-Access-Key`
- Resource ID 固定 `volc.speech.dialog`

环境变量传入,勿硬编码:
```
export VOLC_APP_ID=你的APPID
export VOLC_ACCESS_TOKEN=你的AccessToken
```

### 接口关键参数(已从官方文档/demo 确认)
- WebSocket URL:`wss://openspeech.bytedance.com/api/v3/realtime/dialogue`
- 握手请求头:`X-Api-App-Key`(APPID)、`X-Api-Access-Key`(Token)、`X-Api-Resource-Id`(`volc.speech.dialog`)、`X-Api-Connect-Id`(随机 UUID)
- 二进制协议:4 字节 header + 可选字段(event / session_id 带长度前缀) + payload_size(4) + payload(JSON)
  - byte0=`0x11`,byte1=`(message_type<<4)|flags`(含 event 时带 0x04),byte2=`0x10`(JSON 无压缩),byte3=`0x00`
- 事件顺序:`StartConnection` → 服务端 `ConnectionStarted` → `StartSession` → 服务端 `SessionStarted`
- 本阶段先不发真实音频(收到 `SessionStarted` 即证明凭证可用)

### 已实现文件
- `voice-demo/volc-protocol.mjs` — 二进制帧编解码(`buildEventFrame` / `parseFrame`),参考 `src/services/voiceStreamSTT.ts`
- `voice-demo/test-volc-realtime.mjs` — 连通性测试主脚本(读环境变量凭证 → 连接 → StartConnection → StartSession → 判定,含 10s 超时)

### 验证方式
```
export VOLC_APP_ID=xxx
export VOLC_ACCESS_TOKEN=yyy
node voice-demo/test-volc-realtime.mjs
```
- ✅ 成功:握手 101 + `X-Tt-Logid` + `ConnectionStarted` + `SessionStarted` → "✅ 凭证可用"
- ❌ 失败:打印 401 鉴权失败 / 服务端错误码 / 未开通,据此定位

### 待办 / 完善方向
- [ ] 用户拿到正确 APPID + Access Token 后实测跑通
- [ ] 阶段 1:Node 服务端(复用 `src/server/server.ts` 的 `http.createServer` + `WebSocketServer({noServer:true})`)+ 浏览器客户端(参考 `ui/src/renderer-react/aimemo/RecordView.tsx`)
- [ ] 音频往返(真实录音 → 实时语音 → 播放)
- [ ] 人设 prompt、音色选型、记忆系统设计

### 参考文档
- 端到端实时语音大模型 API 接入:https://www.volcengine.com/docs/6561/1594356
- 语音技术鉴权方法:https://www.volcengine.com/docs/6561/1105162
