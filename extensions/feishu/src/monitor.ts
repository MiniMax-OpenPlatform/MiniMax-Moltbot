import * as lark from "@larksuiteoapi/node-sdk";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import * as crypto from "node:crypto";
import type { ClawdbotConfig } from "moltbot/plugin-sdk";

import { sendFeishuMessage, sendFeishuImageMessage, sendFeishuFileMessage, downloadFeishuMessageResource, addFeishuReaction, getFeishuMessage } from "./client.js";
import type {
    FeishuAccount,
    FeishuMessageEvent,
    FeishuImageContent,
    FeishuFileContent,
    FeishuAudioContent,
    FeishuMediaContent,
    FeishuStickerContent,
    FeishuEmojiType,
} from "./types.js";
import { getFeishuRuntime } from "./runtime.js";

export type FeishuRuntimeEnv = {
    log?: (message: string) => void;
    error?: (message: string) => void;
};

/** Map file extension to media kind for context */
function resolveMediaKind(ext: string): "image" | "audio" | "video" | "document" {
    const lower = ext.toLowerCase();
    if ([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".tiff", ".ico"].includes(lower)) return "image";
    if ([".mp3", ".wav", ".ogg", ".opus", ".m4a", ".aac", ".flac"].includes(lower)) return "audio";
    if ([".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v"].includes(lower)) return "video";
    return "document";
}

/** Get file extension for known message types */
function getExtensionForMsgType(msgType: string, fileName?: string): string {
    if (fileName) {
        const ext = path.extname(fileName);
        if (ext) return ext;
    }
    switch (msgType) {
        case "image": return ".png";
        case "audio": return ".opus";
        case "media": return ".mp4";
        case "sticker": return ".png";
        default: return ".bin";
    }
}

/** Download media from a Feishu message and save to temp file */
async function downloadAndSaveMedia(params: {
    account: FeishuAccount;
    messageId: string;
    fileKey: string;
    msgType: string;
    fileName?: string;
    runtime: FeishuRuntimeEnv;
}): Promise<{ path: string; mime?: string; kind: string } | null> {
    const { account, messageId, fileKey, msgType, fileName, runtime } = params;

    try {
        const type = msgType === "image" || msgType === "sticker" ? "image" : "file";
        const buffer = await downloadFeishuMessageResource({
            account,
            messageId,
            fileKey,
            type,
        });

        const ext = getExtensionForMsgType(msgType, fileName);
        const tempPath = path.join(os.tmpdir(), `feishu-media-${crypto.randomUUID()}${ext}`);
        await fs.writeFile(tempPath, buffer);

        const kind = resolveMediaKind(ext);
        runtime.log?.(`[feishu] Downloaded media: ${tempPath} (${buffer.length} bytes, kind: ${kind})`);

        return { path: tempPath, kind };
    } catch (err) {
        runtime.error?.(`[feishu] Failed to download media ${fileKey}: ${err}`);
        return null;
    }
}

/** Parse media content based on message type */
function parseMediaContent(msgType: string, contentStr: string): { fileKey?: string; imageKey?: string; fileName?: string } | null {
    try {
        const content = JSON.parse(contentStr);
        switch (msgType) {
            case "image": {
                const img = content as FeishuImageContent;
                return { imageKey: img.image_key, fileKey: img.image_key };
            }
            case "file": {
                const file = content as FeishuFileContent;
                return { fileKey: file.file_key, fileName: file.file_name };
            }
            case "audio": {
                const audio = content as FeishuAudioContent;
                return { fileKey: audio.file_key };
            }
            case "media": {
                const media = content as FeishuMediaContent;
                return { fileKey: media.file_key, imageKey: media.image_key, fileName: media.file_name };
            }
            case "sticker": {
                const sticker = content as FeishuStickerContent;
                return { fileKey: sticker.file_key };
            }
            default:
                return null;
        }
    } catch {
        return null;
    }
}

