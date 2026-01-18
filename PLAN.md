# ShareDB TypeScript 教学项目实现计划

## 目标

创建一个简化但完整的 TypeScript 实现，帮助学习者理解 OT（Operational
Transformation）和实时协作的核心原理。

## ShareDB 核心技术要点总结

### 1. 数据结构

**Snapshot（快照）**：
```typescript
{ id: string, v: number, type: string | null, data: any, m?: metadata }
```

**Operation（操作）**三种类型：
- `create`: `{ create: { type: string, data?: any }, v?, src?, seq? }`
- `op` (编辑): `{ op: any, v?, src?, seq? }`
- `del` (删除): `{ del: true, v?, src?, seq? }`

### 2. OT 核心函数（lib/ot.js）

- `checkOp(op)` - 验证操作格式
- `apply(snapshot, op)` - 应用操作到快照，就地修改，版本号 +1
- `transform(type, op, appliedOp)` - 冲突转换，关键：`op.op = type.transform(op.op,
appliedOp.op, 'left')`

### 3. 类型系统

每个 OT 类型必须实现：
- `create(data)` - 创建初始快照
- `apply(snapshot, op)` - 应用操作
- `transform(op, appliedOp, side)` - 转换操作

最简单的实现（number-type）：加法可交换，transform 返回原操作不变。

### 4. 客户端同步机制（lib/client/doc.js）

- `inflightOp` - 正在等待确认的操作（一次只有一个）
- `pendingOps` - 待发送队列
- 收到远程操作时，对 inflightOp 和 pendingOps 进行 transform

---

## 项目结构

```
sharedb-tutorial/
├── src/
│   ├── core/
│   │   ├── types.ts          # OTType 接口和 TypeRegistry
│   │   ├── ot.ts             # checkOp, apply, transform
│   │   ├── snapshot.ts       # Snapshot 接口
│   │   └── error.ts          # OTError 类
│   ├── types/
│   │   ├── counter.ts        # 计数器类型（最简单，入门）
│   │   └── text.ts           # 简单文本类型（展示真正的 OT 转换）
│   ├── client/
│   │   ├── doc.ts            # 文档类（状态机、inflightOp、pendingOps）
│   │   └── connection.ts     # 连接管理、消息协议
│   ├── server/
│   │   ├── backend.ts        # 服务端核心
│   │   ├── submit-request.ts # 提交处理、版本检查、OT 转换
│   │   └── memory-db.ts      # 内存数据库
│   └── index.ts
├── tests/
│   ├── ot.test.ts            # OT 核心函数测试
│   ├── types/
│   │   ├── counter.test.ts
│   │   └── text.test.ts
│   └── integration/
│       └── sync.test.ts      # 端到端同步测试
├── examples/
│   ├── counter-app/          # 协作计数器演示
│   └── text-editor/          # 简单文本编辑演示
├── package.json
├── tsconfig.json
└── README.md
```

---

## 实现步骤

### 第一阶段：核心模块

1. **创建项目结构**
- 初始化 npm 项目，配置 TypeScript
- 安装依赖：typescript, vitest

2. **实现 `src/core/types.ts`**
- `OTType<TSnapshot, TOp>` 接口
- `TypeRegistry` 类

3. **实现 `src/core/snapshot.ts`**
- `Snapshot<T>` 接口
- `createSnapshot()` 工厂函数

4. **实现 `src/core/error.ts`**
- `OTError` 类
- 错误码常量

5. **实现 `src/core/ot.ts`**
- `checkOp(op)` - 参考 lib/ot.js:13-52
- `apply(snapshot, op, types)` - 参考 lib/ot.js:61-102
- `transform(type, op, appliedOp, types)` - 参考 lib/ot.js:132-167

### 第二阶段：OT 类型

6. **实现 `src/types/counter.ts`**
- 最简单的类型，加法可交换
- 参考 test/client/number-type.js

7. **实现 `src/types/text.ts`**
- 展示真正的 OT 转换逻辑
- 单操作插入/删除，transform 需要调整位置

### 第三阶段：客户端

8. **实现 `src/client/connection.ts`**
- 消息类型定义（hs, s, op, f）
- WebSocket 绑定
- 消息收发

9. **实现 `src/client/doc.ts`**
- inflightOp / pendingOps 状态机
- `_submit()` - 本地应用 + 加入队列
- `_flush()` - 发送下一个操作
- `_handleOpAck()` - 处理确认
- `_handleRemoteOp()` - 处理远程操作，执行 transform

### 第四阶段：服务端

10. **实现 `src/server/memory-db.ts`**
- 快照存储
- 操作日志存储
- `getSnapshot()`, `getOps()`, `commit()`

11. **实现 `src/server/submit-request.ts`**
- 版本检查
- 获取中间操作并 transform
- 应用操作
- 乐观锁重试

12. **实现 `src/server/backend.ts`**
- Agent 管理
- 消息路由
- 操作广播

### 第五阶段：测试和示例

13. **编写测试**
- OT 核心函数测试
- 类型测试
- 集成测试：两个客户端并发操作收敛

14. **创建示例应用**
- counter-app：最简演示
- text-editor：展示位置转换

---

## 关键参考文件

| 模块 | ShareDB 参考文件 |
|------|-----------------|
| OT 核心 | `lib/ot.js` (checkOp, apply, transform) |
| Snapshot | `lib/snapshot.js` |
| 类型系统 | `lib/types.js`, `test/client/number-type.js` |
| 客户端 Doc | `lib/client/doc.js` (inflightOp, pendingOps, _handleOp) |
| 提交处理 | `lib/submit-request.js` (_transformOp, apply) |
| 消息协议 | `lib/message-actions.js` |

---

## 验证方法

1. **单元测试**
```bash
npm test
```

2. **类型测试**
- counter: 并发 +5 和 +3，结果应为 8
- text: 并发插入位置应正确调整

3. **集成测试**
- 两个模拟客户端并发操作
- 验证最终状态一致

4. **示例运行**
```bash
npx ts-node examples/counter-app/index.ts
```

---

## 教学重点

1. **计数器类型**：最简单的 OT，加法可交换，transform 不变
2. **文本类型**：展示位置调整的 transform 逻辑
3. **客户端状态机**：inflightOp 单线程流控
4. **服务端版本检查**：op.v vs snapshot.v，不匹配则 transform
5. **最终一致性**：并发操作通过 OT 保证收敛

---

## 预计产出

- 完整可运行的 TypeScript 项目
- 清晰的代码注释，指向 ShareDB 原始实现
- 测试覆盖核心场景
- 可交互的示例应用


If you need specific details from before exiting plan mode (like exact code snippets, error
messages, or content you generated), read the full transcript at: /Users/tianyang/.claude/pr
ojects/-Users-tianyang-Code-sharedb/b0442a40-00c7-4823-aaad-1a09b4fcea5c.json
