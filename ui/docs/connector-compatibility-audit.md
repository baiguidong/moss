# Moss Connector Compatibility Audit

Last updated: 2026-09-04

## Scope and result

This ledger covers the original 133-connector catalog against the current Moss
desktop connector implementation. The active
`ui/resources/connectors/workbuddy-connectors-config.zip` contains 114 entries
after the 18 provider-blocked connectors were removed on 2026-08-26.

| Result | Count | Meaning |
| --- | ---: | --- |
| PASS | 6 | Connector use was verified end to end, including real-account authorization where required |
| PENDING | 109 | 53 implementation fixes await connector re-test; 56 other connectors still require account, environment, entitlement, or business verification |
| REMOVED | 18 | Provider-blocked connectors removed from the active ZIP; evidence is retained below |
| Active total | 114 | Every connector still shipped in the catalog is accounted for |
| Audited total | 133 | Active and removed entries are both accounted for |

Before removal, `installConnector()` completed for 133/133 entries in an
isolated `HOME`. After removal and the three OAuth fixes, it completed for all
114/114 active entries; all 28 token schemas were retained. Installation only
proves catalog extraction and metadata persistence, so it is not treated as
connector usability.

The 2026-08-26 re-audit also probed all 95 packaged remote MCP servers. Of the
68 servers that required OAuth without a packaged token schema, 67 exposed a
discoverable authorization server and one (`ima-mcp`) exposed no authorization
contract. Moss-compatible dynamic registration succeeded for 49 of the 67.
Three more had concrete Moss-side repairs, which are now implemented below; 14
repeatedly rejected every Moss loopback registration variant, and GitHub
advertised neither dynamic registration nor a usable configured client. No
client IDs or secrets returned by the registration probes were retained.

## PASS: confirmed working

| Connector | Name | Evidence | Last verified |
| --- | --- | --- | --- |
| `fbs-connector` | 福帮手 | HTTP MCP initialized; 10 tools listed; read-only `skill_whoami` completed successfully | 2026-08-25 |
| `lexiang` | 乐享知识库 | User-verified in Moss: real-account authorization and connector use succeeded | 2026-08-25 |
| `baidu-netdisk` | 百度网盘 | User-verified in Moss: real-account authorization and connector use succeeded | 2026-08-25 |
| `qq-mail` | QQ邮箱 | User-verified in Moss: real-account authorization and connector use succeeded | 2026-08-25 |
| `tmeet` | 腾讯会议 | User-verified in Moss: CLI login and connector use succeeded | 2026-08-25 |

## FIXED-PENDING: implementation complete, connector re-test required

The 53 connectors in this section had deterministic incompatibilities before
the 2026-08-25 compatibility work. The original evidence is retained below,
but the Moss implementation issue is fixed and each connector now counts as
PENDING until a real credential/login and non-mutating business call succeeds.

Regression evidence: 133/133 connectors installed in an isolated `HOME`; all
28 token schemas were retained; invalid server names, nested skills, packaged
runtime files, and hybrid CLI prerequisites were present after installation;
credential placeholders and skill environments were verified with synthetic
secrets that were not returned by the catalog API.

### AUTH-TOKEN-01: token schema support implemented

Moss now loads `token-schema.json`, renders validated text/password fields,
encrypts values at rest, and injects them into MCP URLs, headers, stdio
environments, CLI environments, and session-scoped skill environments. MCP and
skill runtimes stay disabled until all required fields are configured.

