# Claude Code 2.1.88–2.1.310 changelog 梳理

生成时间：2026-10-27。基线是 Moss 初始提交 `3ea8f0bf` 中的 `@anthropic-ai/claude-code@2.1.88`；上游公开仓库的 `CHANGELOG.md` 提供 2.1.89–2.1.310，2.1.88 从 `v2.1.88` 标签补齐。完整逐条数据见同目录 CSV。来源：[`CHANGELOG.md` v2.1.310](https://github.com/anthropics/claude-code/blob/v2.1.310/CHANGELOG.md) 与 [`CHANGELOG.md` v2.1.88](https://github.com/anthropics/claude-code/blob/v2.1.88/CHANGELOG.md)。

## 统计口径

- 覆盖 **181 个实际发布号**，数字区间 88–310 共 223 个序号；未发布/无标签的序号：93, 95, 99, 100, 102, 103, 104, 106, 115, 124, 125, 127, 130, 134, 135, 146, 151, 155, 164, 171, 177, 180, 182, 184, 188, 189, 192, 194, 213, 230, 242, 244, 249, 253, 254, 255, 256, 262, 264, 279, 297, 298。
- 共 **6354 条 changelog 条目**，按文本去重后有 **6310 条**；重复主要来自 2.1.89 对 2.1.88 的回填以及少量重复发布说明。`kind` 是按条目首要语义动词归类：Fixed/Resolved→bugfix，Added/支持→feature，Improved/Updated→improvement，Changed/Removed/Deprecated→behavior/deprecation，其余为 other；一条同时含修复与行为变化时优先记 bugfix。
- `areas` 是关键词多标签，只用于聚类，不等同于代码模块；跨产品条目可能落入多个领域。
- 按条目前缀粗分：**核心 CLI/Agent 5,501 条**；VS Code 377、Claude Tag 208、Cloud sessions 69、Code Review 54、Claude Code on the web 53、Self-hosted runner 29、Remote Control 13、其他平台 50 条。Moss 重点应先看核心条目，再按其桌面/服务端形态选择宿主类条目。

## 按十版本窗口的总览

|版本窗口|实际发布数|条目数|Bug/回归|新功能|改进|行为/弃用|其他|主要主题|
|---|---:|---:|---:|---:|---:|---:|---:|---|
|2.1.88–2.1.97|8|218|139|28|24|7|20|git/files/tools、sessions/context/memory、terminal/ui/input|
|2.1.98–2.1.107|4|141|96|17|23|0|5|git/files/tools、sessions/context/memory、terminal/ui/input|
|2.1.108–2.1.117|9|186|101|21|14|9|41|sessions/context/memory、git/files/tools、terminal/ui/input|
|2.1.118–2.1.127|7|197|119|26|3|4|45|mcp/plugins/hooks/skills、git/files/tools、terminal/ui/input|
|2.1.128–2.1.137|7|164|128|15|6|1|14|terminal/ui/input、mcp/plugins/hooks/skills、sessions/context/memory|
|2.1.138–2.1.147|9|285|199|26|13|4|43|agents/background/workflows、sessions/context/memory、mcp/plugins/hooks/skills|
|2.1.148–2.1.157|8|175|108|20|3|9|35|sessions/context/memory、agents/background/workflows、terminal/ui/input|
|2.1.158–2.1.167|9|124|80|13|5|6|20|agents/background/workflows、sessions/context/memory、terminal/ui/input|
|2.1.168–2.1.177|8|101|69|12|5|3|12|sessions/context/memory、agents/background/workflows、models/api/providers|
|2.1.178–2.1.187|7|144|99|17|15|9|4|agents/background/workflows、sessions/context/memory、terminal/ui/input|
|2.1.188–2.1.197|6|76|44|15|14|2|1|sessions/context/memory、terminal/ui/input、agents/background/workflows|
|2.1.198–2.1.207|10|205|149|18|16|7|15|agents/background/workflows、sessions/context/memory、git/files/tools|
|2.1.208–2.1.217|9|273|191|22|22|20|18|sessions/context/memory、git/files/tools、agents/background/workflows|
|2.1.218–2.1.227|10|191|118|30|16|26|1|sessions/context/memory、git/files/tools、models/api/providers|
|2.1.228–2.1.237|9|225|128|23|18|9|47|sessions/context/memory、git/files/tools、terminal/ui/input|
|2.1.238–2.1.247|8|255|168|27|22|19|19|sessions/context/memory、terminal/ui/input、agents/background/workflows|
|2.1.248–2.1.257|5|229|151|24|20|34|0|sessions/context/memory、models/api/providers、agents/background/workflows|
|2.1.258–2.1.267|8|277|203|26|26|21|1|sessions/context/memory、ide/cloud/remote、models/api/providers|
|2.1.268–2.1.277|10|647|433|84|72|57|1|sessions/context/memory、ide/cloud/remote、git/files/tools|
|2.1.278–2.1.287|9|903|588|92|114|108|1|git/files/tools、sessions/context/memory、ide/cloud/remote|
|2.1.288–2.1.297|9|680|496|58|65|59|2|sessions/context/memory、git/files/tools、mcp/plugins/hooks/skills|
|2.1.298–2.1.307|9|552|385|62|43|62|0|sessions/context/memory、ide/cloud/remote、git/files/tools|
|2.1.308–2.1.310|3|106|79|7|11|9|0|git/files/tools、sessions/context/memory、ide/cloud/remote|

## 逐发布号条目统计

|版本|条目|Bug/回归|新功能|改进|行为/弃用|其他|主领域|
|---|---:|---:|---:|---:|---:|---:|---:|
|2.1.310|26|14|3|5|4|0|ide/cloud/remote, sessions/context/memory, git/files/tools|
|2.1.309|79|64|4|6|5|0|git/files/tools, sessions/context/memory, ide/cloud/remote|
|2.1.308|1|1|0|0|0|0|other|
|2.1.307|43|26|4|6|7|0|ide/cloud/remote, sessions/context/memory, git/files/tools|
|2.1.306|2|2|0|0|0|0|sessions/context/memory, ide/cloud/remote, models/api/providers|
|2.1.305|38|27|5|4|2|0|ide/cloud/remote, git/files/tools, sessions/context/memory|
|2.1.304|76|46|9|11|10|0|sessions/context/memory, git/files/tools, ide/cloud/remote|
|2.1.303|1|1|0|0|0|0|other|
|2.1.302|63|44|5|5|9|0|ide/cloud/remote, sessions/context/memory, git/files/tools|
|2.1.301|51|38|10|1|2|0|terminal/ui/input, git/files/tools, models/api/providers|
|2.1.300|88|59|12|4|13|0|git/files/tools, sessions/context/memory, ide/cloud/remote|
|2.1.299|190|142|17|12|19|0|sessions/context/memory, mcp/plugins/hooks/skills, git/files/tools|
|2.1.296|79|57|8|10|4|0|sessions/context/memory, mcp/plugins/hooks/skills, ide/cloud/remote|
|2.1.295|143|102|16|11|14|0|sessions/context/memory, mcp/plugins/hooks/skills, git/files/tools|
|2.1.294|2|1|0|1|0|0|agents/background/workflows, mcp/plugins/hooks/skills, terminal/ui/input|
|2.1.293|56|39|4|5|7|1|sessions/context/memory, agents/background/workflows, git/files/tools|
|2.1.292|92|65|9|11|7|0|mcp/plugins/hooks/skills, git/files/tools, sessions/context/memory|
|2.1.291|2|2|0|0|0|0|sessions/context/memory, security/sandbox/permissions, terminal/ui/input|
|2.1.290|190|139|14|16|21|0|git/files/tools, sessions/context/memory, agents/background/workflows|
|2.1.289|27|23|1|2|0|1|mcp/plugins/hooks/skills, git/files/tools, terminal/ui/input|
|2.1.288|89|68|6|9|6|0|sessions/context/memory, git/files/tools, terminal/ui/input|
|2.1.287|106|71|8|18|9|0|git/files/tools, sessions/context/memory, mcp/plugins/hooks/skills|
|2.1.286|88|54|8|11|15|0|sessions/context/memory, ide/cloud/remote, git/files/tools|
|2.1.285|136|94|9|15|18|0|sessions/context/memory, git/files/tools, ide/cloud/remote|
|2.1.284|100|60|16|13|11|0|ide/cloud/remote, git/files/tools, models/api/providers|
|2.1.283|94|55|12|13|13|1|mcp/plugins/hooks/skills, git/files/tools, sessions/context/memory|
|2.1.282|86|60|9|7|10|0|git/files/tools, terminal/ui/input, models/api/providers|
|2.1.281|177|120|16|20|21|0|git/files/tools, sessions/context/memory, mcp/plugins/hooks/skills|
|2.1.280|114|73|13|17|11|0|git/files/tools, sessions/context/memory, ide/cloud/remote|
|2.1.278|2|1|1|0|0|0|security/sandbox/permissions, models/api/providers, sessions/context/memory|
|2.1.277|87|60|12|6|9|0|sessions/context/memory, git/files/tools, models/api/providers|
|2.1.276|1|1|0|0|0|0|models/api/providers|
|2.1.275|95|64|13|11|7|0|ide/cloud/remote, git/files/tools, sessions/context/memory|
|2.1.274|108|75|13|10|10|0|ide/cloud/remote, git/files/tools, sessions/context/memory|
|2.1.273|64|37|7|12|7|1|git/files/tools, sessions/context/memory, ide/cloud/remote|
|2.1.272|1|1|0|0|0|0|other|
|2.1.271|96|60|12|17|7|0|sessions/context/memory, git/files/tools, ide/cloud/remote|
|2.1.270|1|1|0|0|0|0|security/sandbox/permissions, sessions/context/memory, git/files/tools|
|2.1.269|98|69|15|6|8|0|ide/cloud/remote, sessions/context/memory, git/files/tools|
|2.1.268|96|65|12|10|9|0|sessions/context/memory, git/files/tools, ide/cloud/remote|
|2.1.267|53|43|3|5|2|0|sessions/context/memory, models/api/providers, git/files/tools|
|2.1.266|1|1|0|0|0|0|models/api/providers, ide/cloud/remote|
|2.1.265|50|36|5|5|4|0|sessions/context/memory, models/api/providers, mcp/plugins/hooks/skills|
|2.1.263|1|1|0|0|0|0|other|
|2.1.261|67|52|7|3|5|0|ide/cloud/remote, sessions/context/memory, git/files/tools|
|2.1.260|66|42|6|8|9|1|sessions/context/memory, models/api/providers, ide/cloud/remote|
|2.1.259|37|26|5|5|1|0|sessions/context/memory, mcp/plugins/hooks/skills, git/files/tools|
|2.1.258|2|2|0|0|0|0|other, security/sandbox/permissions, sessions/context/memory|
|2.1.257|104|69|13|8|14|0|sessions/context/memory, agents/background/workflows, models/api/providers|
|2.1.252|4|4|0|0|0|0|agents/background/workflows, git/files/tools, other|
|2.1.251|71|44|5|8|14|0|sessions/context/memory, models/api/providers, git/files/tools|
|2.1.250|1|1|0|0|0|0|other|
|2.1.248|49|33|6|4|6|0|sessions/context/memory, terminal/ui/input, agents/background/workflows|
|2.1.247|33|19|4|2|8|0|sessions/context/memory, git/files/tools, terminal/ui/input|
|2.1.246|61|49|4|4|4|0|sessions/context/memory, terminal/ui/input, agents/background/workflows|
|2.1.245|1|1|0|0|0|0|other|
|2.1.243|60|35|10|11|4|0|sessions/context/memory, models/api/providers, mcp/plugins/hooks/skills|
|2.1.241|1|1|0|0|0|0|other|
|2.1.240|1|1|0|0|0|0|other|
|2.1.239|59|38|7|0|0|14|sessions/context/memory, git/files/tools, agents/background/workflows|
|2.1.238|39|24|2|5|3|5|sessions/context/memory, terminal/ui/input, ide/cloud/remote|
|2.1.237|2|1|1|0|0|0|models/api/providers, sessions/context/memory, terminal/ui/input|
|2.1.236|33|18|5|1|2|7|sessions/context/memory, terminal/ui/input, models/api/providers|
|2.1.235|19|11|2|2|0|4|sessions/context/memory, terminal/ui/input, agents/background/workflows|
|2.1.234|51|27|5|5|2|12|sessions/context/memory, security/sandbox/permissions, terminal/ui/input|
|2.1.233|20|14|4|1|0|1|git/files/tools, models/api/providers, sessions/context/memory|
|2.1.232|49|24|3|1|2|19|sessions/context/memory, git/files/tools, models/api/providers|
|2.1.231|1|1|0|0|0|0|mcp/plugins/hooks/skills, ide/cloud/remote|
|2.1.229|32|20|3|4|1|4|sessions/context/memory, ide/cloud/remote, git/files/tools|
|2.1.228|18|12|0|4|2|0|sessions/context/memory, models/api/providers, mcp/plugins/hooks/skills|
|2.1.227|5|3|0|2|0|0|git/files/tools, terminal/ui/input, sessions/context/memory|
|2.1.226|1|1|0|0|0|0|other|
|2.1.225|14|9|2|1|1|1|sessions/context/memory, ide/cloud/remote, agents/background/workflows|
|2.1.224|31|17|7|3|4|0|sessions/context/memory, ide/cloud/remote, git/files/tools|
|2.1.223|19|13|3|0|3|0|sessions/context/memory, git/files/tools, models/api/providers|
|2.1.222|21|17|0|3|1|0|sessions/context/memory, agents/background/workflows, models/api/providers|
|2.1.221|39|20|5|3|11|0|models/api/providers, git/files/tools, mcp/plugins/hooks/skills|
|2.1.220|1|1|0|0|0|0|other|
|2.1.219|24|9|10|1|4|0|models/api/providers, agents/background/workflows, git/files/tools|
|2.1.218|36|28|3|3|2|0|git/files/tools, sessions/context/memory, agents/background/workflows|
|2.1.217|20|14|4|0|1|1|sessions/context/memory, agents/background/workflows, terminal/ui/input|
|2.1.216|40|32|1|4|1|2|sessions/context/memory, git/files/tools, terminal/ui/input|
|2.1.215|1|1|0|0|0|0|mcp/plugins/hooks/skills|
|2.1.214|47|35|7|1|4|0|git/files/tools, sessions/context/memory, security/sandbox/permissions|
|2.1.212|48|30|4|4|8|2|sessions/context/memory, agents/background/workflows, git/files/tools|
|2.1.211|37|24|1|6|3|3|git/files/tools, sessions/context/memory, agents/background/workflows|
|2.1.210|33|23|2|3|0|5|agents/background/workflows, git/files/tools, sessions/context/memory|
|2.1.209|1|1|0|0|0|0|models/api/providers, sessions/context/memory, agents/background/workflows|
|2.1.208|46|31|3|4|3|5|sessions/context/memory, agents/background/workflows, models/api/providers|
|2.1.207|24|19|1|2|1|1|agents/background/workflows, git/files/tools, security/sandbox/permissions|
|2.1.206|27|19|5|2|0|1|agents/background/workflows, sessions/context/memory, terminal/ui/input|
|2.1.205|23|16|1|3|0|3|sessions/context/memory, agents/background/workflows, git/files/tools|
|2.1.204|1|1|0|0|0|0|models/api/providers, sessions/context/memory, mcp/plugins/hooks/skills|
|2.1.203|37|28|4|2|3|0|agents/background/workflows, sessions/context/memory, git/files/tools|
|2.1.202|18|13|2|2|1|0|agents/background/workflows, sessions/context/memory, git/files/tools|
|2.1.201|1|1|0|0|0|0|sessions/context/memory|
|2.1.200|17|14|0|2|1|0|agents/background/workflows, mcp/plugins/hooks/skills, sessions/context/memory|
|2.1.199|24|20|0|0|0|4|agents/background/workflows, sessions/context/memory, models/api/providers|
|2.1.198|33|18|5|3|1|6|agents/background/workflows, sessions/context/memory, git/files/tools|
|2.1.197|1|0|1|0|0|0|models/api/providers, sessions/context/memory|
|2.1.196|27|17|3|4|2|1|sessions/context/memory, agents/background/workflows, models/api/providers|
|2.1.195|12|8|2|2|0|0|terminal/ui/input, agents/background/workflows, mcp/plugins/hooks/skills|
|2.1.193|15|6|7|2|0|0|agents/background/workflows, git/files/tools, sessions/context/memory|
|2.1.191|20|12|2|6|0|0|terminal/ui/input, mcp/plugins/hooks/skills, sessions/context/memory|
|2.1.190|1|1|0|0|0|0|other|
|2.1.187|21|15|3|3|0|0|agents/background/workflows, security/sandbox/permissions, models/api/providers|
|2.1.186|33|20|6|3|3|1|agents/background/workflows, sessions/context/memory, mcp/plugins/hooks/skills|
|2.1.185|1|0|0|0|0|1|models/api/providers, git/files/tools|
|2.1.183|17|11|2|1|3|0|agents/background/workflows, sessions/context/memory, terminal/ui/input|
|2.1.181|39|30|3|4|1|1|terminal/ui/input, git/files/tools, other|
|2.1.179|9|8|0|1|0|0|sessions/context/memory, agents/background/workflows, terminal/ui/input|
|2.1.178|24|15|3|3|2|1|agents/background/workflows, mcp/plugins/hooks/skills, sessions/context/memory|
|2.1.176|22|19|1|0|0|2|sessions/context/memory, agents/background/workflows, git/files/tools|
|2.1.175|1|1|0|0|0|0|security/sandbox/permissions, models/api/providers|
|2.1.174|13|11|2|0|0|0|models/api/providers, agents/background/workflows, git/files/tools|
|2.1.173|2|2|0|0|0|0|models/api/providers, sessions/context/memory, security/sandbox/permissions|
|2.1.172|30|19|5|2|1|3|agents/background/workflows, sessions/context/memory, models/api/providers|
|2.1.170|2|1|1|0|0|0|models/api/providers, sessions/context/memory, terminal/ui/input|
|2.1.169|30|15|3|3|2|7|sessions/context/memory, models/api/providers, agents/background/workflows|
|2.1.168|1|1|0|0|0|0|other|
|2.1.167|1|1|0|0|0|0|other|
|2.1.166|21|15|2|0|1|3|sessions/context/memory, terminal/ui/input, models/api/providers|
|2.1.165|1|1|0|0|0|0|other|
|2.1.163|22|13|4|0|1|4|sessions/context/memory, agents/background/workflows, mcp/plugins/hooks/skills|
|2.1.162|28|15|3|0|2|8|sessions/context/memory, agents/background/workflows, terminal/ui/input|
|2.1.161|22|15|2|2|0|3|agents/background/workflows, git/files/tools, terminal/ui/input|
|2.1.160|27|20|1|3|2|1|agents/background/workflows, terminal/ui/input, sessions/context/memory|
|2.1.159|1|0|0|0|0|1|other|
|2.1.158|1|0|1|0|0|0|security/sandbox/permissions, models/api/providers|
|2.1.157|33|18|4|1|3|7|agents/background/workflows, terminal/ui/input, git/files/tools|
|2.1.156|1|1|0|0|0|0|models/api/providers|
|2.1.154|44|24|5|1|5|9|agents/background/workflows, sessions/context/memory, models/api/providers|
|2.1.153|36|26|2|0|1|7|agents/background/workflows, sessions/context/memory, mcp/plugins/hooks/skills|
|2.1.152|33|17|7|0|0|9|sessions/context/memory, mcp/plugins/hooks/skills, models/api/providers|
|2.1.150|1|0|0|0|0|1|other|
|2.1.149|26|21|2|1|0|2|sessions/context/memory, git/files/tools, terminal/ui/input|
|2.1.148|1|1|0|0|0|0|git/files/tools|
|2.1.147|33|29|0|2|1|1|git/files/tools, agents/background/workflows, terminal/ui/input|
|2.1.145|20|13|2|1|0|4|agents/background/workflows, mcp/plugins/hooks/skills, terminal/ui/input|
|2.1.144|50|32|4|4|1|9|sessions/context/memory, agents/background/workflows, mcp/plugins/hooks/skills|
|2.1.143|33|19|5|0|0|9|agents/background/workflows, sessions/context/memory, git/files/tools|
|2.1.142|24|16|1|2|1|4|agents/background/workflows, sessions/context/memory, mcp/plugins/hooks/skills|
|2.1.141|61|47|6|2|0|6|terminal/ui/input, sessions/context/memory, agents/background/workflows|
|2.1.140|13|10|0|2|0|1|agents/background/workflows, mcp/plugins/hooks/skills, git/files/tools|
|2.1.139|50|32|8|0|1|9|mcp/plugins/hooks/skills, sessions/context/memory, models/api/providers|
|2.1.138|1|1|0|0|0|0|other|
|2.1.137|1|1|0|0|0|0|ide/cloud/remote|
|2.1.136|52|46|2|2|1|1|terminal/ui/input, git/files/tools, mcp/plugins/hooks/skills|
|2.1.133|17|10|3|2|0|2|sessions/context/memory, git/files/tools, agents/background/workflows|
|2.1.132|28|23|4|1|0|0|terminal/ui/input, sessions/context/memory, models/api/providers|
|2.1.131|2|2|0|0|0|0|other, models/api/providers|
|2.1.129|27|18|4|0|0|5|terminal/ui/input, sessions/context/memory, mcp/plugins/hooks/skills|
|2.1.128|37|28|2|1|0|6|mcp/plugins/hooks/skills, models/api/providers, terminal/ui/input|
|2.1.126|32|22|2|0|1|7|git/files/tools, models/api/providers, mcp/plugins/hooks/skills|
|2.1.123|1|1|0|0|0|0|models/api/providers, mcp/plugins/hooks/skills|
|2.1.122|18|11|3|1|0|3|models/api/providers, sessions/context/memory, git/files/tools|
|2.1.121|39|20|7|1|1|10|terminal/ui/input, sessions/context/memory, mcp/plugins/hooks/skills|
|2.1.120|22|11|2|1|0|8|terminal/ui/input, mcp/plugins/hooks/skills, git/files/tools|
|2.1.119|51|33|4|0|2|12|mcp/plugins/hooks/skills, git/files/tools, terminal/ui/input|
|2.1.118|34|21|8|0|0|5|mcp/plugins/hooks/skills, git/files/tools, terminal/ui/input|
|2.1.117|28|15|2|3|1|7|mcp/plugins/hooks/skills, models/api/providers, sessions/context/memory|
|2.1.116|25|14|2|2|0|7|terminal/ui/input, git/files/tools, sessions/context/memory|
|2.1.114|1|1|0|0|0|0|security/sandbox/permissions, agents/background/workflows|
|2.1.113|38|24|3|2|1|8|git/files/tools, other, sessions/context/memory|
|2.1.112|1|1|0|0|0|0|security/sandbox/permissions|
|2.1.111|35|13|8|1|1|12|terminal/ui/input, git/files/tools, models/api/providers|
|2.1.110|33|19|4|1|3|6|sessions/context/memory, mcp/plugins/hooks/skills, terminal/ui/input|
|2.1.109|1|0|0|1|0|0|other|
|2.1.108|24|14|2|4|3|1|sessions/context/memory, models/api/providers, terminal/ui/input|
|2.1.107|1|0|0|0|0|1|other|
|2.1.105|37|25|4|7|0|1|git/files/tools, mcp/plugins/hooks/skills, other|
|2.1.101|46|33|5|7|0|1|sessions/context/memory, git/files/tools, agents/background/workflows|
|2.1.98|57|38|8|9|0|2|git/files/tools, terminal/ui/input, sessions/context/memory|
|2.1.97|46|29|6|11|0|0|git/files/tools, sessions/context/memory, mcp/plugins/hooks/skills|
|2.1.96|1|1|0|0|0|0|models/api/providers|
|2.1.94|25|16|5|2|1|1|models/api/providers, sessions/context/memory, mcp/plugins/hooks/skills|
|2.1.92|21|11|3|1|2|4|terminal/ui/input, models/api/providers, sessions/context/memory|
|2.1.91|13|6|3|2|0|2|mcp/plugins/hooks/skills, git/files/tools, terminal/ui/input|
|2.1.90|19|12|3|3|1|0|models/api/providers, git/files/tools, mcp/plugins/hooks/skills|
|2.1.89|52|32|5|4|3|8|git/files/tools, sessions/context/memory, terminal/ui/input|
|2.1.88|41|32|3|1|0|5|terminal/ui/input, git/files/tools, sessions/context/memory|

## 领域累计（多标签）

|领域|命中条目数|
|---|---:|
|sessions/context/memory|2168|
|git/files/tools|1766|
|mcp/plugins/hooks/skills|1366|
|agents/background/workflows|1326|
|terminal/ui/input|1290|
|models/api/providers|1187|
|ide/cloud/remote|1173|
|security/sandbox/permissions|780|
|other|510|
|telemetry/observability|150|

## 已核对的里程碑标签

|标签|标签日期|相对 2.1.88 的可见主线|
|---|---|---|
|v2.1.88|2026-03-30|基线：PermissionDenied、flicker-free/virtualized scrollback、named subagents、长会话缓存/内存/恢复修复。|
|v2.1.119|2026-04-23|插件 monitor、MCP hook、Recap、Vertex/Bedrock 登录向导、PowerShell 自动批准。|
|v2.1.157|2026-05-29|后台 session/agent view、plugin scaffold/autocomplete、skill reload、workflow keyword 控制、模型默认/当前选择分离。|
|v2.1.198|2026-07-01|Agent view 通知、后台 agent 自动 commit/push/draft PR、Claude in Chrome GA、provider gateway failover。|
|v2.1.239|2026-08-21|跨机器 SendMessage/ListAgents、GitLab、self-hosted/remote 方向、sandbox 和 workflow 治理。|
|v2.1.269|2026-09-11|插件 eval、VS Code agent map/权限和 hooks 对话框、Monitor/工作流并发和 OTel repository 维度。|
|v2.1.310|2026-10-23|Monitor 扩展到第三方 provider/telemetry-disabled、MCP timeout/elicitation、cloud role 权限及大量安全/恢复修复。|

## 重点演进阶段

- **2.1.88–2.1.119：稳定性与可用性打底。** 重点是长会话内存/缓存/压缩、Windows/PowerShell、MCP 启动与 OAuth、终端渲染、hooks 条件和基础 provider 兼容；开始出现 `PermissionDenied`、`defer`、Recap、Monitor、Vertex/Bedrock 登录向导等可见功能。
- **2.1.120–2.1.169：会话编排与治理。** `claude agents`/后台会话、`/goal`、跨会话消息、worktree 隔离、Auto mode、模型 effort/fallback、插件依赖和 skill 热加载逐步成形；安全侧扩展到 credentials masking、严格 allowlist、managed settings 版本门禁。
- **2.1.170–2.1.219：多代理、远程和可观测性。** Agent 嵌套/并发预算、`/fork`、`/code-review`、Remote Control、Agent SDK/headless、OTel 事件和 trace 关联、1M context/模型切换、后台任务生命周期成为主线。
- **2.1.220–2.1.269：平台化与企业治理。** self-hosted runner、Claude apps gateway、跨机器 `SendMessage`/`ListAgents`、MCP managed servers、artifact/cloud、GitLab、provider/model policy、VS Code agent map/权限和 hooks 对话框；同时大量安全边界与失败恢复修复。
- **2.1.270–2.1.310：插件/Mods 与宿主能力扩展。** AGENTS.md、server-side Auto mode、Mods（UI/工具/hooks/模型调用）、Monitor、插件 eval、MCP 2026 协议、gateway policy/OTel safety events、后台/云会话和 VS Code 体验；版本后段新增功能与平台专属条目增多，bugfix 仍占主导。

## 下载与实现资料说明

- 已抓取上游公开仓库的 `v2.1.88`、`v2.1.120`、`v2.1.160`、`v2.1.200`、`v2.1.240`、`v2.1.280`、`v2.1.310` 标签，用于版本存在性、发布时间和 changelog 对照。
- 上游公开仓库标签在这些版本中主要提供文档/脚本；npm `@anthropic-ai/claude-code@2.1.310` tarball 仅含 `cli-wrapper.cjs`、`install.cjs`、平台入口和 SDK 类型，不含后续 CLI 源码。因此 2.1.88 之后的内部实现不能从官方 npm tarball 直接逐文件复原；实现分析应以 Moss 初始泄漏源代码、Moss 当前代码和 changelog 的可观察行为为证据，并把推断标成方案。

## 使用说明

逐条原文、版本和归类在 `claude-code-changelog-2.1.88-2.1.310.csv`；这份 Markdown 先回答“所有改动有哪些、各阶段比例如何”，下一阶段再基于重点功能读取 Moss 的实现并筛选可借鉴项。
