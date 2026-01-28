# Feishu Extension for Moltbot

This extension allows Moltbot to integrate with Feishu (Lark), enabling it to send and receive messages within your Feishu organization.

## Configuration

To use this extension, you need to configure it with credentials from the Feishu Open Platform.

### Prerequisites

1.  A Feishu (Lark) account and an organization.
2.  Access to the [Feishu Open Platform](https://open.feishu.cn/app?lang=en-US).

### Quick Start

You can interactively configure this extension using the CLI:

```bash
pnpm moltbot channels add feishu
```

This wizard will guide you through entering the required credentials.

### Features

*   **Send & Receive Text Messages**: Supports sending and receiving text messages in direct chats and group chats.
*   **Send & Receive Media**: Supports images, files, audio, and video messages.
    *   Inbound: Downloads and processes media attachments from users.
    *   Outbound: Uploads and sends images and files in replies.
*   **Emoji Reactions**: Supports adding emoji reactions to messages (e.g., 👀 for ack).
*   **Multi-Account Support**: Configure multiple Feishu bots/accounts.

### Step-by-Step Configuration Guide

1.  **Create a Feishu Application:**
    *   Log in to the [Feishu Open Platform](https://open.feishu.cn/app?lang=en-US).
    *   Create a specific "Enterprise Self-Built App" for your bot.

2.  **Get App Credentials:**
    *   Navigate to **Credentials & Basic Info**.
    *   Copy the **App ID** and **App Secret**. These correspond to `appId` and `appSecret` in the configuration.

3.  **Configure Event Subscriptions:**
    *   Navigate to **Event Subscriptions**.
    *   Set the **Encrypt Key** (Optional, but recommended).
    *   Set the **Verification Token** (Optional).
    *   Set the Request URL to your bot's endpoint (e.g., `https://your-bot-domain.com/api/feishu`).
    *   **Add Events**: Search for and add the following event:
        *   `im.message.receive_v1` (Receive messages)

4.  **Add Permissions:**
    *   Navigate to **Permissions & Scopes** (权限管理).
    *   Search and add the following permissions:
        *   `im:message` - 获取与发送单聊、群组消息（包括下载消息中的资源文件）
        *   `im:message:send_as_bot` - 以应用的身份发送消息
        *   `im:chat` 或 `im:chat:readonly` - 获取群组信息
        *   `im:resource` - 上传图片和文件（发送媒体消息需要）
        *   `im:message.reaction:write` - 添加消息表情回复（表情回复需要）
        *   **Group messages** (choose as needed):
            *   `im:message.group_at_msg:readonly` - **Only receive group messages that @mention the bot** (common; avoids reacting to every group message)
            *   To receive all group messages, search for "group message" / "receive message" permissions in the Feishu console and add as per current docs
        *   **P2P**: Direct messages to the bot are typically covered by the above `im:message` permissions
    *   **Important**: Create and publish a version of your app to apply these permissions.

5.  **Enable Bot Capability:**
    *   Navigate to **App Capabilities** -> **Bot**.
    *   Enable the bot capability.

### Configuration Example

Add the following to your `moltbot` configuration (e.g., in `moltbot.config.json` or via environment variables):

```json
{
  "extensions": {
    "feishu": {
      "appId": "cli_...",
      "appSecret": "...",
      "encryptKey": "...",        // Optional: Required if encryption is enabled
      "verificationToken": "..."  // Optional: Required for event verification
    }
  }
}
```

> [!NOTE]
> `encryptKey` and `verificationToken` are **optional** for basic bot functionality (sending messages). However, they are **required** if you want to:
> *   Receive events securely (verify the source).
> *   Have enabled **Encrypt Key** in the Feishu Event Subscriptions settings.

### Multi-Account Configuration

If you need to configure multiple Feishu bots, you can use the accounts structure:

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

## Troubleshooting

### Bot not receiving messages

1.  **Check Event Subscription URL**: Ensure the Request URL is correctly configured and accessible from Feishu servers.
2.  **Verify Event Subscription**: Make sure `im.message.receive_v1` event is added and the app version is published.
3.  **Check Permissions**: Ensure all required permissions are granted and the app version is published.
4.  **Review Logs**: Check Moltbot logs for connection errors or event processing issues.

### Authentication errors

1.  **Verify Credentials**: Double-check that `appId` and `appSecret` are correct.
2.  **Check App Status**: Ensure the app is enabled and not suspended in Feishu Open Platform.

### Encryption/Verification errors

1.  **Match Configuration**: Ensure `encryptKey` and `verificationToken` in your config match exactly what's set in Feishu Event Subscriptions.
2.  **Optional Fields**: If you haven't enabled encryption in Feishu, you can leave these fields empty.

## Supported Media Types

### Inbound (Receiving)
| Type | Supported | Notes |
|------|-----------|-------|
| Text | ✅ | Full support |
| Image | ✅ | Downloaded and processed |
| File | ✅ | Downloaded and processed |
| Audio | ✅ | Downloaded and processed |
| Video (media) | ✅ | Downloaded and processed |
| Sticker | ✅ | Downloaded as image |
| Post (rich text) | ⚠️ | Displayed as placeholder |
| Interactive (cards) | ⚠️ | Displayed as placeholder |

### Outbound (Sending)
| Type | Supported | Notes |
|------|-----------|-------|
| Text | ✅ | Full support |
| Image | ✅ | PNG, JPEG, GIF, WebP, etc. (max 10MB) |
| File | ✅ | PDF, DOC, XLS, PPT, etc. (max 30MB) |
| Audio | ✅ | mp3, wav, ogg, opus, m4a format (max 30MB) |
| Video | ✅ | MP4 format (max 30MB) |

## Current Limitations

*   **Reactions**: Message reactions are not yet supported.
*   **Threads**: Message threads are not yet supported.
*   **Remote URLs**: Sending media from remote URLs requires downloading first (local files are preferred).
*   **Rich Text Posts**: Sending rich text (post) messages is not yet supported.

## Resources

*   [Feishu Open Platform Documentation](https://open.feishu.cn/document/home/index)
*   [Feishu Bot Development Guide](https://open.feishu.cn/document/home/develop-a-bot-in-5-minutes/create-an-app)

## Acknowledgments

This project is based on [tomatoxman/moltbot](https://github.com/tomatoxman/moltbot/tree/feat/feishu-integration) and has been modified and optimized. Thanks to the original author for their contributions!