/** Send an ack reaction to indicate message is being processed */
async function maybeSendAckReaction(params: {
    account: FeishuAccount;
    messageId: string;
    emojiType?: FeishuEmojiType;
    runtime: FeishuRuntimeEnv;
}): Promise<void> {
    const { account, messageId, emojiType = "EYES", runtime } = params;
    if (!emojiType) return;
    try {
        await addFeishuReaction({ account, messageId, emojiType });
        runtime.log?.(`[feishu] Sent ack reaction ${emojiType} to ${messageId}`);
    } catch (err) {
        // Don't fail message processing if reaction fails
        runtime.log?.(`[feishu] Failed to send ack reaction: ${err}`);
    }
}

export async function startFeishuMonitor(params: {
    account: FeishuAccount;
    config: ClawdbotConfig;
    runtime: FeishuRuntimeEnv;
    statusSink?: (patch: { lastInboundAt?: number; lastOutboundAt?: number }) => void;
}) {
    const { account, config, runtime, statusSink } = params;

    // Feishu WS Client
    const client = new lark.WSClient({
        appId: account.config.appId || "",
        appSecret: account.config.appSecret || "",
        loggerLevel: 2, // Info
        logger: {
            trace: () => { },
            debug: () => { },
            info: (msg) => runtime.log?.(`[feishu-sdk] ${msg}`),
            warn: (msg) => runtime.log?.(`[feishu-sdk] WARN: ${msg}`),
            error: (msg) => runtime.error?.(`[feishu-sdk] ERROR: ${msg}`),
        }
    });

    // Event Dispatcher
    const eventDispatcher = new lark.EventDispatcher({
        encryptKey: account.config.encryptKey || "",
        verificationToken: account.config.verificationToken || "",
    });

    eventDispatcher.register({
        "im.message.receive_v1": async (data) => {
            try {
                const event = data as FeishuMessageEvent;
                const message = event.message;
                const sender = event.sender;

                if (!message || !sender) {
                    runtime.log?.(`[feishu] Received incomplete message event`);
                    return;
                }

                const chatId = message.chat_id;
                const messageId = message.message_id;
                const senderId = sender.sender_id.user_id || sender.sender_id.open_id || sender.sender_id.union_id;

                // Handle message type compatibility (SDK vs API raw)
                const msgType = message.message_type || (message as any).msg_type;
                runtime.log?.(`[feishu] Received ${msgType} message ${messageId} from ${chatId}`);

                let text = "";
                let rawBody = "";
                let mediaPath: string | undefined;
                let mediaUrl: string | undefined;
                let mediaType: string | undefined;
                const mediaPaths: string[] = [];
                const mediaUrls: string[] = [];
                const mediaTypes: string[] = [];

                if (msgType === "text") {
                    try {
                        const content = JSON.parse(message.content);
                        text = content.text;
                        rawBody = content.text;
                    } catch {
                        text = "[Invalid JSON Content]";
                        rawBody = message.content;
                    }
                } else if (["image", "file", "audio", "media", "sticker"].includes(msgType)) {
                    // Parse and download media
                    const mediaInfo = parseMediaContent(msgType, message.content);
                    if (mediaInfo?.fileKey) {
                        const downloaded = await downloadAndSaveMedia({
                            account,
                            messageId,
                            fileKey: mediaInfo.fileKey,
                            msgType,
                            fileName: mediaInfo.fileName,
                            runtime,
                        });

                        if (downloaded) {
                            mediaPath = downloaded.path;
                            mediaPaths.push(downloaded.path);
                            mediaType = downloaded.kind;
                            mediaTypes.push(downloaded.kind);
                            text = `[${msgType}]`;
                            rawBody = `[${msgType}: ${mediaInfo.fileName || mediaInfo.fileKey}]`;
                        } else {
                            text = `[${msgType}]`;
                            rawBody = `[${msgType}: download failed]`;
                        }
                    } else {
                        text = `[${msgType}]`;
                        rawBody = `[${msgType}]`;
                    }
                } else {
                    // Unsupported message types (post, interactive, share_*, etc.)
                    rawBody = `[${msgType}]`;
                    text = rawBody;
                }

                // Check for quoted/parent message and download its media if present
                // This handles the case where user quotes an image and @mentions the bot
                const parentMsgId = message.parent_id || message.upper_message_id || (message as any).upper_message_id;
                if (parentMsgId) {
                    runtime.log?.(`[feishu] Message has parent/quoted message: ${parentMsgId}`);
                    try {
                        const parentMsg = await getFeishuMessage({ account, messageId: parentMsgId });
                        if (parentMsg && parentMsg.body?.content) {
                            const parentMsgType = parentMsg.msg_type;
                            runtime.log?.(`[feishu] Parent message type: ${parentMsgType}`);
                            
                            if (["image", "file", "audio", "media", "sticker"].includes(parentMsgType)) {
                                const parentMediaInfo = parseMediaContent(parentMsgType, parentMsg.body.content);
                                if (parentMediaInfo?.fileKey) {
                                    runtime.log?.(`[feishu] Downloading media from quoted message: ${parentMediaInfo.fileKey}`);
                                    const downloaded = await downloadAndSaveMedia({
                                        account,
                                        messageId: parentMsgId,
                                        fileKey: parentMediaInfo.fileKey,
                                        msgType: parentMsgType,
                                        fileName: parentMediaInfo.fileName,
                                        runtime,
                                    });
                                    if (downloaded) {
                                        mediaPaths.push(downloaded.path);
                                        mediaTypes.push(downloaded.kind);
                                        if (!mediaPath) {
                                            mediaPath = downloaded.path;
                                            mediaType = downloaded.kind;
                                        }
                                        rawBody += ` [Quoted ${parentMsgType}: ${parentMediaInfo.fileName || parentMediaInfo.fileKey}]`;
                                        runtime.log?.(`[feishu] Downloaded quoted media: ${downloaded.path}`);
                                    }
                                }
                            }
                        }
                    } catch (err) {
                        runtime.error?.(`[feishu] Failed to fetch quoted message: ${err}`);
                    }
                }

                const core = getFeishuRuntime();
                if (!core) {
                    runtime.error?.("[feishu] Core runtime not available during message processing");
                    return;
                }

                const fromLabel = `feishu:${senderId}`;

                const ctxPayload = core.channel.reply.finalizeInboundContext({
                    Body: text,
                    RawBody: rawBody,
                    CommandBody: text,
                    From: fromLabel,
                    To: `feishu:${chatId}`,
                    SessionKey: `feishu:${chatId}`,
                    AccountId: account.accountId,
                    ChatType: message.chat_type === "group" ? "channel" : "direct",
                    ConversationLabel: message.chat_type === "group" ? `Group ${chatId}` : `User ${senderId}`,
                    SenderId: senderId,
                    SenderName: "FeishuUser",
                    Provider: "feishu",
                    Surface: "feishu",
                    MessageSid: messageId,
                    MessageSidFull: messageId,
                    OriginatingChannel: "feishu",
                    OriginatingTo: `feishu:${chatId}`,
                    // Media attachments
                    ...(mediaPath ? { MediaPath: mediaPath } : {}),
                    ...(mediaUrl ? { MediaUrl: mediaUrl } : {}),
                    ...(mediaType ? { MediaType: mediaType } : {}),
                    ...(mediaPaths.length > 0 ? { MediaPaths: mediaPaths } : {}),
                    ...(mediaUrls.length > 0 ? { MediaUrls: mediaUrls } : {}),
                    ...(mediaTypes.length > 0 ? { MediaTypes: mediaTypes } : {}),
                });

                // Send ack reaction to indicate processing (optional, can be configured)
                // For now, we'll keep it disabled by default; enable by setting emojiType
                // await maybeSendAckReaction({ account, messageId, emojiType: "EYES", runtime });

                runtime.log?.(`[feishu] Dispatching reply for message ${messageId}`);
                await core.channel.reply.dispatchReplyWithBufferedBlockDispatcher({
                    ctx: ctxPayload,
                    cfg: config,
                    dispatcherOptions: {
                        deliver: async (payload) => {
                            runtime.log?.(`[feishu] Deliver called: text=${payload.text?.slice(0, 50) || "(none)"}, mediaUrls=${JSON.stringify(payload.mediaUrls || payload.mediaUrl || [])}`);
                            // Handle media in reply
                            const mediaUrls = payload.mediaUrls?.length
                                ? payload.mediaUrls
                                : payload.mediaUrl
                                    ? [payload.mediaUrl]
                                    : [];

                            // Send media files first
                            for (const url of mediaUrls) {
                                try {
                                    runtime.log?.(`[feishu] Processing media URL: ${url}`);
                                    // Check if it's a local file path
                                    const isLocalPath = !url.startsWith("http://") && !url.startsWith("https://");
                                    if (isLocalPath) {
                                        const ext = path.extname(url).toLowerCase().replace(".", "");
                                        const mediaKind = resolveMediaKind(`.${ext}`);
                                        runtime.log?.(`[feishu] Sending ${mediaKind} to ${chatId}: ${url}`);

                                        if (mediaKind === "image") {
                                            // Images use the image upload API
                                            await sendFeishuImageMessage({
                                                account,
                                                receiveId: chatId,
                                                imagePath: url,
                                            });
                                        } else {
                                            // Videos, audio, and documents use the file upload API
                                            // Determine the Feishu file type
                                            const fileType = ["mp4", "mov", "avi", "mkv", "webm"].includes(ext) ? "mp4" as const
                                                : ["mp3", "wav", "ogg", "opus", "m4a"].includes(ext) ? "opus" as const
                                                : ["pdf"].includes(ext) ? "pdf" as const
                                                : ["doc", "docx"].includes(ext) ? "doc" as const
                                                : ["xls", "xlsx"].includes(ext) ? "xls" as const
                                                : ["ppt", "pptx"].includes(ext) ? "ppt" as const
                                                : "stream" as const;

                                            await sendFeishuFileMessage({
                                                account,
                                                receiveId: chatId,
                                                filePath: url,
                                                fileType,
                                            });
                                        }
                                        runtime.log?.(`[feishu] Sent ${mediaKind} successfully: ${url}`);
                                    } else {
                                        // For remote URLs, we would need to download first
                                        // For now, include URL in text if present
                                        runtime.log?.(`[feishu] Remote media URL not yet supported: ${url}`);
                                    }
                                } catch (mediaErr) {
                                    runtime.error?.(`[feishu] Failed to send media: ${mediaErr}`);
                                }
                            }

                            // Send text message
                            if (payload.text) {
                                runtime.log?.(`[feishu] Sending text to ${chatId}: ${payload.text.slice(0, 100)}...`);
                                await sendFeishuMessage({
                                    account,
                                    receiveId: chatId,
                                    msgType: "text",
                                    content: JSON.stringify({ text: payload.text }),
                                });
                                runtime.log?.(`[feishu] Text sent successfully`);
                            }
                        },
                        onError: (err) => {
                            runtime.error?.(`[feishu] Reply failed: ${err}`);
                        }
                    }
                });

                statusSink?.({ lastInboundAt: Date.now() });

            } catch (err) {
                runtime.error?.(`[feishu] Process message failed: ${err}`);
            }
        },
        "im.message.message_read_v1": async (data) => {
            // Optional: Handle read receipts
        }
    });

    try {
        await client.start({ eventDispatcher });
        runtime.log?.(`[feishu] WebSocket client started for account ${account.accountId}`);
        return {
            stop: async () => {
                try {
                    // WSClient may have close/stop method - attempt graceful shutdown
                    if (typeof (client as any).close === "function") {
                        await (client as any).close();
                    } else if (typeof (client as any).stop === "function") {
                        await (client as any).stop();
                    }
                    runtime.log?.(`[feishu] WebSocket client stopped for account ${account.accountId}`);
                } catch (err) {
                    runtime.error?.(`[feishu] Error stopping WebSocket client: ${err}`);
                }
            }
        };
    } catch (err) {
        runtime.error?.(`[feishu] Failed to start WebSocket client: ${err}`);
        throw err;
    }
}