| Connector | Name | Required package contract | Deterministic failure |
| --- | --- | --- | --- |
| `ctrip-wendao` | 携程问道 | `WENDAO_API_KEY` in skill environment | Skill-only connector has no credential form or environment injection |
| `netease-mail` | 网易邮箱 | `NETEASE_EMAIL_USER`, `NETEASE_EMAIL_PASS` | Skill-only connector requires two fields; neither is collected or injected |
| `bugly-token` | Bugly 质量概览 | `Authorization: Bearer ${BUGLY_ACCESS_TOKEN}` | Literal placeholder reaches the server; server returns 401 |
| `weisheng-scrm` | 微盛企微管家SCRM | `SCRM_APP_KEY` in stdio environment | MCP starts, but business tools have no usable APP KEY |
| `zfs-fssc-ai` | 中兴新云AI智报 | `X-Zfs-Login-Key`, `X-Zfs-Login-Password` | Two required headers cannot be configured |
| `gildata` | 恒生聚源 MCP | `token=${GILDATA_TOKEN}` in URL | URL retains an unresolved placeholder |
| `tencent-map` | 腾讯地图 | `key=${TENCENT_MAP_KEY}` in URL | URL retains an unresolved placeholder |
| `patsnap-search` | 智慧芽专利&文献融合检索 | `apikey=${PATSNAP_API_KEY}` in URL | URL retains an unresolved placeholder |
| `yingmi-mcp` | 盈米MCP | `apiKey=${YINGMI_API_KEY}` in URL | URL retains an unresolved placeholder |
| `infimind-ecommerce-image` | 极睿电商生图 | `MCP_TOKEN` in stdio environment | `tools/list` returned Unauthorized |
| `infimind-video` | 极睿视频 | `SORA_MCP_TOKEN` in stdio environment | `tools/list` timed out without the configured token |
| `linkfox-product-selection` | Linkfox 选品 | `Authorization: ${LINKFOX_AGENT_API_KEY}` | Literal placeholder reaches the server; server returns 401 |
| `wind-finance` | Wind 金融数据 | `Authorization: Bearer ${WIND_API_KEY}` | Required API key is never collected or injected |
| `cisp-mcp` | 水滴征信 | `Authorization: Bearer ${CISP_API_KEY}` | MCP initializes, but authenticated business calls have no configured key |
| `kuaicha-search` | 同花顺快查企业数据 | `open-authorization: Bearer ${KUAICHA_API_KEY}` | MCP initializes, but authenticated business calls have no configured key |
| `youshu-bd-mate` | 智客AI · 对公(To B)营销助手 | `Authorization: Bearer ${API_KEY}` | Server returns 401 and exposes no standard OAuth challenge |
| `picset-commerce-images` | Picset AI 电商图片 | `Authorization: Bearer ${PICSET_AGENT_SK}` | Required key form/injection is absent |
| `picset-video-generation` | Picset AI 视频创作 | `Authorization: Bearer ${PICSET_AGENT_SK}` | Server returns 401 without standard OAuth metadata |
| `opendata` | 及刻智能·时空数据MCP | `Authorization: Bearer ${REGION_INSIGHT_API_KEY}` | SSE opens, but protected calls have no configured key |
| `gangtise-mcp` | Gangtise投研 | `accessKey`, `secretKey` headers | Two required fields cannot be configured |
| `lingxing-mcp` | 领星ERP | `X-Mcp-Key: ${LINGXING_MCP_KEY}` | MCP initializes, but authenticated calls have no configured key |
| `h3yun-connector` | 氚云 | base URL plus bearer token | Two fields are required and the URL remains unresolved |
| `sq-company-dynamic` | 上奇产业通-企业动态追踪 | `Authorization: ${API_KEY}` | Server returns 401 without standard OAuth metadata |
| `fazhi-law` | 同花顺法律AI助手 | `open-authorization: Bearer ${FAZHI_API_KEY}` | MCP initializes, but authenticated calls have no configured key |
| `dcs-cloud` | DCS Cloud | `DCS_PAT` in stdio environment | Bootstrap tool starts, but its required WorkBuddy PAT form does not exist in Moss |
| `fuma-ai-callout` | 福马AI外呼任务 | access token, organization code, login name | Three required fields cannot be configured; server returns 401 |
| `h3c-cloudnet` | 新华三Cloudnet灵犀AI助手 | base host plus API key | Two fields are required and the URL remains unresolved |
| `tushare` | Tushare | `token=${TUSHARE_TOKEN}` in URL | URL retains an unresolved placeholder |

### CLI-AUTH-ARRAY-01: multi-step CLI authentication implemented

| Connector | Name | Deterministic failure |
| --- | --- | --- |
| `77ircloud` | 铱云AI供应链 | `cli.auth` is an array; Moss accepts one string/platform command. Real setup installed the CLI, then authentication failed immediately |
| `feishu` | 飞书 | `cli.auth` contains configuration and login steps; Moss drops the array and never executes either step |

### CLI-PACKAGE-01: package runtime files and `cli.env` installation implemented

