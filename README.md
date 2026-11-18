# 点亮地图 · 足迹地球

面向手机的共享旅行地球。单指旋转、双指缩放，点选多个地区后按「点亮」统一保存。原来的中国城市记录自动出现在地球上。[打开在线地图](https://biantai11523.github.io/light-up-china/)

## 使用

- 首页从中国朝向的完整地球开始。地图下方可搜索、放大、缩小或回到全球。键盘聚焦地球后也可使用方向键、加减键和 Home。
- 中国沿用原有 370 个点亮单元，包括地级市、直辖市、港澳等。海外使用一级行政区或数据源提供的整体地区。地球共 4,901 个可记录地区，分属 255 个国家和地区条目。
- 搜索支持中文名、收录的海外当地名或英文名、地区代码和当前分类的备注。可以组合输入国家和地名，如 `美国 California`。选择澳门等小地区时会直接放大到当地，区域还小时可点定位点。
- 顶部「一起」「轩宝」「曦宝」分别高亮对应足迹，再点当前分类进入完整视图。一起的记录自动计入两人，个人记录及备注独立。双色纹理表示两人分别去过。完整视图可查看各自的备注，选择分类后可编辑。
- 任何拿到网址的人都能编辑同一张地图，无需账号。多选可以跨国家、跨地区，已点亮的地方会自动跳过。保存后可撤销，同一地区发生并发修改会提示冲突。
- 「导出图片」按当前旋转角度、缩放和地名位置生成纯矢量 SVG 及高清 PNG。PNG 目标长边 4096 像素，上限 1200 万像素。使用说明里可以导出 JSON 备份，也可以进入独立的示例地图。

## 本地开发

需要 Node.js 24。

```sh
npm ci
npm run dev
```

本地开发默认使用同一云端共享 API，因此本地页面真实点亮也会改变 GitHub 在线地图。开发时如需隔离数据，请使用示例模式或设置 `VITE_API_URL` 指向自己的测试服务。

```sh
npm test
npm run build
npm run preview
```

前端使用 Vite、原生 WebGL、SVG 和 D3 地理投影。手机从本站加载字体、边界索引和概览网格，放大后按视野加载精细边界。运行时不请求第三方地图瓦片。

## 地球渲染

构建时对多边形及内环做三角剖分，用细分后的曲面网格跨越极区和日期变更线。Web Worker 解压几何并生成顶点、索引。全球视角合并批次，旋转时仅更新相机参数；点亮及分类通过独立的颜色表更新。精细分组和 GPU 缓冲均按最近使用情况回收。

保留原始多边形环用于点选与矢量导出。小地区由内部陆地点定位，地名根据缩放连续调整并避让。WebGL 不可用或上下文丢失时，页面使用同一相机和边界绘制可交互的 SVG 地球。

## 共享架构

GitHub Pages 提供静态页面。共同记录由 Sites 托管的 Cloudflare Worker + D1 保存，服务源代码在 `server/`。

- `GET /api/state`：共同记录和最近 50 次操作。
- `POST /api/session`：自动获得短期匿名会话，用户无需登录。
- `PUT /api/cities/:id`：按城市版本更新，使用操作 UUID 处理重复请求。
- `POST /api/cities/batch`：一次提交多个城市，整批版本检查、事务保存、幂等重试。
- `/api/profiles/xuan/cities/:id`、`/api/profiles/xi/cities/:id` 及对应 `/cities/batch` 保存个人记录。原 `/api/cities` 接口仍对应共同记录，兼容旧页面。
- `GET /api/state` 保留旧 `records` / `activity` 字段，同时返回三类独立的 `layers` 和带分类的 `activityAll`。个人记录使用独立内部键，不覆盖原共同记录，无需修改历史数据。
- 来源校验、服务端字段校验、匿名会话签名、访问频率限制。
- 数据修改不需要 GitHub 令牌，前端不含任何 GitHub 写入凭证。
- 每次点亮直接改变在线页面读取的共享数据，不会为每一次点亮生成 Git 提交。

匿名会话用于校验请求完整性和控制操作频率，不是身份验证。网站按要求允许所有访问者修改，称呼也由访客自行填写。公开链接并不构成隐私访问限制，请只记录愿意公开的内容。

正式 API：`https://light-up-china-shared-wtx.tingxuan9701.chatgpt.site`

后端发布工作区在本地 `backend/`，独立于 GitHub 源仓库；生成的 D1 迁移在 `server/migrations/` 保留副本。`SESSION_SECRET` 仅存储于服务端运行环境。

## 地图数据与再生成

- 中国边界来自[阿里云 DataV.GeoAtlas](https://datav.aliyun.com/portal/school/atlas/area_selector)。地区编号兼容原地图。澳门保留 `820000`，使用 Natural Earth 的陆地轮廓区分半岛、岛屿和海面。台湾沿用原来的整体记录。
- 海外使用 [Natural Earth Admin 1](https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-1-states-provinces/) 和 [Admin 0](https://www.naturalearthdata.com/downloads/10m-cultural-vectors/10m-admin-0-countries/) 的 1:10m 数据，固定版本 5.1.1。海外 ID 来自稳定的行政区代码。数据为版本快照，各地划分粒度有所不同。
- 已生成的数据随仓库发布，日常构建无需下载 GIS 源文件。重新生成时，先运行 `npm run data:fetch`，再在安装了 NumPy、Shapely 2、pyshp 和 mapbox-earcut 的 Python 环境中运行 `python scripts/build-earth.py`。更新地区清单后运行 `node scripts/prepare-backend.mjs`，同步服务端可记录地区列表。
- 项目代码采用 MIT 许可。Space Grotesk 使用 SIL OFL，见 `public/fonts/OFL.txt`。

## 验证

`npm test` 包含真实 SQLite 共享读写、跨地区多选、冲突与撤销、三类记录、球面投影和背面判定、拖动和双指缩放、澳门等小区域的几何与点选、GPU 几何缓冲复用，以及矢量与 PNG 导出。真实手机上的持续帧率和系统保存面板需在相应设备上验证。
