<script lang="ts" setup>
import logoAlipay from "@@/assets/images/sponsor/alipay.jpg?url"
import logoPaypal from "@@/assets/images/sponsor/paypal.jpg?url"
import logoWechat from "@@/assets/images/sponsor/wechat.jpg?url"
import { Link } from "@element-plus/icons-vue"
import axios from "axios"
import { ElLoading, type FormRules } from "element-plus"

const url = "https://script.google.com/macros/s/AKfycbzA8s6SOQDoFi27VuQ9wqqjQDZuLcjGVdfH-3DIO32ayYFI29u3dxWV3Y4_Q6geT3Kr/exec"

const jsonUrl = "https://opensheet.elk.sh/1JPXJfdfeCpaBnKb73idoilf9n1a-GNjiA_xYb-tJ6cI/Sheet1"
const sponsorList = ref<Sponsor[] >([])
const sponsorLoading = ref(false)

const refForm = ref()
const form = ref<Sponsor>({})
const dialogVisible = ref(false)
const dialogLoading = ref(false)
let loadingService: any
const rules = reactive<FormRules>({
  nickname: [{ required: true, message: "不能为空", trigger: ["blur", "change"] }],
  platform: [{ required: true, message: "不能为空", trigger: ["blur", "change"] }],
  name: [{ required: true, message: "不能为空", trigger: ["blur", "change"] }],
  amount: [{ required: true, message: "不能为空", trigger: ["blur", "change"] }]
})
watch(dialogLoading, (val) => {
  if (val) {
    loadingService = ElLoading.service({
      lock: true,
      target: ".dialog"
    })
  } else {
    loadingService.close()
  }
})
function submit() {
  refForm.value.validate((valid: boolean) => {
    if (valid) {
      dialogLoading.value = true
      fetch(url, {
        // 解决跨域问题
        redirect: "follow",
        method: "POST",
        body: JSON.stringify(form.value),
        headers: {
          "Content-Type": "text/plain;charset=utf-8"
        }
      })
        .then(() => {
          ElMessage.success("提交成功，请等待作者审核")
          dialogVisible.value = false
          loadData()
        })
        .catch((e) => {
          ElMessage.error(e)
        })
        .finally(() => {
          dialogLoading.value = false
        })
    }
  })
}
loadData()

interface Sponsor {
  approved?: boolean
  nickname?: string
  platform?: string
  name?: string
  amount?: number
  date?: Date
  [key: string]: any
}
// 加载审核通过的数据
function loadData() {
  sponsorLoading.value = true
  axios.get(jsonUrl)
    .then(({ data }) => {
      const keyMap: { [key: string]: string } = {
        姓名: "name",
        审核状态: "approved",
        昵称: "nickname",
        平台: "platform",
        金额: "amount",
        时间: "date"
      }
      sponsorList.value = data.map((item: any) => {
        const sponsor: Sponsor = {}
        for (const key in item) {
          keyMap[key] && (sponsor[keyMap[key]] = item[key])
        }
        return sponsor
      }).filter((item: Sponsor) => item.approved)
      // 相同nickname的合并，金额相加，相同金额按照出现顺序排序
      const map = new Map<string, Sponsor>()
      sponsorList.value.forEach((item: Sponsor) => {
        if (map.has(item.nickname!)) {
          const sponsor = map.get(item.nickname!)
          if (sponsor) {
            console.log("sponsor.amount", sponsor.amount)
            sponsor.amount! = +sponsor.amount! + +item.amount!
          }
        } else {
          map.set(item.nickname!, item)
        }
      })
      sponsorList.value = Array.from(map.values()).sort((a: Sponsor, b: Sponsor) => b.amount! - a.amount!)
    })
    .catch((e) => {
      ElMessage.error(e)
    })
    .finally(() => {
      sponsorLoading.value = false
    })
}
function onPaypal() {
  window.open("https://paypal.me/luyh7")
}
const { t } = useI18n()
</script>

