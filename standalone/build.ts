/**
 * 单文件构建脚本: standalone/main.ts -> public/terraria.html
 * 运行: bun standalone/build.ts
 * 产出零依赖单 HTML(引擎 + DOM UI 全部内联, 双击即玩, 无网络请求)
 */
/// <reference types="bun-types" />

import { writeFileSync } from 'node:fs';

const FAVICON = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" fill="#6a4a2e"/><rect y="0" width="16" height="5" fill="#3f8f3a"/><rect x="2" y="1" width="2" height="2" fill="#75c455"/><rect x="9" y="2" width="2" height="2" fill="#75c455"/></svg>',
);

async function main(): Promise<void> {
  const result = await Bun.build({
    entrypoints: ['standalone/main.ts'],
    target: 'browser',
    format: 'iife',
    minify: { whitespace: false, identifiers: false, syntax: false },
  });

  if (!result.success) {
    for (const log of result.logs) console.error(log);
    process.exit(1);
  }

  // 防止 JS 字符串里的 </script> 提前闭合标签
  const js = (await new Response(result.outputs[0]).text())
    .replace(/<\/script>/gi, '<\\/script>');

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
<meta name="description" content="泰拉瑞亚 Web 复刻 — 单文件零依赖版,程序化像素沙盒游戏">
<title>泰拉瑞亚 Web · 单文件版</title>
<link rel="icon" href="${FAVICON}">
</head>
<body>
<script>
${js}
</script>
</body>
</html>
`;

  writeFileSync('public/terraria.html', html);
  const kb = (Bun.file('public/terraria.html').size / 1024).toFixed(1);
  console.log(`OK public/terraria.html (${kb} KB)`);
}

void main();
