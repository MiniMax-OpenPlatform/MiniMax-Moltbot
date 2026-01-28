import * as lark from "@larksuiteoapi/node-sdk";

import type { FeishuAccount, FeishuFileType, FeishuMsgType, FeishuEmojiType } from "./types.js";

// Extend the SDK's default http instance to support large file uploads
// The SDK exports defaultHttpInstance which we can configure
// We need to set axios defaults for maxBodyLength and maxContentLength
// to handle video files up to 100MB+
function configureLargeFileSupport(): lark.HttpInstance | undefined {
    try {
        // Access the SDK's default axios instance and configure it for large uploads
        const instance = lark.defaultHttpInstance;
        if (instance && "defaults" in instance) {
            const defaults = instance.defaults as { maxBodyLength?: number; maxContentLength?: number };
            defaults.maxBodyLength = Infinity;
            defaults.maxContentLength = Infinity;
            console.log("[feishu/client] Configured httpInstance for large file uploads");
        }
        return instance;
    } catch {
        // SDK version may not export defaultHttpInstance, proceed without it
        console.log("[feishu/client] defaultHttpInstance not available, using SDK defaults");
        return undefined;
    }
}

const configuredHttpInstance = configureLargeFileSupport();

export function createFeishuClient(account: FeishuAccount) {
    if (!account.config.appId || !account.config.appSecret) {
        throw new Error("Feishu appId and appSecret are required");
    }
    const clientOptions: {
        appId: string;
        appSecret: string;
        disableTokenCache: boolean;
        httpInstance?: lark.HttpInstance;
    } = {
        appId: account.config.appId,
        appSecret: account.config.appSecret,
        disableTokenCache: false,
    };
    // Only set httpInstance if we have a configured one
    if (configuredHttpInstance) {
        clientOptions.httpInstance = configuredHttpInstance;
    }
    return new lark.Client(clientOptions);
}

export async function sendFeishuMessage(params: {
    account: FeishuAccount;
    receiveId: string;
    receiveIdType?: "open_id" | "user_id" | "union_id" | "email" | "chat_id";
    msgType: FeishuMsgType;
    content: string;
}) {
    const { account, receiveId, receiveIdType = "chat_id", msgType, content } = params;
    console.log(`[feishu/client] sendFeishuMessage: receiveId=${receiveId}, receiveIdType=${receiveIdType}, msgType=${msgType}`);
    const client = createFeishuClient(account);

    const response = await client.im.message.create({
        params: {
            receive_id_type: receiveIdType,
        },
        data: {
            receive_id: receiveId,
            msg_type: msgType,
            content: content,
        },
    });

    console.log(`[feishu/client] sendFeishuMessage response code=${response.code}, msg=${response.msg}`);
    if (response.code !== 0) {
        const logId = (response as { log_id?: string }).log_id;
        throw new Error(`Feishu send message failed: ${response.msg} (code: ${response.code}${logId ? `, logId: ${logId}` : ""})`);
    }

    return response.data;
}

/**
 * Upload an image to Feishu and get the image_key for sending image messages.
 * Supports: JPEG, PNG, WEBP, GIF, TIFF, BMP, ICO (max 10MB)
 */
export async function uploadFeishuImage(params: {
    account: FeishuAccount;
    imagePath: string;
    imageType?: "message";
}) {
    const { account, imagePath, imageType = "message" } = params;
    console.log(`[feishu/client] uploadFeishuImage: imagePath=${imagePath}`);
    const client = createFeishuClient(account);

    const fs = await import("node:fs");
    // Check if file exists
    if (!fs.existsSync(imagePath)) {
        throw new Error(`Feishu upload image: file not found: ${imagePath}`);
    }
    const file = fs.createReadStream(imagePath);

    console.log(`[feishu/client] Calling im.image.create...`);
    const response = await client.im.image.create({
        data: {
            image_type: imageType,
            image: file,
        }
    }) as { code?: number; msg?: string; data?: { image_key?: string }; image_key?: string } | null;

    console.log(`[feishu/client] uploadFeishuImage response:`, JSON.stringify(response));
    if (!response || (response.code !== undefined && response.code !== 0)) {
        throw new Error(`Feishu upload image failed: ${response?.msg || "unknown"} (code: ${response?.code || "unknown"})`);
    }

    // SDK may return image_key in data object or directly on response
    const imageKey = response.data?.image_key ?? response.image_key;
    if (!imageKey) {
        throw new Error("Feishu upload image: no image_key in response");
    }
    console.log(`[feishu/client] uploadFeishuImage success: image_key=${imageKey}`);
    return { image_key: imageKey };
}

/**
 * Upload a file to Feishu and get the file_key for sending file messages.
 * Supports: opus, mp4, pdf, doc, xls, ppt, stream (max 30MB)
 */
