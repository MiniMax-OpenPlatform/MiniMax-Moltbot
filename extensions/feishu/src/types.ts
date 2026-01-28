export type FeishuConfig = {
  appId?: string;
  appSecret?: string;
  encryptKey?: string;
  verificationToken?: string;
};

export type FeishuAccount = {
  accountId: string;
  name?: string;
  enabled?: boolean;
  config: FeishuConfig;
};

export interface FeishuMessageEvent {
  message: {
    chat_id: string;
    message_id: string;
    chat_type: string;
    message_type: string; // SDK types say message_type, raw might be msg_type
    content: string; // JSON string
    create_time: string;
    // Thread/quote related fields
    root_id?: string; // Root message ID of the thread
    parent_id?: string; // Parent message ID (immediate parent in thread)
    upper_message_id?: string; // ID of the message being quoted/replied to
  };
  sender: {
    sender_id: {
      user_id?: string;
      open_id?: string;
      union_id?: string;
    };
    sender_type: string;
  };
}

// Feishu message content types (JSON parsed from message.content)
export type FeishuTextContent = { text: string };
export type FeishuImageContent = { image_key: string };
export type FeishuFileContent = { file_key: string; file_name?: string };
export type FeishuAudioContent = { file_key: string; duration?: number };
export type FeishuMediaContent = { file_key: string; image_key?: string; file_name?: string; duration?: number };
export type FeishuStickerContent = { file_key: string };

export type FeishuMsgType = "text" | "image" | "file" | "audio" | "media" | "sticker" | "post" | "interactive" | "share_chat" | "share_user";

// File type for upload
export type FeishuFileType = "opus" | "mp4" | "pdf" | "doc" | "xls" | "ppt" | "stream";

// Emoji type for reactions
// Common emoji types: SMILE, THUMBSUP, THUMBSDOWN, HEART, etc.
// Full list: https://open.feishu.cn/document/server-docs/im-v1/message-reaction/emojis-introduce
export type FeishuEmojiType =
    | "SMILE" | "THUMBSUP" | "THUMBSDOWN" | "HEART" | "JIAYI" | "FROWN" | "CLAP"
    | "OK" | "APPLAUSE" | "HANDSHAKE" | "PRAY" | "THANKS" | "MUSCLE" | "BEER"
    | "COFFEE" | "DONE" | "LOVE" | "CELEBRATE" | "PARTY" | "FIRE" | "ROCKET"
    | "ONIT" | "EYES" | "LGTM" | "POOP" | "100" | "CONFUSED" | "SOB"
    | string; // Allow any string for forward compatibility

// Reaction event data
export interface FeishuReactionEvent {
    message_id: string;
    reaction_type: {
        emoji_type: FeishuEmojiType;
    };
    operator_type: "app" | "user";
    user_id?: {
        user_id?: string;
        open_id?: string;
        union_id?: string;
    };
    action_time: string;
}
