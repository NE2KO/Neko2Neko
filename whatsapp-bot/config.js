import { fileURLToPath } from 'node:url';

export default {
  targetChatJid: process.env.TARGET_CHAT_JID || '120363428745244070@newsletter',
  allowedGroups: process.env.ALLOWED_GROUPS
    ? process.env.ALLOWED_GROUPS.split(',').map(s => s.trim())
    : ['120363428745244070@newsletter', '6285833216318@c.us', '120363368106873175@g.us', '120363418312951999@g.us', 'status@broadcast'],
  triggerKeywords: ['save', 'post', 'upload'],
  triggerHashtags: ['#save', '#upload'],
  enableReactionTrigger: false,
  enableAutoUpload: true,
  maxRetries: 3,
  retryDelayMs: 2000,
  mediaDir: fileURLToPath(new URL('../media', import.meta.url)),
  rawSubdir: 'raw',
  captionTemplate: ({ senderName, groupName, timestamp }) =>
    `🎬 From: ${senderName}\n📣 Group: ${groupName}\n🕒 ${timestamp}\n#saved #homelab`,
};
