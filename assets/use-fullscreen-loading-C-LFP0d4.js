import{a$ as _,k as g,f as m,s as n,q as r,av as f,G as l,ae as y,y as d,h as E,_ as w}from"./vue-BjTWl3qY.js";const v={lock:!0,text:"加载中..."},p=(s,e={})=>{let a;return async(...c)=>{try{return a=_.service({...v,...e}),await s(...c)}finally{a.close()}}},x={code:0,data:{list:[]},message:"获取成功"};function C(s){return new Promise(e=>{setTimeout(()=>{e({...x,data:{list:s}})},1e3)})}function S(){return new Promise((s,e)=>{setTimeout(()=>{e(new Error("发生错误"))},1e3)})}const k={class:"app-container"},A=`
  <path class="path" d="
    M 30 15
    L 28 17
    M 25.61 25.61
    A 15 15, 0, 0, 1, 15 30
    A 15 15, 0, 1, 1, 27.99 7.5
    L 15 15
  " style="stroke-width: 4px; fill: rgba(0, 0, 0, 0)"/>
`,L=g({__name:"use-fullscreen-loading",setup(s){const e={text:"即将发生错误...",background:"#F56C6C20",svg:A,svgViewBox:"-10, -10, 50, 50"};async function a(){const o=await p(C)([1,2,3]);d.success(`${o.message}，传参为 ${o.data.list.toString()}`)}async function c(){try{await p(S,e)()}catch(o){d.error(o.message)}}return(o,t)=>{const i=f,u=y;return E(),m("div",k,[n(i,{shadow:"never"},{default:r(()=>t[0]||(t[0]=[l(" 该示例是演示：通过将要执行的函数传递给 composable，让 composable 自动开启全屏 loading，函数执行结束后自动关闭 loading ")])),_:1}),n(i,{header:"示例",shadow:"never"},{default:r(()=>[n(u,{type:"primary",onClick:a},{default:r(()=>t[1]||(t[1]=[l(" 查询成功 ")])),_:1}),n(u,{type:"danger",onClick:c},{default:r(()=>t[2]||(t[2]=[l(" 查询失败 ")])),_:1})]),_:1})])}}}),b=w(L,[["__scopeId","data-v-98343e93"]]);export{b as default};
