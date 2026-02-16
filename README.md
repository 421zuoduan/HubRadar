# HubRadar

HubRadar 是一个面向 Android 的城市交通枢纽通达度对比应用（Expo + React Native + TypeScript）。

用户可以从“当前位置”或“指定地点”出发，查询附近的：
- 地铁站
- 火车站
- 机场

并对比主动出行（步行/骑行）、公共交通、开车三种方式的耗时，按综合通达度排序展示。

## 主要功能
- 当前位置查询与指定地点查询
- 地址候选联想（输入提示 + 关键词搜索回退）
- 三种通勤方式时长对比
- 交通枢纽卡片展开查看公交换乘步骤
- 详情页查看到达时间、换乘次数、多时段对比
- 智能建议（如机场/高铁优先建议）
- 城市策略（不同城市使用不同权重）
- 查询历史记录（本地缓存）
- 设置面板（步行/骑行偏好、计划出发时间）

## 技术栈
- Expo Managed Workflow
- React Native + TypeScript
- NativeWind
- 高德 Web 服务 API（POI 搜索、路径规划、逆地理编码、输入提示）

## 目录结构
- `App.tsx`：主界面与交互编排
- `src/features/hub-search/services/amap.ts`：周边枢纽查询
- `src/features/commute/services/amapDirection.ts`：通勤耗时计算
- `src/features/location/services/amapInputTips.ts`：地址候选联想
- `src/features/location/services/amapRegeo.ts`：逆地理编码与城市识别
- `src/features/insight/services/scoring.ts`：评分与智能建议
- `src/features/history/services/queryHistory.ts`：历史记录存储

## 快速开始
1. 安装依赖：
```bash
npm install
```

2. 配置环境变量（在项目根目录创建 `.env`）：
```env
EXPO_PUBLIC_AMAP_WEB_KEY=你的高德Web服务Key
EXPO_PUBLIC_AMAP_SECURITY_JSCODE=可选
```

3. 启动开发服务：
```bash
npm run start -- --tunnel -c --port 8106
```

4. 安卓手机打开 Expo Go，扫码运行。

## 常用命令
- `npm run start`：启动开发服务
- `npm run android`：运行 Android
- `npm run web`：运行 Web 预览
- `npx tsc --noEmit`：TypeScript 类型检查

## 说明
- 当前版本优先适配 Android 真机调试。
- 路线结果会受实时路况、时段和高德数据更新影响。
- 生产环境建议通过后端代理高德接口，避免敏感信息暴露。
