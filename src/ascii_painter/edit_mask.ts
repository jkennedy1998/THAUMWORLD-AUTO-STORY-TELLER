export type EditChannels = {
  char: boolean;
  color: boolean;
  weight: boolean;
};

export type EditMaskModifiers = {
  shift: boolean;
  ctrl: boolean;
  alt: boolean;
  meta: boolean;
};

export const ALL_EDIT_CHANNELS: EditChannels = {
  char: true,
  color: true,
  weight: true,
};

export function sanitize_edit_channels(value: unknown, fallback: EditChannels = ALL_EDIT_CHANNELS): EditChannels {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    char: typeof record.char === 'boolean' ? record.char : fallback.char,
    color: typeof record.color === 'boolean' ? record.color : fallback.color,
    weight: typeof record.weight === 'boolean' ? record.weight : fallback.weight,
  };
}

export function resolve_edit_channels_with_modifiers(base: EditChannels, mods: EditMaskModifiers): EditChannels {
  const has_modifier = mods.shift || mods.ctrl || mods.meta || mods.alt;
  if (has_modifier) {
    return {
      char: mods.ctrl || mods.meta,
      color: mods.shift,
      weight: mods.alt,
    };
  }
  return { ...base };
}

export function has_any_edit_channel(channels: EditChannels): boolean {
  return channels.char || channels.color || channels.weight;
}
