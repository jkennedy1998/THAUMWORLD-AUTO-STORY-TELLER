declare module '*.png?url' {
  const src: string;
  export default src;
}

interface ElectronApiClipboardTextResult {
  success: boolean;
  text?: string;
  error?: string;
}

interface ElectronApiClipboardWriteResult {
  success: boolean;
  error?: string;
}

interface ElectronApiClipboardImageResult {
  success: boolean;
  dataUrl?: string;
  width?: number;
  height?: number;
  error?: string;
}

interface ElectronApiClipboardHasImageResult {
  success: boolean;
  hasImage?: boolean;
  error?: string;
}

interface ElectronAPI {
  readFile?: (filePath: string) => Promise<any>;
  writeFile?: (filePath: string, content: string) => Promise<any>;
  writeFileAtomic?: (filePath: string, content: string) => Promise<any>;
  getDataSlotDir?: (slot: number | string) => Promise<string>;
  getAsciiDrawingsDir?: () => Promise<string>;
  showOpenDialog?: (options: any) => Promise<any>;
  appMode?: string;
  dataSlot?: number;
  clientInstanceId?: string;
  startupBootMode?: 'manual_shell' | 'direct_runtime' | 'tas_runtime' | string;
  bootRole?: string;
  launchMode?: string;
  startupJoinConfig?: {
    preferredHost?: string;
    autoOpen?: boolean;
  };
  toolAssistedInputsBootConfig?: {
    enabled?: boolean;
    resetState?: boolean;
    taiId?: string;
    testName?: string;
    openMs?: number;
    endDelayMs?: number;
    scriptPath?: string;
    painterBootFilePath?: string;
    joinPreferredConnectionId?: string;
    joinPreferredConnectionKind?: 'local' | 'saved_manual' | 'lan_discovered' | string;
    joinPreferredHost?: string;
    joinAutoJoin?: boolean;
    gameActorId?: string;
    actorId?: string;
  };
  inputHostKind?: 'dom_window' | 'electron_bridge';
  gameplayInputPublishContext?: (ctx: {
    source?: string;
    typing?: boolean;
    window_focused?: boolean;
    active_element_id?: string | null;
    focused_owner_id?: string | null;
    player_id?: string;
    channel_id?: string;
    device_id?: string;
    session_token?: string | null;
    actor_ref?: string | null;
    place_id?: string | null;
    move_mode?: string | null;
    principal_view?: string | null;
    roll_quarter_turn?: number | null;
  }) => void;
  gameplayInputSendEvent?: (message: {
    source?: string;
    type: 'keydown' | 'keyup';
    code: string;
    key: string;
    repeat?: boolean;
  }) => void;
  toolAssistedInputsSendKeyboardEvent?: (message: {
    type: 'keydown' | 'keyup';
    code: string;
    key: string;
  }) => void;
  toolAssistedInputsResetKeyboard?: () => void;
  gameplayInputRequestSnapshot?: (playerId?: string) => void;
  gameplayInputReset?: (playerId?: string) => void;
  gameplayInputSubscribe?: (listener: (message: any) => void) => () => void;
  clipboardReadText?: () => Promise<ElectronApiClipboardTextResult>;
  clipboardWriteText?: (text: string) => Promise<ElectronApiClipboardWriteResult>;
  clipboardReadImage?: () => Promise<ElectronApiClipboardImageResult>;
  clipboardHasImage?: () => Promise<ElectronApiClipboardHasImageResult>;
}

interface Window {
  electronAPI?: ElectronAPI;
}
