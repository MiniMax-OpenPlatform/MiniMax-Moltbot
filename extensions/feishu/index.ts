import type { ClawdbotPluginApi } from "moltbot/plugin-sdk";
import { emptyPluginConfigSchema } from "moltbot/plugin-sdk";

import { feishuDock, feishuPlugin } from "./src/channel.js";
import { setFeishuRuntime } from "./src/runtime.js";

const plugin = {
    id: "feishu",
    name: "Feishu",
    description: "Clawdbot Feishu (Lark) channel plugin",
    configSchema: emptyPluginConfigSchema(),
    register(api: ClawdbotPluginApi) {
        setFeishuRuntime(api.runtime);
        api.registerChannel({ plugin: feishuPlugin, dock: feishuDock });
    },
};

export default plugin;
