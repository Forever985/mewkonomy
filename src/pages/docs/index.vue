<script lang="ts" setup>
import MarkdownIt from "markdown-it"
import { useI18n } from "vue-i18n"
import GameInfo from "../dashboard/components/GameInfo.vue"
import userGuideMd from "../../../docs/USER_GUIDE.md?raw"
import developerGuideMd from "../../../docs/DEVELOPER_GUIDE.md?raw"
import aiContextMd from "../../../docs/AI_CONTEXT.md?raw"

const { t } = useI18n()

const md = new MarkdownIt({ html: true, linkify: true })

const docs = [
  {
    name: "userGuide",
    titleKey: "使用说明书",
    content: md.render(userGuideMd)
  },
  {
    name: "developerGuide",
    titleKey: "开发文档",
    content: md.render(developerGuideMd)
  },
  {
    name: "aiContext",
    titleKey: "AI 上下文",
    content: md.render(aiContextMd)
  }
]

const activeTab = ref("userGuide")
</script>

<template>
  <div>
    <GameInfo />
    <el-card>
      <template #header>
        <div class="flex items-center gap-2 flex-wrap">
          <span>{{ t("使用文档") }}</span>
        </div>
      </template>

      <el-tabs v-model="activeTab">
        <el-tab-pane v-for="doc in docs" :key="doc.name" :label="t(doc.titleKey)" :name="doc.name">
          <div class="markdown-body" v-html="doc.content" />
        </el-tab-pane>
      </el-tabs>
    </el-card>
  </div>
</template>

<style scoped>
.markdown-body {
  font-size: 14px;
  line-height: 1.7;
  color: var(--el-text-color-primary);
  word-break: break-word;
}

.markdown-body :deep(h1) {
  font-size: 22px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  margin: 24px 0 12px;
}

.markdown-body :deep(h2) {
  font-size: 18px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--el-border-color-lighter);
  margin: 20px 0 10px;
}

.markdown-body :deep(h3) {
  font-size: 16px;
  margin: 18px 0 8px;
}

.markdown-body :deep(h4),
.markdown-body :deep(h5),
.markdown-body :deep(h6) {
  font-size: 14px;
  margin: 14px 0 6px;
}

.markdown-body :deep(p) {
  margin: 8px 0;
}

.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  padding-left: 22px;
  margin: 8px 0;
}

.markdown-body :deep(li) {
  margin: 4px 0;
}

.markdown-body :deep(blockquote) {
  margin: 10px 0;
  padding: 6px 12px;
  border-left: 4px solid var(--el-color-primary-light-5);
  background: var(--el-fill-color-light);
  color: var(--el-text-color-secondary);
}

.markdown-body :deep(code) {
  padding: 2px 6px;
  border-radius: 4px;
  font-family: Consolas, Monaco, "Courier New", monospace;
  font-size: 13px;
  background: var(--el-fill-color-light);
  color: var(--el-color-primary);
}

.markdown-body :deep(pre) {
  margin: 10px 0;
  padding: 12px;
  overflow: auto;
  border-radius: 6px;
  background: var(--el-fill-color-dark);
  border: 1px solid var(--el-border-color-lighter);
}

.markdown-body :deep(pre code) {
  padding: 0;
  background: transparent;
  color: var(--el-text-color-primary);
  font-size: 13px;
  line-height: 1.6;
}

.markdown-body :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 10px 0;
  font-size: 13px;
}

.markdown-body :deep(th),
.markdown-body :deep(td) {
  border: 1px solid var(--el-border-color-lighter);
  padding: 6px 10px;
  text-align: left;
}

.markdown-body :deep(th) {
  background: var(--el-fill-color-light);
  font-weight: 600;
}

.markdown-body :deep(tr:nth-child(even) td) {
  background: var(--el-fill-color-lighter);
}

.markdown-body :deep(hr) {
  border: none;
  border-top: 1px solid var(--el-border-color-lighter);
  margin: 16px 0;
}

.markdown-body :deep(a) {
  color: var(--el-color-primary);
}
</style>
