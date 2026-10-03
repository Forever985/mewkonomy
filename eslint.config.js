import antfu from "@antfu/eslint-config"

// 更多自定义配置可查阅仓库：https://github.com/antfu/eslint-config
export default antfu(
  {
    // 使用外部格式化程序格式化 css、html、markdown 等文件
    formatters: true,
    // 启用样式规则
    stylistic: {
      // 缩进级别
      indent: 2,
      // 引号风格 'single' | 'double'
      quotes: "double",
      // 是否启用分号
      semi: false
    },
    // 忽略文件
    // 说明：@antfu/eslint-config 会自动读取 .gitignore，因此 dist/、temp/、.vite/ 这些构建产物与缓存
    // 已由 .gitignore 覆盖，无需在此重复声明（根目录 assets/ 是历史误提交的构建产物，见 .gitignore 中的说明）。
    // 这里只列出「必须保留在仓库中、但不适合 lint」的数据文件：data.json 约 4MB，属于数据而非代码。
    // 两个易踩的坑（本次实测）：flat config 的模式必须带 `/**` 才会连目录内容一起忽略（只写目录名不生效），
    // 且不要写前导斜杠（`/data/**` 在本版本不会被归一化，反而匹配不到任何文件）。
    ignores: [
      "data/**",
      "public/data/**"
    ]
  },
  {
    // 对所有文件都生效的规则
    rules: {
      // vue
      "vue/block-order": ["error", { order: ["script", "template", "style"] }],
      "vue/attributes-order": "off",
      // ts
      "ts/no-use-before-define": "off",
      "ts/no-require-imports": "off", // 允许条件require导入
      "ts/no-var-requires": "off", // 允许require语句
      // node
      "node/prefer-global/process": "off",
      // style
      "style/comma-dangle": ["error", "never"],
      "style/brace-style": ["error", "1tbs"],
      // regexp
      "regexp/no-unused-capturing-group": "off",
      // other
      "no-console": "off",
      "no-debugger": "off",
      "symbol-description": "off",
      "antfu/if-newline": "off"
    }
  }
)