| Connector | Name | Deterministic failure |
| --- | --- | --- |
| `seeyon-office-marketing-suite` | 致远互联协同办公服务 | No `init` command; packaged `cli/seeyon-connector.js` is not extracted |
| `shanlong-claw` | 商龙经营洞察 | `$SL_CONNECTOR_HOME/install.sh` is unset and the referenced script is not extracted |
| `tc-chengxin` | 同程程心 | `$TC_CONNECTOR_HOME/cli/tc-chengxin-cli.tgz` is unset and the tarball is not extracted |
| `wps-knowledgebase` | WPS知识库 | `$KWIKI_CONNECTOR_HOME/cli/install.js` is unset and the installer is not extracted |

### CLI-PATH-01: installer PATH refresh implemented

| Connector | Name | Deterministic failure |
| --- | --- | --- |
| `mglc` | 芒果灵创 CLI | Installer writes `~/.local/bin/mglc` and updates shell rc; the same Moss process then runs `mglc version` with the old PATH and gets command not found |

### CLI-STATUS-01: package status contract evaluation implemented

Moss now evaluates `statusMatchJson` and regex-based `statusMatch` contracts.

| Connector | Name | Deterministic failure |
| --- | --- | --- |
| `dingtalk` | 钉钉 | Regex-like `"authenticated"\s*:\s*true` is treated as a literal substring |
| `ihr-cli` | i人事AI·HR专家 | Regex-like `^READY\s*$` is treated as a literal substring |
| `wecom` | 企业微信 | Regex-like `\bauthorized\b` is treated as a literal substring |
| `textin-xparse` | TextIn xParse·智能文档解析 | Unauthenticated status returns exit 0 with `{"logged_in":false}`; ignored JSON matcher makes Moss mark it connected and skip auth |
| `textin-xparse-ai` | TextIn xParse·智能文档解析（海外） | Same false-positive status behavior as `textin-xparse` |

### SKILL-NESTED-01: nested connector skill discovery implemented

Moss now discovers and installs every nested `SKILL.md` while preserving each
skill directory and its references/assets.

| Connector | Name | Deterministic failure |
| --- | --- | --- |
| `beisen-cli` | 北森AI · HR专家 | CLI installs, but all packaged skills are omitted |
| `tencentads` | 腾讯营销投放 | CLI installs, but all packaged skills are omitted |
| `woscli` | 微盟 WOS CLI | CLI installs, but all packaged skills are omitted |
| `zsxq` | 知识星球 | CLI installs, but all packaged skills are omitted |

### MCP-NAME-01: MCP server name normalization implemented

| Connector | Name | Deterministic failure |
| --- | --- | --- |
| `canva` | Canva可画（中国） | Server name `Canva可画` fails Moss's ASCII server-name regex; installed `mcpServers` is empty |
| `camscanner-mcp` | 扫描全能王 | Server name `connector:camscanner-mcp` contains `:`; installed `mcpServers` is empty |

### MCP-HYBRID-01: MCP+CLI prerequisite handling implemented

| Connector | Name | Deterministic failure |
| --- | --- | --- |
| `ai-hive` | AI-HIVE | Package has MCP and CLI auth, but is normalized as MCP, so CLI setup never runs; nested skills are also omitted and `tools/list` timed out |
| `ioa` | 零信任安全 iOA | Declared as MCP while also requiring CLI login; UI never runs CLI setup and stdio `tools/list` timed out |

### MCP-OAUTH-IDENTITY-01: connector-scoped OAuth identities implemented

| Connector | Name | Deterministic failure |
| --- | --- | --- |
| `kling-ai-plugin` | Kling AI（中国） | Package explicitly requires DCR `client_name=Plugin-WorkBuddy`; Moss has no connector mapping for it |
| `kling-ai-plugin-ai` | Kling AI（海外） | Same required `Plugin-WorkBuddy` client identity is not injected |

Kling now receives `client_name=Plugin-WorkBuddy`. TDX registration also
accepts a WorkBuddy identity, but its real login callback is still locked to
WorkBuddy and is therefore recorded as removed below.

### MCP-OAUTH-REGISTRATION-02: provider-specific registration fixes implemented

| Connector | Name | Deterministic failure | Moss fix |
| --- | --- | --- | --- |
| `mx-ds-mcp` | 东方财富妙想MCP | Normal Moss DCR returns `invalid_client_metadata` | Register with the provider-required `client_name=WorkBuddy` |
| `tencent-health-nges` | 腾讯健康NGES | Normal Moss DCR returns `invalid_request` | Register with the provider-required `client_name=WorkBuddy` |
| `pkulaw` | 北大法宝·法律智能检索 | DCR returns `insufficient_scope` when the advertised scopes are included | Omit scope only from DCR while retaining normal scopes on the authorization request |

