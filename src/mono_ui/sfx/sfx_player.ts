export type SfxLoudness = "WHISPER" | "NORMAL" | "SHOUT";

export type PlaySfxOptions = {
    loudness?: string;
    cooldown_ms?: number;
    emitter_ref?: string;
    channel?: string;
};

type SfxState = {
    ctx: AudioContext | null;
    unlocked: boolean;
    last_play_by_id: Map<string, number>;
    master_gain: GainNode | null;
    channel_gain: Map<string, GainNode>;
};

function get_state(): SfxState {
    const g = globalThis as any;
    if (!g.__THAUM_SFX_STATE) {
        g.__THAUM_SFX_STATE = {
            ctx: null,
            unlocked: false,
            last_play_by_id: new Map<string, number>(),
            master_gain: null,
            channel_gain: new Map<string, GainNode>(),
        } satisfies SfxState;
    }
    return g.__THAUM_SFX_STATE as SfxState;
}

function ensure_ctx(): AudioContext | null {
    const st = get_state();
    if (st.ctx) return st.ctx;
    try {
        const AC = (window as any).AudioContext ?? (window as any).webkitAudioContext;
        if (!AC) return null;
        const ac: AudioContext = new AC();
        st.ctx = ac;

        // Master + channels
        st.master_gain = ac.createGain();
        st.master_gain.gain.value = 0.9;
        st.master_gain.connect(ac.destination);
        st.channel_gain.set('ui', ac.createGain());
        st.channel_gain.set('sfx', ac.createGain());
        st.channel_gain.get('ui')!.gain.value = 0.7;
        st.channel_gain.get('sfx')!.gain.value = 0.8;
        for (const g of st.channel_gain.values()) g.connect(st.master_gain);

        return ac;
    } catch {
        return null;
    }
}

function get_channel_out(ac: AudioContext, channel: string | undefined): AudioNode {
    const st = get_state();
    const key = (channel ?? 'sfx').trim().toLowerCase() || 'sfx';
    const g = st.channel_gain.get(key);
    if (g) return g;

    // lazily create unknown channels
    const created = ac.createGain();
    created.gain.value = 0.8;
    const master = st.master_gain;
    if (master) created.connect(master);
    else created.connect(ac.destination);
    st.channel_gain.set(key, created);
    return created;
}

export function unlock_sfx(): void {
    const ac = ensure_ctx();
    if (!ac) return;
    const st = get_state();

    // Calling resume() inside a user gesture is required in many environments.
    if (ac.state === "suspended") {
        try {
            void ac.resume();
        } catch {
            // ignore
        }
    }

    // Prime a silent node so future scheduling works reliably.
    if (!st.unlocked) {
        try {
            const now = ac.currentTime;
            const g = ac.createGain();
            g.gain.setValueAtTime(0, now);
            g.connect(ac.destination);

            const o = ac.createOscillator();
            o.type = "sine";
            o.frequency.setValueAtTime(40, now);
            o.connect(g);
            o.start(now);
            o.stop(now + 0.01);
            st.unlocked = true;
        } catch {
            // ignore
        }
    }
}

function normalize_loudness(v: string | undefined): SfxLoudness {
    const s = (v ?? "NORMAL").trim().toUpperCase();
    if (s === "WHISPER" || s === "SHOUT") return s;
    return "NORMAL";
}

function loudness_gain(l: SfxLoudness): number {
    switch (l) {
        case "WHISPER":
            return 0.03;
        case "SHOUT":
            return 0.18;
        default:
            return 0.09;
    }
}

function play_speech_blip(ac: AudioContext, l: SfxLoudness): void {
    const now = ac.currentTime;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(loudness_gain(l), now + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
    gain.connect(get_channel_out(ac, 'sfx'));

    const osc = ac.createOscillator();
    osc.type = "triangle";
    const base = l === "SHOUT" ? 580 : 520;
    osc.frequency.setValueAtTime(base, now);
    osc.frequency.exponentialRampToValueAtTime(base * 0.86, now + 0.05);
    osc.connect(gain);

    osc.start(now);
    osc.stop(now + 0.075);
}

function play_footstep_blip(ac: AudioContext): void {
    const now = ac.currentTime;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.028, now + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);
    gain.connect(get_channel_out(ac, 'sfx'));

    const osc = ac.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(145, now);
    osc.frequency.exponentialRampToValueAtTime(95, now + 0.025);
    osc.connect(gain);
    osc.start(now);
    osc.stop(now + 0.035);
}

function play_ui_press(ac: AudioContext): void {
    const now = ac.currentTime;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.06, now + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);
    gain.connect(get_channel_out(ac, 'ui'));

    const osc = ac.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(920, now);
    osc.frequency.exponentialRampToValueAtTime(680, now + 0.03);
    osc.connect(gain);
    osc.start(now);
    osc.stop(now + 0.04);
}

function play_ui_release(ac: AudioContext): void {
    const now = ac.currentTime;
    const gain = ac.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.055, now + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);
    gain.connect(get_channel_out(ac, 'ui'));

    const osc = ac.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(760, now);
    osc.frequency.exponentialRampToValueAtTime(980, now + 0.02);
    osc.connect(gain);
    osc.start(now);
    osc.stop(now + 0.03);
}

export function play_sfx(sound_id: string, opts: PlaySfxOptions = {}): void {
    // If called outside a user gesture, unlock may still be blocked;
    // but calling it is harmless and ensures we prime when possible.
    unlock_sfx();

    const id = String(sound_id ?? "").trim();
    if (!id) return;

    const st = get_state();
    const cooldown_ms = Number.isFinite(opts.cooldown_ms) ? Math.max(0, Math.min(5000, opts.cooldown_ms as number)) : 120;
    const now_ms = Date.now();
    const key = `${id}:${String(opts.emitter_ref ?? '')}`;
    const last_ms = st.last_play_by_id.get(key) ?? 0;
    if (cooldown_ms > 0 && now_ms - last_ms < cooldown_ms) return;
    st.last_play_by_id.set(key, now_ms);

    const ac = ensure_ctx();
    if (!ac) return;

    if (ac.state === "suspended") {
        // Best-effort resume (may be blocked until a user gesture).
        try {
            void ac.resume();
        } catch {
            // ignore
        }
    }

    const loudness = normalize_loudness(opts.loudness);
    if (id === "speech_blip") {
        play_speech_blip(ac, loudness);
        return;
    }

    if (id === 'footstep_blip') {
        play_footstep_blip(ac);
        return;
    }

    if (id === 'ui_press') {
        play_ui_press(ac);
        return;
    }

    if (id === 'ui_release') {
        play_ui_release(ac);
        return;
    }

    // Default: quiet click.
    play_speech_blip(ac, "WHISPER");
}