export async function uploadFeishuFile(params: {
    account: FeishuAccount;
    filePath: string;
    fileType: FeishuFileType;
    fileName?: string;
}) {
    const { account, filePath, fileType, fileName } = params;
    const client = createFeishuClient(account);

    const fs = await import("node:fs");
    const path = await import("node:path");
    const file = fs.createReadStream(filePath);
    const name = fileName || path.basename(filePath);

    const response = await client.im.file.create({
        data: {
            file_type: fileType,
            file_name: name,
            file: file,
        }
    }) as { code?: number; msg?: string; data?: { file_key?: string }; file_key?: string } | null;

    if (!response || (response.code !== undefined && response.code !== 0)) {
        throw new Error(`Feishu upload file failed: ${response?.msg || "unknown"} (code: ${response?.code || "unknown"})`);
    }

    // SDK may return file_key in data object or directly on response
    const fileKey = response.data?.file_key ?? response.file_key;
    if (!fileKey) {
        throw new Error("Feishu upload file: no file_key in response");
    }
    return { file_key: fileKey };
}

/**
 * Download a resource (image/file/audio/video) from a Feishu message.
 * This can download media sent by users, not just media uploaded by the app.
 */
export async function downloadFeishuMessageResource(params: {
    account: FeishuAccount;
    messageId: string;
    fileKey: string;
    type: "image" | "file";
}): Promise<Buffer> {
    const { account, messageId, fileKey, type } = params;
    const client = createFeishuClient(account);

    const response = await client.im.messageResource.get({
        path: {
            message_id: messageId,
            file_key: fileKey,
        },
        params: {
            type: type,
        },
    });

    if (!response || typeof response === "object" && "code" in response && response.code !== 0) {
        const errorInfo = response as { code?: number; msg?: string };
        throw new Error(`Feishu download resource failed: ${errorInfo?.msg || "unknown"} (code: ${errorInfo?.code || "unknown"})`);
    }

    // The SDK returns a readable stream for binary data
    if (response instanceof Buffer) {
        return response;
    }

    // Handle stream response - SDK may return object with getReadableStream() or pipe()
    if (response && typeof response === "object") {
        // Check if response has getReadableStream method (newer SDK versions)
        const streamObj = response as { getReadableStream?: () => NodeJS.ReadableStream; pipe?: unknown };
        if (typeof streamObj.getReadableStream === "function") {
            const stream = streamObj.getReadableStream();
            const chunks: Buffer[] = [];
            return new Promise((resolve, reject) => {
                stream.on("data", (chunk: Buffer) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
                stream.on("end", () => resolve(Buffer.concat(chunks)));
                stream.on("error", reject);
            });
        }
        // Fallback: check if it has pipe (older SDK or direct stream)
        if ("pipe" in response) {
            const chunks: Buffer[] = [];
            const stream = response as unknown as NodeJS.ReadableStream;
            return new Promise((resolve, reject) => {
                stream.on("data", (chunk: Buffer) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
                stream.on("end", () => resolve(Buffer.concat(chunks)));
                stream.on("error", reject);
            });
        }
    }

    throw new Error("Feishu download resource: unexpected response type");
}

/**
 * Send an image message to a Feishu chat.
 * First uploads the image, then sends the message.
 */
export async function sendFeishuImageMessage(params: {
    account: FeishuAccount;
    receiveId: string;
    imagePath: string;
    receiveIdType?: "open_id" | "user_id" | "union_id" | "email" | "chat_id";
}) {
    const { account, receiveId, imagePath, receiveIdType = "chat_id" } = params;

    // Upload the image first
    const uploadResult = await uploadFeishuImage({ account, imagePath });
    if (!uploadResult?.image_key) {
        throw new Error("Feishu upload image: no image_key returned");
    }

    // Send the image message
    return sendFeishuMessage({
        account,
        receiveId,
        receiveIdType,
        msgType: "image",
        content: JSON.stringify({ image_key: uploadResult.image_key }),
    });
}

/**
 * Send a file message to a Feishu chat.
 * First uploads the file, then sends the message.
 */
export async function sendFeishuFileMessage(params: {
    account: FeishuAccount;
    receiveId: string;
    filePath: string;
    fileType: FeishuFileType;
    fileName?: string;
    receiveIdType?: "open_id" | "user_id" | "union_id" | "email" | "chat_id";
}) {
    const { account, receiveId, filePath, fileType, fileName, receiveIdType = "chat_id" } = params;

    // Upload the file first
    const uploadResult = await uploadFeishuFile({ account, filePath, fileType, fileName });
    if (!uploadResult?.file_key) {
        throw new Error("Feishu upload file: no file_key returned");
    }

    // Determine the correct message type based on file type:
    // - "mp4" -> msg_type: "media" (video)
    // - "opus" -> msg_type: "audio" (audio)
    // - others (pdf, doc, xls, ppt, stream) -> msg_type: "file"
    let msgType: "file" | "media" | "audio" = "file";
    let content: string;

    if (fileType === "mp4") {
        // Video files use "media" message type
        msgType = "media";
        content = JSON.stringify({ file_key: uploadResult.file_key });
    } else if (fileType === "opus") {
        // Audio files use "audio" message type
        msgType = "audio";
        content = JSON.stringify({ file_key: uploadResult.file_key });
    } else {
        // Other files (pdf, doc, xls, ppt, stream) use "file" message type
        msgType = "file";
        content = JSON.stringify({ file_key: uploadResult.file_key });
    }

    console.log(`[feishu/client] sendFeishuFileMessage: fileType=${fileType}, msgType=${msgType}`);

    // Send the file/media/audio message
    return sendFeishuMessage({
        account,
        receiveId,
        receiveIdType,
        msgType,
        content,
    });
}

/**
 * Add a reaction (emoji) to a Feishu message.
 * See: https://open.feishu.cn/document/server-docs/im-v1/message-reaction/create
 */
export async function addFeishuReaction(params: {
    account: FeishuAccount;
    messageId: string;
    emojiType: FeishuEmojiType;
}) {
    const { account, messageId, emojiType } = params;
    const client = createFeishuClient(account);

    const response = await client.im.messageReaction.create({
        path: {
            message_id: messageId,
        },
        data: {
            reaction_type: {
                emoji_type: emojiType,
            },
        },
    });

    if (response.code !== 0) {
        throw new Error(`Feishu add reaction failed: ${response.msg} (code: ${response.code})`);
    }

    return response.data;
}

/**
 * Delete a reaction from a Feishu message.
 * See: https://open.feishu.cn/document/server-docs/im-v1/message-reaction/delete
 */
export async function deleteFeishuReaction(params: {
    account: FeishuAccount;
    messageId: string;
    reactionId: string;
}) {
    const { account, messageId, reactionId } = params;
    const client = createFeishuClient(account);

    const response = await client.im.messageReaction.delete({
        path: {
            message_id: messageId,
            reaction_id: reactionId,
        },
    });

    if (response.code !== 0) {
        throw new Error(`Feishu delete reaction failed: ${response.msg} (code: ${response.code})`);
    }

    return response.data;
}

/**
 * List reactions on a Feishu message.
 * See: https://open.feishu.cn/document/server-docs/im-v1/message-reaction/list
 */
export async function listFeishuReactions(params: {
    account: FeishuAccount;
    messageId: string;
    emojiType?: FeishuEmojiType;
}) {
    const { account, messageId, emojiType } = params;
    const client = createFeishuClient(account);

    const response = await client.im.messageReaction.list({
        path: {
            message_id: messageId,
        },
        params: emojiType ? { reaction_type: emojiType } : {},
    });

    if (response.code !== 0) {
        throw new Error(`Feishu list reactions failed: ${response.msg} (code: ${response.code})`);
    }

    return response.data;
}

/**
 * Get message details by message_id.
 * This can be used to get quoted/parent message content.
 * See: https://open.feishu.cn/document/server-docs/im-v1/message/get
 */
export async function getFeishuMessage(params: {
    account: FeishuAccount;
    messageId: string;
}): Promise<{
    message_id: string;
    root_id?: string;
    parent_id?: string;
    msg_type: string;
    body?: { content: string };
    upper_message_id?: string;
} | null> {
    const { account, messageId } = params;
    console.log(`[feishu/client] getFeishuMessage: messageId=${messageId}`);
    const client = createFeishuClient(account);

    try {
        const response = await client.im.message.get({
            path: {
                message_id: messageId,
            },
        });

        console.log(`[feishu/client] getFeishuMessage response code=${response.code}`);
        if (response.code !== 0) {
            console.error(`[feishu/client] getFeishuMessage failed: ${response.msg} (code: ${response.code})`);
            return null;
        }

        const items = response.data?.items;
        if (!items || items.length === 0) {
            console.log(`[feishu/client] getFeishuMessage: no items found`);
            return null;
        }

        const msg = items[0];
        console.log(`[feishu/client] getFeishuMessage: found message type=${msg?.msg_type}, upper_message_id=${(msg as any)?.upper_message_id}`);
        return {
            message_id: msg?.message_id || messageId,
            root_id: msg?.root_id,
            parent_id: msg?.parent_id,
            msg_type: msg?.msg_type || "unknown",
            body: msg?.body,
            upper_message_id: (msg as any)?.upper_message_id,
        };
    } catch (err) {
        console.error(`[feishu/client] getFeishuMessage error:`, err);
        return null;
    }
}
