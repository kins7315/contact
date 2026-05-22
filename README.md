# 极简图生图模型

一个首版聚焦的全栈项目：用户注册登录后上传参考图，输入提示词，调用 OpenAI 图像编辑接口生成新图。

## 技术栈

- 前端：Vue 3 + TypeScript + Vite
- 后端：NestJS + Prisma
- 数据库：SQLite
- 图像模型：默认 `gpt-image-1.5`，可通过环境变量覆盖为你账号可用的模型名

## 启动

```bash
npm install
npm run prisma:generate
npm run prisma:migrate
npm run dev
```

创建 `apps/api/.env`：

```env
DATABASE_URL="file:./dev.db"
SESSION_SECRET="replace-with-a-long-random-secret"
OPENAI_API_KEY="sk-..."
OPENAI_IMAGE_MODEL="gpt-image-1.5"
WEB_ORIGIN="http://localhost:5173"
PORT=3000
```

打开前端：

```text
http://localhost:5173
```

## 首版能力

- 用户名密码注册、登录、退出
- 当前登录用户检查
- 图片上传 + 提示词图生图
- 生成中、失败提示、结果预览和下载
- 生成记录最小保存：用户、原图地址、提示词、结果图地址、创建时间