## REMOVED: provider-blocked connectors

These 18 connectors were removed from the active ZIP on 2026-08-26. They were
not waiting for an account: their authorization contract could not complete in
Moss before a user login was even possible, or the real callback had already
failed.

### MCP-AUTH-01: no usable Moss authorization path

| Connector | Name | Deterministic failure |
| --- | --- | --- |
| `ima-mcp` | ima知识库 | MCP returns 401 without `WWW-Authenticate`; protected-resource and authorization-server metadata endpoints return 404; package provides no alternate credential contract |
| `kdocs` | 金山文档 | `tools/list` works anonymously, but `list_my_files` returns missing bearer token; package is `server-side`/`wps`, Moss has no WPS provider auth entry, and the server does not challenge during initialize |
| `github` | GitHub | OAuth metadata advertises no dynamic registration endpoint or URL-based client-id support usable by Moss; the package provides no client ID or PAT contract |

### MCP-OAUTH-DCR-01: provider rejects Moss loopback clients

Each connector below exposed OAuth metadata, but its registration endpoint
rejected the normal Moss client, a minimal client, a `WorkBuddy` client name,
`127.0.0.1` and `localhost`, dynamic ports, and Moss's fallback port. The
provider must allow Moss loopback redirects/client metadata or publish another
credential contract.

| Connector | Name | Provider response |
| --- | --- | --- |
| `archive-hospital-mcp` | 腾讯健康全周期管理平台 | `invalid_redirect_uri` |
| `chuhaijiang` | 出海匠 | `invalid_redirect_uri` |
| `dzh-mcp` | 大智慧MCP | `invalid_client_metadata` |
| `fadada-richee` | 法大大睿契 | `invalid_redirect_uri` |
| `fanruan-growth-advisor` | 帆软增长谋士 | `invalid_client_metadata` |
| `gongyi-open-mcp` | 腾讯公益机构服务平台 | `invalid_redirect_uri` |
| `jiandaoyun` | 简道云 | Provider error `17158`: MCP OAuth client is invalid |
| `qixinhuiyan-mcp` | 启信慧眼 | Provider says `client_name` or `redirect_uris` is outside its allowlist |
| `salesnail-instructor` | SalesNail 讲师 | `invalid_client_metadata` |
| `salestouch` | SalesTouch 经营执行 | `invalid_redirect_uri` |
| `teacher-assistant` | 企鹅教师助手 | `invalid_redirect_uri` |
| `tencent-dlc` | 腾讯云数据湖计算 DLC | `invalid_redirect_uri` |
| `tencent-qidian-cs` | 腾讯企点客服 | `invalid_client_metadata` |
| `tencent-tchouse-c` | 腾讯云数据仓库 TCHouse-C | `invalid_redirect_uri` |

### MCP-OAUTH-CALLBACK-01: WorkBuddy-only callback

| Connector | Name | Deterministic failure |
| --- | --- | --- |
| `tdx-connector` | 通达信 | OAuth metadata points to `page_workbuddy_oauth.html`; dynamic registration succeeds, but the real account callback was reproduced as WorkBuddy-specific and fails in Moss |

## PENDING: account or business verification required

The table below contains the 55 remaining original pending entries. Together
with the 53 fixed-pending entries above, the current PENDING total is 108.
Remote MCP entries generally reached a standard OAuth challenge and valid
metadata. CLI entries installed and passed their version check unless the note
says otherwise.

