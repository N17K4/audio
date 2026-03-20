// electron-builder 完整打包配置：在默认配置基础上追加 runtime/ml/ 和 runtime/checkpoints/
// 用法：npx electron-builder --config scripts/builder-full.js
//
// 注意：files 不能直接复用 package.json 的数组。
// package.json 中 "!**/*" 在 files 顶层表示"排除默认文件"，
// 但通过 --config 加载时 electron-builder 将 files 数组包装为 FileSet.filter，
// 此时 "!**/*" 会排除所有文件。因此这里只保留正向 glob。

const path = require('path');
const base = require('../package.json').build;

module.exports = {
  ...base,
  files: [
    "electron/**/*",
    "frontend/out/**/*",
  ],
  extraResources: [
    ...base.extraResources,
    {
      from: "runtime/ml/",
      to: "runtime/ml/",
    },
    {
      from: "runtime/checkpoints/",
      to: "runtime/checkpoints/",
    },
  ],
};