<template>
  <div style="text-align: center;">
    <div class="font-size-[14px]">
      <h1>
        {{ t('打赏作者') }} <span class="luyh7">luyh7</span>
      </h1>
      <!-- 浅灰色 -->
      <p class="color-[#999]">
        {{ t('如果您觉得本项目对您有帮助，可以打赏作者一根辣条') }}
      </p>
      <p class="color-[#999]">
        {{ t('联系方式') }}
      </p>
      <p>
        <!-- 粉红色 -->
        QQ: <span class="color-[#f29b1d]">470103427&nbsp;&nbsp;</span>
        <!-- 米黄色 -->
        Discord: <span class="color-[#f29b1d]">whisper0821</span>
      </p>
      <p />
      <p>
        Email: <span class="color-[#f29b1d]">
          470103427@qq.com
        </span>
      </p>
    </div>

    <el-row :gutter="20">
      <el-col :sm="24" :md="12">
        <el-card class="sponsor-list">
          <template #header>
            {{ t('感谢以下玩家打赏') }}&nbsp;
            <el-button type="primary" @click="dialogVisible = true">
              {{ t('我要上榜') }}
            </el-button>
          </template>
          <el-table v-loading="sponsorLoading" :data="sponsorList">
            <el-table-column :label="t('排名')" width="60">
              <template #default="{ $index }">
                <div class="uno-flex-x-center">
                  <div>{{ ['🥇', '🥈', '🥉'][$index] }}</div>
                  <div v-if="$index >= 3">
                    {{ $index + 1 }}
                  </div>
                </div>
              </template>
            </el-table-column>

            <el-table-column prop="nickname" :label="t('昵称')">
              <template #default="{ row }">
                <!-- 宽度等于字体长度 -->
                <div
                  :class="{
                    [row.nickname]: true,
                  }"
                  :style="{
                    width: `${row.nickname.length}em`,
                  } "
                >
                  {{ row.nickname }}
                </div>
              </template>
            </el-table-column>
            <el-table-column prop="amount" :label="t('金额')">
              <template #default="{ row }">
                <span>¥{{ row.amount }}</span>
              </template>
            </el-table-column>
          </el-table>
        </el-card>
      </el-col>

      <el-col :sm="24" :md="12">
        <el-row :gutter="20" class="img-row">
          <el-col :xs="24" :sm="12" :md="24" :lg="12" :xl="8">
            <el-card>
              <img width="80%" :src="logoWechat" alt="微信打赏">
              <div class="img-alt">
                {{ t('微信') }}
              </div>
            </el-card>
          </el-col>
          <el-col :xs="12" :sm="12" :md="24" :lg="12" :xl="8">
            <el-card>
              <img width="80%" :src="logoAlipay" alt="支付宝打赏">
              <div class="img-alt">
                {{ t('支付宝') }}
              </div>
            </el-card>
          </el-col>
          <el-col :xs="24" :sm="12" :md="24" :lg="12" :xl="8">
            <el-card style="cursor:pointer" @click="onPaypal">
              <img width="80%" :src="logoPaypal" alt="Paypal打赏">
              <el-link :icon="Link" underline type="primary" class="img-alt" style="display:flex">
                PayPal
              </el-link>
            </el-card>
          </el-col>
        </el-row>
      </el-col>
    </el-row>
    <div />

    <el-dialog class="dialog" v-model="dialogVisible" :title="t('我要上榜')" :show-close="false">
      <el-form :model="form" ref="refForm" class="form" :rules="rules" label-width="80px">
        <el-form-item prop="nickname" :label="t('昵称')">
          <el-input v-model="form.nickname" :placeholder="t('打赏者名单上显示的名字')" />
        </el-form-item>
        <el-form-item prop="platform" :label="t('平台')">
          <el-select v-model="form.platform" :placeholder="t('请选择')">
            <el-option :label="t('支付宝')" value="支付宝" />
            <el-option :label="t('微信')" value="微信" />
            <el-option label="Paypal" value="Paypal" />
          </el-select>
        </el-form-item>
        <el-form-item prop="name" :label="t('姓名')">
          <el-input v-model="form.name" :placeholder="t('您支付时使用的名字')" />
        </el-form-item>
        <el-form-item prop="amount" :label="t('金额')">
          <el-input v-model="form.amount" placeholder="CNY" />
        </el-form-item>
        <div style="margin: 10px 80px; line-height: 1.5;">
          {{ t('提交后请等待作者审核，审核通过后会显示在打赏者名单中') }}
        </div>
      </el-form>

      <template #footer>
        <div style="text-align: center;">
          <el-button type="primary" @click="submit">
            提交
          </el-button>
        </div>
      </template>
    </el-dialog>
  </div>
