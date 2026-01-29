# Moltbot 飞书扩展

此扩展使 Moltbot 能够与飞书（Lark）集成，实现在飞书组织内发送和接收消息。

## 配置

要使用此扩展，您需要配置来自飞书开放平台的凭证。

### 前置条件

1.  飞书（Lark）账户和组织。
2.  访问[飞书开放平台](https://open.feishu.cn/app?lang=en-US)。

### 快速开始

您可以使用 CLI 交互式配置此扩展：

```bash
pnpm moltbot channels add
```

此向导将引导您输入所需的凭证。

### 功能特性

*   **发送和接收文本消息**：支持在单聊和群聊中发送和接收文本消息。
*   **发送和接收媒体**：支持图片、文件、音频和视频消息。
    *   接收：下载并处理用户发送的媒体附件。
    *   发送：在回复中上传和发送图片及文件。
*   **表情回复**：支持添加消息表情回复（如 👀 表示正在处理）。
*   **多账户支持**：配置多个飞书机器人/账户。

### 分步配置指南

1.  **创建飞书应用：**
    *   登录[飞书开放平台](https://open.feishu.cn/app?lang=en-US)。
    *   为您的机器人创建一个特定的企业自建应用。

2.  **获取应用凭证：**
    *   导航到**凭证与基础信息**。
    *   复制**应用 ID**和**应用密钥**。这些对应配置中的 `appId` 和 `appSecret`。

3.  **配置事件订阅：**
    *   导航到**事件订阅**。
    *   设置**加密密钥**（可选，但建议启用）。
    *   设置**验证令牌**（可选）。
    *   设置为WebSocket长连接
    *   **添加事件**：搜索并添加以下事件：
        *   `im.message.receive_v1`（接收消息）

4.  **添加权限：**
- 导航到权限管理，搜索并添加以下权限：
    - `im:message` 获取与发送单聊、群组消息（包括下载消息中的资源文件）
    - `im:message.group_at_msg:readonly` 接收群聊中@机器人消息事件
    - `im:message:send_as_bot` 以应用的身份发送消息
    - `im:chat` 获取群组信息
    - `im:resource` 上传图片和文件（发送媒体消息需要）
    - `im:message.reaction:write` 添加消息表情回复（表情回复需要）
> 重要⚠️：创建并发布应用版本以应用这些权限。

5.  **启用机器人能力：**
    *   导航到**应用能力** -> **机器人**。
    *   启用机器人能力。

### 配置示例

将以下内容添加到您的 `moltbot` 配置中（例如在 `moltbot.config.json` 中或通过环境变量）：

```json
{
  "channels": {
    "feishu": {
      "appId": "cli_...",
      "appSecret": "...",
      "encryptKey": "...",        // 可选：如果启用了加密则需要
      "verificationToken": "..."  // 可选：用于事件验证
    }
  }
}
```

> [!NOTE]
> `encryptKey` 和 `verificationToken` 对于基本的机器人功能（发送消息）是**可选的**。但是，如果您想要以下功能，则**必须提供**：
> *   安全地接收事件（验证来源）。
> *   在飞书事件订阅设置中启用了**加密密钥**。

### 多账户配置

如果您需要配置多个飞书机器人，可以使用账户结构：

```json
{
  "channels": {
    "feishu": {
      "enabled": true,
      "accounts": {
        "default": {
          "enabled": true,
          "appId": "cli_xxx",
          "appSecret": "xxx",
          "encryptKey": "xxx",
          "verificationToken": "xxx"
        },
        "team-bot": {
          "enabled": true,
          "name": "Team Bot",
          "appId": "cli_yyy",
          "appSecret": "yyy",
          "encryptKey": "yyy",
          "verificationToken": "yyy"
        }
      }
    }
  }
}
```

## 故障排除

### 机器人无法接收消息

1.  **检查事件订阅 URL**：确保请求 URL 配置正确，且可从飞书服务器访问。
2.  **验证事件订阅**：确保 `im.message.receive_v1` 事件已添加，且应用版本已发布。
3.  **检查权限**：确保所有必需权限已授予，且应用版本已发布。
4.  **查看日志**：检查 Moltbot 日志中是否有连接错误或事件处理问题。

### 身份验证错误

1.  **验证凭证**：仔细检查 `appId` 和 `appSecret` 是否正确。
2.  **检查应用状态**：确保应用在飞书开放平台中已启用且未被暂停。

### 加密/验证错误

1.  **匹配配置**：确保配置中的 `encryptKey` 和 `verificationToken` 与飞书事件订阅中的设置完全一致。
2.  **可选字段**：如果您未在飞书中启用加密，可以将这些字段留空。

## 支持的媒体类型

### 接收（入站）
| 类型 | 支持 | 备注 |
|------|------|------|
| 文本 | ✅ | 完全支持 |
| 图片 | ✅ | 下载并处理 |
| 文件 | ✅ | 下载并处理 |
| 音频 | ✅ | 下载并处理 |
| 视频（media） | ✅ | 下载并处理 |
| 表情包 | ✅ | 作为图片下载 |
| 富文本（post） | ⚠️ | 显示为占位符 |
| 交互卡片 | ⚠️ | 显示为占位符 |

### 发送（出站）
| 类型 | 支持 | 备注 |
|------|------|------|
| 文本 | ✅ | 完全支持 |
| 图片 | ✅ | PNG、JPEG、GIF、WebP 等（最大 10MB） |
| 文件 | ✅ | PDF、DOC、XLS、PPT 等（最大 30MB） |
| 音频 | ✅ | mp3、wav、ogg、opus、m4a 格式 （最大 30MB）|
| 视频 | ✅ | MP4 格式 （最大 30MB）|

## 当前限制

*   **反应**：消息反应尚未支持。
*   **线程**：消息线程尚未支持。
*   **远程 URL**：从远程 URL 发送媒体需要先下载（优先使用本地文件）。
*   **富文本消息**：发送富文本（post）消息尚未支持。

## 资源

*   [飞书开放平台文档](https://open.feishu.cn/document/home/index)
*   [飞书机器人开发指南](https://open.feishu.cn/document/home/develop-a-bot-in-5-minutes/create-an-app)

## 诚挚感谢💗💗💗
项目基于 [tomatoxman/moltbot](https://github.com/tomatoxman/moltbot/tree/feat/feishu-integration) 的飞书扩展，进行了修改和优化。感谢原作者的开源贡献！💗💗💗