| Connector | Name | Type | Auth mode | Remaining verification |
| --- | --- | --- | --- | --- |
| `linear-mcp` | Linear | auto | server-side | Complete real OAuth login and a read-only tool call |
| `canva-ai` | Canva可画（海外） | mcp | - | Complete real OAuth login and a read-only tool call |
| `westock-mcp` | 腾讯自选股 | mcp | - | Complete real OAuth login and a read-only tool call |
| `tencent-docs` | 腾讯文档 | auto | - | Complete real OAuth login and a read-only tool call |
| `tencent-docs-oa` | 腾讯文档企业版 | auto | oneid-token | Verify whether OneID accepts Moss rather than WorkBuddy server identity |
| `tapd` | TAPD | auto | - | Standard OAuth metadata found; complete real login and tool call |
| `cnb-api` | CNB | cli | - | CLI install/version passed; complete login and status verification |
| `tencent-weiyun` | 微云 | auto | - | Complete real OAuth login and a read-only tool call |
| `qcc-company` | 企查查 | auto | - | Complete real OAuth login and a read-only tool call |
| `tyc-mcp` | 天眼查 | mcp | - | Complete real OAuth login and a read-only tool call |
| `notion` | Notion | auto | - | Complete real OAuth login and a read-only tool call |
| `edgeone-pages` | EdgeOne Makers | mcp | - | stdio tools listed; account-info call timed out, so retry login/account verification |
| `cloudbase` | 腾讯云 CloudBase | auto | - | stdio tools listed and `auth(status)` worked; complete `start_auth` and a read-only cloud query |
| `neo-crm` | 销售易CRM | mcp | - | Complete real OAuth login and a read-only tool call |
| `xiaoe-cloud-cli` | 小鹅通 | auto | - | Complete real OAuth login and a read-only tool call |
| `yuandian-mcp` | 华宇元典法律数据 | mcp | - | Complete real OAuth login and a read-only tool call |
| `mastergo-vibe-mcp` | MasterGo 莫高设计 | mcp | - | Start the required local MasterGo service on port 50678, then repeat tools/list |
| `awesun` | 向日葵远程控制 | cli | - | CLI install/version passed; complete QR login and status verification |
| `qingflow` | 轻流 | mcp | - | Complete real OAuth login and a read-only tool call |
| `wk-workbuddy` | 威科先行 | mcp | - | Complete real OAuth login and a read-only tool call |
| `fyopen-lawsearch` | 法研·法律法规检索 | mcp | - | OAuth metadata host correction added; provider CloudWAF still intermittently returns HTTP 418 and requires provider-side verification |
| `yzf-invoice-mcp-server` | 云帐房AI开票 | mcp | - | Complete real OAuth login and a read-only tool call |
| `tongzhou-fin-research` | 同舟金融研究 | mcp | - | Complete real OAuth login and a read-only tool call |
| `tec-do` | Tec-Do 2.0 广告与增长情报 | mcp | - | Complete real OAuth login and a read-only tool call |
| `jinshuju` | 金数据 | mcp | server-side | Complete real OAuth login and a read-only tool call |
| `lovrabet-cli` | Lovrabet CLI | cli | - | CLI install/version passed; complete device login and status verification |
| `moka` | Moka HR 智能体 | mcp | - | Complete real OAuth login and a read-only tool call |
| `lemonclaw` | LemonClaw | cli | - | CLI install/version passed; complete login and status verification |
| `emr-query` | 弹性MapReduce | cli | - | Re-test with Python >=3.11; isolated pip install succeeded but its prefix lacked runtime module resolution |
| `qcc-legal` | 企查查·法律数据 | mcp | - | Complete real OAuth login and a read-only tool call |
| `finenter` | 进门投研 | mcp | - | Resource-specific OAuth metadata override added; complete real login and a read-only tool call |
| `shanglv-mcp-gateway` | 用友智能服务（AI BaaS） | mcp | - | MCP URL corrected to the advertised `/mcp/finance` resource; complete Keycloak login and a read-only tool call |
| `xingtu-claw-risk` | 天创信用星图MCP | mcp | - | Provider rejects loopback redirects but accepts app-scheme redirects; Moss callback override added, awaiting real login and tool call |
| `mzl-trademark` | 摩知轮商标查询 | mcp | - | Complete real OAuth login and a read-only tool call |
| `bazhuayu` | 八爪鱼 | mcp | - | Complete real OAuth login and a read-only tool call |
| `miaoda` | 秒哒应用搭建 | cli | - | CLI install/version passed; complete login and status verification |
| `ezjoin-meeting` | EzyJoin智慧会议 | mcp | - | Complete real OAuth login and a read-only tool call |
| `jiushuyun` | 九数云BI | mcp | - | Complete real OAuth login and a read-only tool call |
| `pandadata` | PandaData 金融数据 | mcp | - | Complete real OAuth login and a read-only tool call |
| `sharecrm` | 纷享销客CRM | mcp | - | OAuth metadata was advertised alongside an HTML error; complete real login and retest |
| `dknowc-mcp` | 深知可信工作台 | mcp | - | Complete real OAuth login and a read-only tool call |
| `morningstar` | 晨星 Morningstar | mcp | - | Complete real OAuth login and a read-only tool call |
| `flova` | Flova | mcp | oauth | tools/list succeeded; `account_user` requires OAuth, so complete real login |
| `duoguan-fengchao` | 夺冠蜂巢 | mcp | - | Complete real OAuth login and a read-only tool call |
| `tplus-api` | 畅捷通T+ | mcp | - | Complete real OAuth login and a read-only tool call |
| `gaodun-job` | 高顿·实习就业助手 | mcp | - | Complete real OAuth login and a read-only tool call |
| `proboost` | OpenBoost 跨境数据 | mcp | - | Complete real OAuth login and a read-only tool call |
| `yunke-cli` | 云客AI工作手机 | cli | - | CLI install/version passed; complete web login and status verification |
| `tanyuan-assistant` | TDC 文化智能体 | mcp | - | Complete real OAuth login and a read-only tool call |
| `fenbi-baokao-decision` | 粉笔 | mcp | - | Complete real OAuth login and a read-only tool call |
| `uupt` | UU跑腿 | cli | - | CLI installer completed; complete local browser login and status verification |
| `designkit-buddy-cli` | 美图设计室 AI设计 CLI | cli | - | CLI install/version passed; complete login and status verification |
| `wisenote` | 百智WiseNote | mcp | - | Complete real OAuth login and a read-only tool call |
| `yzf-general-mcp-server` | 云帐房AI财税 | mcp | - | Complete real OAuth login and a read-only tool call |
| `tiktok` | TikTok for Business | auto | - | Complete real OAuth login and a read-only tool call |

