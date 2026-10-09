export const EMAIL_TEMPLATE_KEYS = [
  'user_invite',
  'password_reset',
  'password_changed',
  'device_offline',
  'device_online',
  'device_dead',
  'export_ready',
  'test',
] as const;

export type EmailTemplateKey = (typeof EMAIL_TEMPLATE_KEYS)[number];

/** Handlebars subjects; the body lives in `templates/<key>.mjml`. */
export const EMAIL_SUBJECTS: Record<EmailTemplateKey, string> = {
  user_invite: "You're invited to {{productName}}",
  password_reset: 'Reset your {{productName}} password',
  password_changed: 'Your {{productName}} password was changed',
  device_offline: '[{{productName}}] Device offline: {{deviceName}}',
  device_online: '[{{productName}}] Device online: {{deviceName}}',
  device_dead: '[{{productName}}] Device dead: {{deviceName}}',
  export_ready: '[{{productName}}] Your export is ready: {{title}}',
  test: 'Test email from {{productName}}',
};
