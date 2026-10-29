---
name: skill-creator
description: 创建或修改 Moss 技能，把稳定流程整理为 SKILL.md、参考资料和必要脚本。适用于新增技能或维护既有技能；从当前会话提炼流程也可用 skillify，安装已有技能用 skill-installer。
user-invocable: true
---

# 技能创建

技能是供模型按需读取的说明和资源。用户在主会话描述需求，不需要进入 App 或自己编写配置。

先检查已有技能和用户给定的资料，明确适用任务、输入、输出与成功条件。已有足够信息就执行；只询问会影响结果的缺失信息。修改现有技能时保留用户选择、可选元数据和无关内容，不重新初始化。

默认写入 `MOSS_HOME/skills/<name>`（未设置时 `~/.moss/skills/<name>`）；明确只用于当前项目时写入工作区 `.moss/skills/<name>`。不要修改软件随包提供的内置目录；需要定制内置技能时创建个人副本并说明覆盖关系。名称使用不超过 64 字符的小写英文、数字、连字符，文件夹名与 frontmatter 的 name 一致。

## 编写与验证

1. `SKILL.md` 的 YAML 必须包含 name、description。description 说明能力和触发情形，避免“任何任务都使用”的宽泛描述。正文保留会改变模型决策的规则；不要重复通用常识、把一个例子写成所有任务的限制，或添加未经用户授权的发送、发布和安装步骤。
2. 详细且仅特定任务需要的内容放入 references/，从正文说明何时读取；只有重复、易错步骤才添加 scripts/；assets/ 放实际产物要用的素材。不要创建空目录或 TODO 占位内容。Moss 不需要 Codex 的 agents/openai.yaml。
3. 自动发现保持开启；只有用户明确要求手动触发时才设 `disable-model-invocation: true`。保留已有 allowed-tools、context、hooks 等配置；新增时查清实际能力，不能凭空列工具。
4. 新建时可先写正文文件，再调用本技能脚本，脚本不会覆盖已有目录：

   `python3 scripts/skill.py init my-skill --description '用于明确任务的简要说明' --instructions-file /absolute/body.md --dest /absolute/skills`

   路径相对本技能目录；shell 参数用正常引用，绝不把用户文本拼进可执行命令。可省略 --dest 使用个人技能目录。
5. 完成后运行 `python3 scripts/skill.py validate /absolute/skills/my-skill`。脚本检查必需元数据、未完成占位符、资源链接和文件边界；完整 YAML 和实际调用行为仍由 Moss 加载器验证。
6. 新增/修改的脚本在临时目录实际运行，检查输出或失败情形；若技能调用外部服务，遵守已有授权和配置，不把静态检查当作真实服务测试。用一个代表性请求验证最终行为，避免只检查文案出现某个词。

交付说明技能名称、保存路径、触发示例和实际验证范围。Moss 会发现个人/项目技能；正在运行的一轮不会被中途改写，后续轮次或新会话再使用。如列表尚未刷新，刷新技能列表或开启新会话。