## Resolution queue

Update this section as fixes land. A connector moves to PASS only after a clean
install plus a successful non-mutating business or identity call.

| Order | Issue | Scope | Status | Required fix |
| ---: | --- | ---: | --- | --- |
| 1 | `AUTH-TOKEN-01` | 28 | IMPLEMENTED | Re-test each credential form and a read-only business call with real provider values |
| 2 | `SKILL-NESTED-01` | 4 direct + other MCP guidance loss | IMPLEMENTED | Re-test nested skill discovery and one packaged command per connector |
| 3 | `CLI-PACKAGE-01` | 4 | IMPLEMENTED | Re-test packaged installers and authentication on each supported platform |
| 4 | `CLI-STATUS-01` | 5 | IMPLEMENTED | Re-test logged-out and logged-in status outputs against real CLIs |
| 5 | `CLI-AUTH-ARRAY-01` | 2 | IMPLEMENTED | Re-test ordered configuration/login steps with real accounts |
| 6 | `MCP-NAME-01` | 2 | IMPLEMENTED | Re-test `tools/list` and a read-only call using normalized names |
| 7 | `MCP-HYBRID-01` | 2 | IMPLEMENTED | Re-test CLI pre-auth followed by MCP runtime reload and `tools/list` |
| 8 | `MCP-OAUTH-IDENTITY-01` | 2 | IMPLEMENTED / RETEST | Re-test both Kling endpoints with the required client identity |
| 9 | `MCP-OAUTH-REGISTRATION-02` | 3 | IMPLEMENTED / RETEST | Complete real login and a read-only call for all three registration variants |
| 10 | `MCP-OAUTH-DCR-01` | 14 | REMOVED | Restore only after the provider accepts a Moss loopback client or publishes an alternate credential contract |
| 11 | `MCP-AUTH-01` | 3 | REMOVED | Restore only after a usable provider auth contract/client is available |
| 12 | `MCP-OAUTH-CALLBACK-01` | 1 | REMOVED | Restore TDX only after its provider supports a Moss callback |
| 13 | `CLI-PATH-01` | 1 | IMPLEMENTED | Re-test install/version/status in a fresh Moss process |

## Re-test checklist

For each resolved connector:

1. Install into a clean temporary `HOME`.
2. Confirm installed metadata contains at least one usable MCP server or skill.
3. Complete the declared auth flow without manually editing files or environment variables.
4. Restart/reload the Moss MCP runtime.
5. Run `tools/list` or the CLI status command.
6. Execute one non-mutating identity/list/status business operation.
7. Record the date, Moss commit, provider response class, and result in this file.
