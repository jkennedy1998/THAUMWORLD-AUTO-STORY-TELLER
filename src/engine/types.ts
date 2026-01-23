// moved from src/interface_program/main.ts during engine split

export type LogMessage = {
    id: string; // "ISO : 000001 : randBase32RFC(6)"
    sender: string;
    content: string;
};

export type LogFile = {
    schema_version: 1;
    messages: LogMessage[];
};

export type InboxFile = {
    schema_version: 1;
    messages: LogMessage[]; // same shape as log.jsonc
};

export const BASE32_RFC_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