</template>

<style lang="scss" scoped>
:deep(.el-link__inner) {
  display: block;
}
.img-row {
  margin: 20px !important;
  .el-col {
    margin-bottom: 20px;
  }
}
.img-alt {
  font-size: 2vw;
  font-weight: bold;
  margin: 10px 0 20px 0;
}
.sponsor-list {
  margin: 20px;
  text-align: left;
  /* 确保特效昵称不被裁剪 */
  :deep(.el-table) {
    .cell {
      overflow: visible !important;
    }
  }
}
.form {
  margin: 20px;
}

.luyh7 {
  width: 1000px;
  background: linear-gradient(to right, #ff4757, #ff6b81, #ffa502, #20bf6b, #01a3d4, #5f27cd, #d252e1);
  animation: glow-animation 2s ease-in-out infinite alternate;
  -webkit-background-size: 1000px 100%;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
}

.Joey {
  font-size: 20px;
  font-family: Roboto, Helvetica, Arial, sans-serif;
  font-weight: 600;
  width: 100%;
  background: linear-gradient(160deg, #fff8c7 30%, #fbd640);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  /* 阴影外扩，避免覆盖渐变字体本体 */
  filter: drop-shadow(1px 0 2px rgba(244, 64, 64, 0.6901960784)) drop-shadow(-1px 0 2px rgba(244, 64, 64, 0.6901960784))
    drop-shadow(0 1px 2px rgba(244, 64, 64, 0.6901960784)) drop-shadow(0 -1px 2px rgba(244, 64, 64, 0.6901960784));
}

// 霓虹色效果，从左到右紫色到蓝色到红色渐变，字体有深色边框
.BBC233 {
  font-size: 20px;
  font-weight: bold;
  background: linear-gradient(to right, #ff00ff, #00ffff, #ff0000);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: glow-animation 2s ease-in-out infinite alternate;
}
@keyframes glow-animation {
  0% {
    filter: hue-rotate(-360deg);
  }
  100% {
    filter: hue-rotate(360deg);
  }
}
// 浅粉色霓虹
.苏叶叶 {
  font-size: 20px;
  font-weight: bold;
  background-image: -webkit-linear-gradient(left, #d48085, #fff 30%, #d48085 50%);
  -webkit-text-fill-color: transparent;
  -webkit-background-clip: text;
  -webkit-background-size: 200% 100%; /* 双倍宽度保证循环 */
  animation: masked-animation 2s infinite linear;
}
.adudu {
  font-size: 20px;
  font-weight: bold;
  background-image: -webkit-linear-gradient(left, #f29b1d, #fff 10%, #f29b1d 20%);
  -webkit-text-fill-color: transparent;
  -webkit-background-clip: text;
  -webkit-background-size: 200% 100%; /* 双倍宽度保证循环 */
  animation: masked-animation 3s infinite linear;
}

.raintower {
  font-size: 24px;
  font-weight: 600;
  /* 彩虹渐变背景 */
  background-image: -webkit-linear-gradient(left, #ff4757, #ff6b81, #ffa502, #20bf6b, #01a3d4, #5f27cd, #d252e1);
  -webkit-text-fill-color: transparent;
  -webkit-background-clip: text;
  -webkit-background-size: 50% 100%;
  // ffd700
  -webkit-text-stroke: 0.3px rgba(255, 215, 0, 0.8);
  // animation: masked-animation 3s infinite linear;
}
.eggyang {
  font-size: 24px;
  font-weight: 900;
  position: relative;
  /* 确保发光效果不被裁剪 */
  padding: 15px;
  margin-bottom: 5px;
  padding-left: 0;
  /* 霓虹金色渐变 */
  background: linear-gradient(
    45deg,
    #ffd700,
    #ffed4a,
    #f9ca24,
    #f0932b,
    #eb4d4b,
    #6c5ce7,
    #a29bfe,
    #fd79a8,
    #fdcb6e,
    #ffd700
  );
  background-size: 400% 400%;
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  /* 金色描边 */
  -webkit-text-stroke: 1px #ffd700;
  /* 组合动画：背景流动 + 缩放脉冲 + 色相旋转 */
  animation:
    eggyang-gradient 3s ease-in-out infinite,
    eggyang-pulse 2s ease-in-out infinite alternate,
    eggyang-glow 4s linear infinite;
  /* 发光阴影 */
  filter: drop-shadow(0 0 10px rgba(255, 215, 0, 0.8)) drop-shadow(0 0 20px rgba(255, 215, 0, 0.6))
    drop-shadow(0 0 30px rgba(255, 215, 0, 0.4));
  /* 防止内容被裁剪 */
  overflow: visible;
  /* 确保有足够空间显示缩放效果 */
  transform-origin: center;
}

.RyuuSan {
  background: linear-gradient(90deg, #e3858b, #e3858b 3%, #f6d6d8 15%, #f6d6d8 30%, #ecadb1 50%, #e3858b 95%, #e3858b);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

@keyframes masked-animation {
  0% {
    background-position: 100% 0; /* 从右侧开始 */
  }
  100% {
    background-position: -100% 0; /* 移动到左侧 */
  }
}

/* eggyang 专属动画关键帧 */
@keyframes eggyang-gradient {
  0% {
    background-position: 0% 50%;
  }
  50% {
    background-position: 100% 50%;
  }
  100% {
    background-position: 0% 50%;
  }
}

@keyframes eggyang-pulse {
  0% {
    transform: scale(1);
  }
  100% {
    transform: scale(1.05); /* 减少缩放幅度，避免溢出 */
  }
}

@keyframes eggyang-glow {
  0% {
    filter: drop-shadow(0 0 10px rgba(255, 215, 0, 0.8)) drop-shadow(0 0 20px rgba(255, 215, 0, 0.6))
      drop-shadow(0 0 30px rgba(255, 215, 0, 0.4)) hue-rotate(0deg);
  }
  25% {
    filter: drop-shadow(0 0 15px rgba(255, 105, 180, 0.8)) drop-shadow(0 0 25px rgba(255, 105, 180, 0.6))
      drop-shadow(0 0 35px rgba(255, 105, 180, 0.4)) hue-rotate(90deg);
  }
  50% {
    filter: drop-shadow(0 0 20px rgba(0, 191, 255, 0.8)) drop-shadow(0 0 30px rgba(0, 191, 255, 0.6))
      drop-shadow(0 0 40px rgba(0, 191, 255, 0.4)) hue-rotate(180deg);
  }
  75% {
    filter: drop-shadow(0 0 15px rgba(50, 205, 50, 0.8)) drop-shadow(0 0 25px rgba(50, 205, 50, 0.6))
      drop-shadow(0 0 35px rgba(50, 205, 50, 0.4)) hue-rotate(270deg);
  }
  100% {
    filter: drop-shadow(0 0 10px rgba(255, 215, 0, 0.8)) drop-shadow(0 0 20px rgba(255, 215, 0, 0.6))
      drop-shadow(0 0 30px rgba(255, 215, 0, 0.4)) hue-rotate(360deg);
  }
}
</style>
