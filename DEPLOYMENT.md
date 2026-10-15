# Pandas Lab 部署说明

## 运行方式

GitHub 保存源码，Render 运行 Docker 容器。镜像首先构建 React 前端，再将 `dist/` 与 FastAPI / pandas 后端放在同一服务中。网页和 `/api` 同源，不依赖开发机、Vite 开发服务或本地 8000 端口。

## Render 免费演示部署

1. 登录 https://dashboard.render.com/ ，连接本项目的 GitHub 仓库。
2. 使用 **New → Blueprint** 选择该仓库，读取根目录 `render.yaml`。也可以新建 **Web Service**，选择 Docker。
3. 核对实例为 **Free**，健康检查路径为 `/api/health`；无需填写前端 API 地址。
4. 等待部署成功，打开 Render 返回的 `https://...onrender.com` 地址。实际地址以平台结果为准。
5. 打开示例，确认 96 行参考表、图表自动更新、筛选结果和中英文切换均正常。

本配置不创建付费数据库或磁盘。Render 免费实例空闲后可能休眠，重新打开时需要等待唤醒；临时文件会在重新部署、重启或休眠后丢失，请及时下载结果。示例数据由源码重新生成，不受影响。以 [Render 免费方案说明](https://render.com/docs/free) 为准。

## 数据隔离

容器默认 `PANDAS_LAB_SESSION_ISOLATION=1`，服务器用随机的 HttpOnly 会话 Cookie 将不同浏览器的数据存放到独立目录。知道另一个会话的数据版本 ID 也不能读取或修改它。Render 使用 HTTPS，并配置 `PANDAS_LAB_COOKIE_SECURE=1`。

此机制不提供账户登录或跨设备同步。清除 Cookie 后无法恢复原会话；课程演示建议使用随附的模拟数据。部署后不会携带本机 `data/` 内的上传文件、历史记录或报告。

## 环境变量

| 变量 | 作用 |
| --- | --- |
| `PORT` | 平台监听端口，默认 8000 |
| `PANDAS_LAB_DATA_DIR` | 运行时数据根目录，默认 `/app/data` |
| `PANDAS_LAB_SESSION_ISOLATION` | `1` 启用访客数据隔离；容器中默认开启 |
| `PANDAS_LAB_COOKIE_SECURE` | HTTPS 部署设为 `1`；本地 HTTP 不设置 |

保留单个 Uvicorn worker；当前文件版本存储尚未实现多进程写锁或横向扩容。

## 本地检查生产镜像

```sh
docker build -t pandas-lab .
docker run --rm -p 8000:8000 pandas-lab
```

访问 http://localhost:8000 。镜像不复制开发机的数据目录。GitHub Actions 会运行前端构建、后端测试、镜像构建、首页 / 健康接口 / 示例初始化检查。

## 更新

推送修改至 `main`，检查 GitHub Actions 结果并查看 Render 部署日志。不要将 `.env`、私钥、上传数据或本地输出目录提交到 GitHub。
