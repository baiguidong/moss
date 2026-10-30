# PPTX chart path compatibility

`@aiden0z/pptx-renderer@1.3.0` categorizes chart XML, chart relationships,
styles and color styles only when they are directly under `ppt/charts/`.
Valid presentations can reference these parts under `ppt/slides/charts/`
or another nested `charts` directory. The original parser omits them and
the renderer displays `Chart not found` even though the ZIP part exists.

The patch accepts nested chart directories while retaining complete part
paths as map keys, so charts with identical basenames remain distinct.
It covers the ESM and browser ESM entry points used by Moss, including
eager and lazy-media parsing. The unused CommonJS build is unchanged.
Bun applies the patch from `patchedDependencies` during normal/frozen installs;
the fixed parser is then bundled into the production renderer by Vite.

Regression: `bun test tests/pptx-chart-paths.test.ts`.
Real application: `node scripts/test-pptx-charts-cdp.mjs [path-to-pptx]`.
Remove this patch when a tested upstream version supports these paths.
