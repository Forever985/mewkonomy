<script lang="ts" setup>
/**
 * 列表分页脚（统一封装）
 *
 * 背景：12 个页面的分页块逐字重复，且 `.pager-wrapper` 样式也各写一份：
 *   <div class="pager-wrapper">
 *     <el-pagination background :layout="paginationDataXX.layout" ... />
 *   </div>
 * 配合 `usePagination()` 使用 —— 该 composable 已经产出 paginationData 与两个 handler，
 * 本组件只负责统一渲染，避免每个页面重复这段标记与样式。
 *
 * 用法：
 *   <template #footer>
 *     <PagerFooter
 *       :pagination="paginationDataLD"
 *       @size-change="handleSizeChangeLD"
 *       @current-change="handleCurrentChangeLD"
 *     />
 *   </template>
 */
interface PagerData {
  layout: string
  pageSizes: number[]
  total: number
  pageSize: number
  currentPage: number
}

defineProps<{ pagination: PagerData }>()
const emit = defineEmits<{ sizeChange: [value: number], currentChange: [value: number] }>()
</script>

<template>
  <div class="pager-wrapper">
    <el-pagination
      background
      :layout="pagination.layout"
      :page-sizes="pagination.pageSizes"
      :total="pagination.total"
      :page-size="pagination.pageSize"
      :current-page="pagination.currentPage"
      @size-change="emit('sizeChange', $event)"
      @current-change="emit('currentChange', $event)"
    />
  </div>
</template>

<!-- 非 scoped：该样式原本由 12 个页面各自在 <style scoped> 里重复定义（写法完全相同） -->
<style lang="scss">
.pager-wrapper {
  display: flex;
  justify-content: center;
}
</style>
