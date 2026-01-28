import type {
    ChannelDock,
    ChannelPlugin,
    ChannelOutboundAdapter,
    ClawdbotConfig,
} from "moltbot/plugin-sdk";
import {
    applyAccountNameToChannelSection,
    buildChannelConfigSchema,
    DEFAULT_ACCOUNT_ID,
    emptyPluginConfigSchema,
    migrateBaseNameToDefaultAccount,
    normalizeAccountId,
} from "moltbot/plugin-sdk";

import type { FeishuAccount, FeishuConfig } from "./types.js";
import { startFeishuMonitor } from "./monitor.js";
import { sendFeishuMessage, sendFeishuImageMessage, sendFeishuFileMessage, addFeishuReaction } from "./client.js";
import type { FeishuEmojiType } from "./types.js";
import { feishuOnboardingAdapter } from "./onboarding.js";
import { listFeishuAccountIds, resolveFeishuAccount, isFeishuConfigured } from "./accounts.js";

// Helper: strip feishu: and other prefixes from target
function normalizeFeishuTarget(to: string): string {
    return to.replace(/^feishu:/i, "").replace(/^(channel|group|user):/i, "");
}

// Outbound Adapter for message tool and CLI message send
export const feishuOutbound: ChannelOutboundAdapter = {
    deliveryMode: "direct",
    textChunkLimit: 2000,
    sendText: async ({ cfg, to, text, accountId }) => {
        console.log(`[feishu/outbound] sendText: to=${to}, text=${text.slice(0, 50)}...`);
        const account = resolveFeishuAccount({ cfg: cfg as ClawdbotConfig, accountId: accountId || "default" });
        const chatId = normalizeFeishuTarget(to);
        console.log(`[feishu/outbound] Sending text to chatId=${chatId}`);
        try {
            const res = await sendFeishuMessage({
                account,
                receiveId: chatId,
                msgType: "text",
                content: JSON.stringify({ text }),
            });
            console.log(`[feishu/outbound] Text sent successfully, messageId=${res?.message_id}`);
            return {
                channel: "feishu",
                messageId: res?.message_id,
                chatId: chatId,
            };
        } catch (err) {
            console.error(`[feishu/outbound] sendText failed:`, err);
            throw err;
        }
    },
    sendMedia: async ({ cfg, to, text, mediaUrl, accountId }) => {
        console.log(`[feishu/outbound] sendMedia: to=${to}, mediaUrl=${mediaUrl}, text=${text?.slice(0, 50) || "(none)"}`);
        const account = resolveFeishuAccount({ cfg: cfg as ClawdbotConfig, accountId: accountId || "default" });
        const chatId = normalizeFeishuTarget(to);
        console.log(`[feishu/outbound] sendMedia chatId=${chatId}`);

        try {
            // Send media if provided (local file path)
            if (mediaUrl) {
                const isLocalPath = !mediaUrl.startsWith("http://") && !mediaUrl.startsWith("https://");
                console.log(`[feishu/outbound] mediaUrl isLocalPath=${isLocalPath}`);
                if (isLocalPath) {
                    // Determine file type by extension
                    const ext = mediaUrl.toLowerCase().split(".").pop() || "";
                    const isImage = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "tiff", "ico"].includes(ext);
                    console.log(`[feishu/outbound] ext=${ext}, isImage=${isImage}`);

                    if (isImage) {
                        console.log(`[feishu/outbound] Uploading and sending image: ${mediaUrl}`);
                        const res = await sendFeishuImageMessage({
                            account,
                            receiveId: chatId,
                            imagePath: mediaUrl,
                        });
                        console.log(`[feishu/outbound] Image sent successfully, messageId=${res?.message_id}`);
                        // Also send text if provided
                        if (text) {
                            await sendFeishuMessage({
                                account,
                                receiveId: chatId,
                                msgType: "text",
                                content: JSON.stringify({ text }),
                            });
                        }
                        return {
                            channel: "feishu",
                            messageId: res?.message_id,
                            chatId: chatId,
                        };
                    } else {
                        // Send as file
                        const fileType = ["mp4", "mov", "avi", "mkv", "webm"].includes(ext) ? "mp4" as const
                            : ["mp3", "wav", "ogg", "opus", "m4a"].includes(ext) ? "opus" as const
                            : ["pdf"].includes(ext) ? "pdf" as const
                            : ["doc", "docx"].includes(ext) ? "doc" as const
                            : ["xls", "xlsx"].includes(ext) ? "xls" as const
                            : ["ppt", "pptx"].includes(ext) ? "ppt" as const
                            : "stream" as const;

                        console.log(`[feishu/outbound] Uploading and sending file: ${mediaUrl}, type=${fileType}`);
                        const res = await sendFeishuFileMessage({
                            account,
                            receiveId: chatId,
                            filePath: mediaUrl,
                            fileType,
                        });
                        console.log(`[feishu/outbound] File sent successfully, messageId=${res?.message_id}`);
                        // Also send text if provided
                        if (text) {
                            await sendFeishuMessage({
                                account,
                                receiveId: chatId,
                                msgType: "text",
                                content: JSON.stringify({ text }),
                            });
                        }
                        return {
                            channel: "feishu",
                            messageId: res?.message_id,
                            chatId: chatId,
                        };
                    }
                }
            }

            // Fallback: just send text
            if (text) {
                console.log(`[feishu/outbound] sendMedia fallback: sending text only`);
                const res = await sendFeishuMessage({
                    account,
                    receiveId: chatId,
                    msgType: "text",
                    content: JSON.stringify({ text }),
                });
                console.log(`[feishu/outbound] Text sent successfully, messageId=${res?.message_id}`);
                return {
                    channel: "feishu",
                    messageId: res?.message_id,
                    chatId: chatId,
                };
            }

            console.log(`[feishu/outbound] sendMedia: no media or text to send`);
            return { channel: "feishu", chatId: chatId };
        } catch (err) {
            console.error(`[feishu/outbound] sendMedia failed:`, err);
            throw err;
        }
    },
};

