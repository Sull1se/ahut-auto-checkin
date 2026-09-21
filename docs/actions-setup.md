# GitHub Actions 云端自动签到部署指南

本项目通过 GitHub Actions 实现永久免费、零服务器成本的无人值守晚寝自动签到。工作流预设于北京时间每晚 **21:31:00**（UTC 13:31）准时启动并自动执行打卡。

---

## 一、配置 GitHub Secrets（加密凭据）

所有账号密码与通知密钥全部存储在 GitHub 专属机密保险箱中，绝不暴露在代码或日志中。

1. 打开您 Fork 或新建的本 GitHub 仓库页面；
2. 点击仓库顶部的 **Settings** 选项卡；
3. 在左侧侧边栏中找到 **Secrets and variables** ➔ 点击 **Actions**；
4. 点击绿色的 **New repository secret** 按钮，逐一添加以下变量：

| 变量名 | 必填/选填 | 说明与示例 |
| :--- | :---: | :--- |
| `STUDENT_IDS` | **必填** | 统一身份认证学号。单人直接填 `2100000000`；多人签到用英文分号分隔：`2100000001;2100000002` |
| `PASSWORDS` | 选填 | 登录密码。留空默认使用系统初始密码 `Ahgydx@920`；若修改过密码或多人不同密码，用分号对应分隔：`pwd1;pwd2` |
| `SERVERCHAN_SENDKEY` | 选填 | [Server酱·Turbo版](https://sct.ftqq.com/) 的 SendKey，用于每晚将签到成功/失败报表推送至微信公众号 |
| `NTFY_TOPIC` | 选填 | [ntfy.sh](https://ntfy.sh) 自定义专属频道名（如 `ahut_sign_alert_mysecret`），**仅在签到失败时触发高优先级夜间免打扰穿透响铃** |

---

## 二、启用与手动测试工作流

1. 进入仓库顶部的 **Actions** 选项卡；
2. 如果看到提示 *"Workflows aren't being run on this forked repository"*，点击绿色按钮 **"I understand my workflows, go ahead and enable them"** 启用 Actions；
3. 在左侧工作流列表中选择 **`Daily Check-In`**；
4. 点击右侧的 **Run workflow** 下拉菜单，点击绿色的 **Run workflow** 按钮即可立即手动触发一次执行；
5. 点击正在运行的任务查看实时日志，确认是否成功登录、提取当期 TaskID 并完成打卡。

---

## 三、运行机制与特性说明

- **定时触发**：工作流配置了每晚北京时间 21:31（UTC 13:31）定时执行打卡逻辑；
- **智能状态核验**：脚本执行时会动态拉取当期有效考勤任务，若当日已经完成打卡，将直接记录状态并推送报表，不会产生多余的重复提交；
- **分级通知**：日常签到详细报表通过 Server 酱推送到微信；若出现网络异常或打卡受阻，可通过 ntfy 触发高优先级免打扰穿透响铃。
