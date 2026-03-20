// electron-builder 完整打包配置：在默认配置基础上追加 runtime/ml/ 和 runtime/checkpoints/
// 用法：npx electron-builder --config scripts/builder-full.js

const base = require('../package.json').build;

module.exports = {
  ...base,
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