// Dock Definition
export const feishuDock: ChannelDock = {
    id: "feishu",
    capabilities: {
        chatTypes: ["direct", "group"],
        reactions: true, // Supports emoji reactions on messages
        media: true, // Supports image/file/audio/video messages
        threads: false, // Pending implementation
        blockStreaming: true,
    },
    outbound: { textChunkLimit: 2000 }, // Feishu limit is usually ~4k chars, safely 2k
    config: {
        resolveAllowFrom: () => [],
        formatAllowFrom: () => [],
    }
};

// Plugin Definition
export const feishuPlugin: ChannelPlugin<FeishuAccount> = {
    id: "feishu",
    meta: {
        id: "feishu",
        label: "Feishu",
        blurb: "Feishu/Lark Workspace",
        docsPath: "/channels/feishu",
    },
    onboarding: feishuOnboardingAdapter,
    capabilities: {
        chatTypes: ["direct", "group"],
        reactions: true, // Supports emoji reactions on messages
        media: true, // Supports image/file/audio/video messages
        threads: false,
        nativeCommands: false,
        blockStreaming: true,
    },
    configSchema: emptyPluginConfigSchema(),
    config: {
        listAccountIds: (cfg) => listFeishuAccountIds(cfg as ClawdbotConfig),
        resolveAccount: (cfg, accountId) => resolveFeishuAccount({ cfg: cfg as ClawdbotConfig, accountId }),
        defaultAccountId: () => "default",
        isConfigured: (account) => isFeishuConfigured(account),
        describeAccount: (account) => ({
            accountId: account.accountId,
            name: account.name,
            enabled: account.enabled,
            configured: Boolean(account.config.appId && account.config.appSecret),
        }),
    },
    gateway: {
        startAccount: async (ctx) => {
            ctx.log?.info(`[${ctx.account.accountId}] Starting Feishu monitor...`);
            const monitor = await startFeishuMonitor({
                account: ctx.account,
                config: ctx.cfg as ClawdbotConfig,
                runtime: ctx.runtime,
                statusSink: (patch) => ctx.setStatus({ accountId: ctx.account.accountId, ...patch }),
            });
            ctx.setStatus({ accountId: ctx.account.accountId, running: true });

            return () => {
                monitor.stop().catch(console.error);
                ctx.setStatus({ accountId: ctx.account.accountId, running: false });
            };
        },
    },
    // Top-level outbound adapter for message tool and CLI message send
    outbound: feishuOutbound,
    messaging: {
        // Normalize target by stripping feishu: and other prefixes
        normalizeTarget: (raw: string): string | undefined => {
            const trimmed = raw.trim();
            // Strip feishu: prefix, then channel/group/user prefix
            const stripped = trimmed
                .replace(/^feishu:/i, "")
                .replace(/^(channel|group|user):/i, "");
            return stripped || undefined;
        },
        // Recognize Feishu-style IDs (oc_ for chats, ou_ for users, etc.)
        targetResolver: {
            looksLikeId: (raw: string) => {
                const trimmed = raw.trim();
                // Strip feishu: prefix first, then other prefixes
                const stripped = trimmed
                    .replace(/^feishu:/i, "")
                    .replace(/^(channel|group|user):/i, "");
                // Feishu IDs: oc_ (chat), ou_ (open_id), on_ (union_id), cli_ (app)
                // Format is prefix + alphanumeric string (length varies, typically 20-40 chars)
                if (/^oc_[a-z0-9]+$/i.test(stripped)) return true;
                if (/^ou_[a-z0-9]+$/i.test(stripped)) return true;
                if (/^on_[a-z0-9]+$/i.test(stripped)) return true;
                return false;
            },
            hint: "Use a Feishu chat ID (oc_...) or user ID (ou_...)",
        },
        outbound: {
            sendText: async ({ cfg, to, text, accountId }: { cfg: ClawdbotConfig, to: string, text: string, accountId?: string }) => {
                console.log(`[feishu] sendText called: to=${to}, text=${text.slice(0, 50)}...`);
                const account = feishuPlugin.config.resolveAccount(cfg, accountId || "default");
                // Strip feishu: and channel/group/user prefixes
                const chatId = to.replace(/^feishu:/i, "").replace(/^(channel|group|user):/i, "");
                console.log(`[feishu] Sending text to chatId=${chatId}`);
                try {
                    const res = await sendFeishuMessage({
                        account,
                        receiveId: chatId,
                        msgType: "text",
                        content: JSON.stringify({ text }),
                    });
                    console.log(`[feishu] Text sent successfully, messageId=${res?.message_id}`);
                    return {
                        channel: "feishu",
                        messageId: res?.message_id,
                        chatId: chatId,
                    };
                } catch (err) {
                    console.error(`[feishu] sendText failed:`, err);
                    throw err;
                }
            },
            sendMedia: async ({ cfg, to, text, mediaUrl, accountId }: { cfg: ClawdbotConfig, to: string, text?: string, mediaUrl?: string, accountId?: string }) => {
                console.log(`[feishu] sendMedia called: to=${to}, mediaUrl=${mediaUrl}, text=${text?.slice(0, 50) || "(none)"}`);
                const account = feishuPlugin.config.resolveAccount(cfg, accountId || "default");
                // Strip feishu: and channel/group/user prefixes
                const chatId = to.replace(/^feishu:/i, "").replace(/^(channel|group|user):/i, "");
                console.log(`[feishu] sendMedia chatId=${chatId}`);

                try {
                    // Send media if provided (local file path)
                    if (mediaUrl) {
                        const isLocalPath = !mediaUrl.startsWith("http://") && !mediaUrl.startsWith("https://");
                        console.log(`[feishu] mediaUrl isLocalPath=${isLocalPath}`);
                        if (isLocalPath) {
                            // Determine file type by extension
                            const ext = mediaUrl.toLowerCase().split(".").pop() || "";
                            const isImage = ["jpg", "jpeg", "png", "gif", "webp", "bmp", "tiff", "ico"].includes(ext);
                            console.log(`[feishu] ext=${ext}, isImage=${isImage}`);

                            if (isImage) {
                                console.log(`[feishu] Uploading and sending image: ${mediaUrl}`);
                                const res = await sendFeishuImageMessage({
                                    account,
                                    receiveId: chatId,
                                    imagePath: mediaUrl,
                                });
                                console.log(`[feishu] Image sent successfully, messageId=${res?.message_id}`);
                                // Also send text if provided
                                if (text) {
                                    await sendFeishuMessage({
                                        account,
                                        receiveId: chatId,
                                        msgType: "text",
                                        content: JSON.stringify({ text }),
                                    });
                                }
                                return {
                                    channel: "feishu",
                                    messageId: res?.message_id,
                                    chatId: chatId,
                                };
                            } else {
                                // Send as file
                                const fileType = ["mp4", "mov", "avi", "mkv", "webm"].includes(ext) ? "mp4" as const
                                    : ["mp3", "wav", "ogg", "opus", "m4a"].includes(ext) ? "opus" as const
                                    : ["pdf"].includes(ext) ? "pdf" as const
                                    : ["doc", "docx"].includes(ext) ? "doc" as const
                                    : ["xls", "xlsx"].includes(ext) ? "xls" as const
                                    : ["ppt", "pptx"].includes(ext) ? "ppt" as const
                                    : "stream" as const;

                                console.log(`[feishu] Uploading and sending file: ${mediaUrl}, type=${fileType}`);
                                const res = await sendFeishuFileMessage({
                                    account,
                                    receiveId: chatId,
                                    filePath: mediaUrl,
                                    fileType,
                                });
                                console.log(`[feishu] File sent successfully, messageId=${res?.message_id}`);
                                // Also send text if provided
                                if (text) {
                                    await sendFeishuMessage({
                                        account,
                                        receiveId: chatId,
                                        msgType: "text",
                                        content: JSON.stringify({ text }),
                                    });
                                }
                                return {
                                    channel: "feishu",
                                    messageId: res?.message_id,
                                    chatId: chatId,
                                };
                            }
                        }
                    }

                    // Fallback: just send text
                    if (text) {
                        console.log(`[feishu] sendMedia fallback: sending text only`);
                        const res = await sendFeishuMessage({
                            account,
                            receiveId: chatId,
                            msgType: "text",
                            content: JSON.stringify({ text }),
                        });
                        console.log(`[feishu] Text sent successfully, messageId=${res?.message_id}`);
                        return {
                            channel: "feishu",
                            messageId: res?.message_id,
                            chatId: chatId,
                        };
                    }

                    console.log(`[feishu] sendMedia: no media or text to send`);
                    return { channel: "feishu", chatId: chatId };
                } catch (err) {
                    console.error(`[feishu] sendMedia failed:`, err);
                    throw err;
                }
            }
        }
    },
    setup: {
        resolveAccountId: ({ accountId }: { accountId: string }) => normalizeAccountId(accountId),
        applyAccountName: ({ cfg, accountId, name }: { cfg: ClawdbotConfig, accountId: string, name: string }) =>
            applyAccountNameToChannelSection({
                cfg: cfg as ClawdbotConfig,
                channelKey: "feishu",
                accountId,
                name,
            }),
        validateInput: ({ accountId, input }: { accountId: string, input: any }) => {
            if (!input.appId || !input.appSecret) {
                return "Feishu requires --app-id and --app-secret.";
            }
            return null;
        },
        applyAccountConfig: ({ cfg, accountId, input }: { cfg: ClawdbotConfig, accountId: string, input: any }) => {
            const namedConfig = applyAccountNameToChannelSection({
                cfg: cfg as ClawdbotConfig,
                channelKey: "feishu",
                accountId,
                name: input.name,
            });

            const next = accountId !== DEFAULT_ACCOUNT_ID
                ? migrateBaseNameToDefaultAccount({
                    cfg: namedConfig as ClawdbotConfig,
                    channelKey: "feishu",
                })
                : namedConfig;

            const configPatch = {
                ...(input.appId ? { appId: input.appId } : {}),
                ...(input.appSecret ? { appSecret: input.appSecret } : {}),
                ...(input.encryptKey ? { encryptKey: input.encryptKey } : {}),
                ...(input.verificationToken ? { verificationToken: input.verificationToken } : {}),
            };

            if (accountId === DEFAULT_ACCOUNT_ID) {
                return {
                    ...next,
                    channels: {
                        ...next.channels,
                        "feishu": {
                            ...(next.channels?.["feishu"] ?? {}),
                            enabled: true,
                            ...configPatch,
                        },
                    },
                } as ClawdbotConfig;
            }

            return {
                ...next,
                channels: {
                    ...next.channels,
                    "feishu": {
                        ...(next.channels?.["feishu"] ?? {}),
                        enabled: true,
                        accounts: {
                            ...(next.channels?.["feishu"]?.accounts ?? {}),
                            [accountId]: {
                                ...(next.channels?.["feishu"]?.accounts?.[accountId] ?? {}),
                                enabled: true,
                                ...configPatch,
                            },
                        },
                    },
                },
            } as ClawdbotConfig;
        },
    }
};
