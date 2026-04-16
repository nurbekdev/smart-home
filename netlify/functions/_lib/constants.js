export const TOPICS = {
  motion: "home/mainroom/motion",
  lightSet: "home/mainroom/light/set",
  lightState: "home/mainroom/light/state",
  status: "home/mainroom/status",
  heartbeat: "home/mainroom/heartbeat",
  restart: "home/mainroom/restart",
  armState: "home/mainroom/arm/state",
  nightModeState: "home/mainroom/night_mode/state",
  settingsState: "home/mainroom/settings"
};

export const CALLBACKS = {
  LIGHT_ON: "light_on",
  LIGHT_OFF: "light_off",
  STATUS: "status",
  ARM: "arm",
  DISARM: "disarm",
  LOGS: "logs",
  SETTINGS: "settings",
  RESTART: "restart",
  AUTO_OFF_TOGGLE: "auto_off_toggle",
  NIGHT_MODE_TOGGLE: "night_mode_toggle",
  COOLDOWN_INC: "cooldown_inc",
  COOLDOWN_DEC: "cooldown_dec",
  BACK_MAIN: "back_main"
};

export const DEFAULTS = {
  motionCooldownSeconds: Number(process.env.MOTION_COOLDOWN_SECONDS || 15),
  autoOffMinutes: Number(process.env.AUTO_OFF_MINUTES || 3),
  nightModeOnly: String(process.env.NIGHT_MODE_ONLY || "false") === "true",
  armed: String(process.env.ARMED_DEFAULT || "true") === "true"
};
