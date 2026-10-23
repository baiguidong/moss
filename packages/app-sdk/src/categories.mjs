import manifestSchema from './schemas/app-manifest.schema.json' with { type: 'json' }

// Use the public Manifest contract as the category and display-order authority.
export const APP_CATEGORIES = Object.freeze(manifestSchema.properties.category.oneOf
  .map(({ const: id, title: label }) => Object.freeze({ id, label })))

export function getAppCategory(value) {
  return APP_CATEGORIES.find(category => category.id === value) || APP_CATEGORIES.at(-1)
}

const legacyCategoryIds = new Set(['communication', 'knowledge', 'automation', 'ai', 'development', 'diagnostics', 'other'])

export function getAppCategoryMinimumHostVersion(value) {
  return legacyCategoryIds.has(getAppCategory(value).id) ? '3.0.0' : '3.21.0'
}

const legacyCategories = new Map(Object.entries({
  knowledge: [['moss.zsxq', 'other']],
  files: [['moss.backup', 'knowledge'], ['moss.baidu-netdisk', 'knowledge'], ['moss.drive', 'knowledge'], ['moss.file-cleaner', 'knowledge'], ['moss.filesystem', 'knowledge'], ['moss.tencent-weiyun', 'other']],
  creative: [['moss.canva', 'other'], ['moss.canva-ai', 'other'], ['moss.designkit-buddy-cli', 'other'], ['moss.drawio', 'development'], ['moss.flova', 'other'], ['moss.image-tools', 'knowledge'], ['moss.infimind-ecommerce-image', 'other'], ['moss.infimind-video', 'other'], ['moss.kling-ai-plugin', 'other'], ['moss.kling-ai-plugin-ai', 'other'], ['moss.mastergo-vibe-mcp', 'development'], ['moss.media-tools', 'knowledge'], ['moss.mglc', 'other'], ['moss.picset-commerce-images', 'other'], ['moss.picset-video-generation', 'other'], ['moss.transcription', 'knowledge']],
  development: [['moss.cloudbase', 'communication'], ['moss.cnb-api', 'other'], ['moss.h3c-cloudnet', 'other'], ['moss.linear-mcp', 'knowledge'], ['moss.miaoda', 'communication'], ['moss.tapd', 'other']],
  data: [['moss.bazhuayu', 'other'], ['moss.data-workbench', 'development'], ['moss.database', 'development'], ['moss.dbx', 'development'], ['moss.emr-query', 'other'], ['moss.excel', 'knowledge'], ['moss.jiushuyun', 'other'], ['moss.opendata', 'other'], ['moss.tencent-health-nges', 'other']],
  automation: [['moss.dcs-cloud', 'other'], ['moss.h3yun-connector', 'other'], ['moss.jinshuju', 'other'], ['moss.lovrabet-cli', 'other'], ['moss.qingflow', 'development']],
  ai: [['moss.ai-hive', 'other']],
  sales: [['moss.fuma-ai-callout', 'other'], ['moss.neo-crm', 'other'], ['moss.sharecrm', 'other'], ['moss.weisheng-scrm', 'communication'], ['moss.youshu-bd-mate', 'other'], ['moss.yunke-cli', 'other']],
  marketing: [['moss.duoguan-fengchao', 'other'], ['moss.linkfox-product-selection', 'other'], ['moss.proboost', 'other'], ['moss.shanlong-claw', 'other'], ['moss.tec-do', 'other'], ['moss.tencentads', 'other'], ['moss.tiktok', 'development'], ['moss.woscli', 'knowledge']],
  finance: [['moss.finenter', 'other'], ['moss.gangtise-mcp', 'other'], ['moss.gildata', 'other'], ['moss.morningstar', 'other'], ['moss.mx-ds-mcp', 'other'], ['moss.pandadata', 'other'], ['moss.tongzhou-fin-research', 'other'], ['moss.tushare', 'other'], ['moss.wind-finance', 'other'], ['moss.yingmi-mcp', 'other']],
  business: [['moss.77ircloud', 'other'], ['moss.fbs-connector', 'other'], ['moss.lemonclaw', 'other'], ['moss.lingxing-mcp', 'other'], ['moss.shanglv-mcp-gateway', 'other'], ['moss.tplus-api', 'other'], ['moss.yzf-general-mcp-server', 'other'], ['moss.yzf-invoice-mcp-server', 'other'], ['moss.zfs-fssc-ai', 'other']],
  hr: [['moss.beisen-cli', 'other'], ['moss.gaodun-job', 'other'], ['moss.ihr-cli', 'communication'], ['moss.moka', 'other']],
  education: [['moss.fenbi-baokao-decision', 'other'], ['moss.tanyuan-assistant', 'knowledge'], ['moss.xiaoe-cloud-cli', 'knowledge']],
  legal: [['moss.cisp-mcp', 'other'], ['moss.dknowc-mcp', 'other'], ['moss.fazhi-law', 'other'], ['moss.fyopen-lawsearch', 'knowledge'], ['moss.kuaicha-search', 'other'], ['moss.mzl-trademark', 'other'], ['moss.patsnap-search', 'development'], ['moss.pkulaw', 'other'], ['moss.qcc-company', 'other'], ['moss.qcc-legal', 'other'], ['moss.sq-company-dynamic', 'other'], ['moss.tyc-mcp', 'other'], ['moss.wk-workbuddy', 'other'], ['moss.xingtu-claw-risk', 'other'], ['moss.yuandian-mcp', 'other']],
  life: [['moss.ctrip-wendao', 'other'], ['moss.tc-chengxin', 'other'], ['moss.tencent-map', 'other'], ['moss.uupt', 'other']],
  diagnostics: [['moss.bugly-token', 'other'], ['moss.ioa', 'other']],
}).flatMap(([category, entries]) => entries.map(([id, previous]) => [id, { previous, category }])))

export function getAppCategoryForApp(app) {
  const legacy = legacyCategories.get(app?.id || app?.name)
  const category = legacy && (!app?.category || app.category === legacy.previous) ? legacy.category : app?.category
  return getAppCategory(category)
}
