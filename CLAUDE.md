# 本仓库规范
- 统一规范见 `AGENTS.md`。
- 修改 `scripts/` 下的 userscript 文件时，必须同步更新该文件头部 `@version` 字段。
- review 默认先写 findings，再写 notes 或 summary。
- 最低验证门槛是对改动过的 userscript 跑 `node --check <file>`。
- 改到定时器、重试、缓存、visibility、serverTime、symbol 切换、最小下单量、Binance API 参数时，先按 `AGENTS.md` 的 `Plan Gate` 写 5 行计划。
- 改 Binance API 相关逻辑时，只信官方文档和现网响应，不根据页面偶然行为猜语义。
- 涉及交易规则时，只按当前 `symbol` 的确定性规则数据计算，不要用旧 DOM 状态或无 symbol 语义的值去猜。
- 如果改动触及 Binance 调度或下单规则，最终说明里要明确哪些路径已手测，哪些没有。
