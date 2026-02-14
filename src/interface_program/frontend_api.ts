/**
 * Frontend API - Browser-safe exports for canvas_app
 * 
 * This file contains functions that can be safely imported by the browser renderer.
 * It does NOT import any Node.js modules.
 * 
 * This maintains its own state that the backend syncs with via HTTP API.
 */

// Volume levels for communication
export type VolumeLevel = "WHISPER" | "NORMAL" | "SHOUT";

// Frontend-only state (mirrored from backend)
let current_volume: VolumeLevel = "NORMAL";
let current_target: { ref: string; type: "npc" | "actor" | "item"; name?: string } | null = null;
let current_message: string = "";

// NOTE: actor_ref is currently hardcoded for slot-1 local testing.
const actor_ref = "actor.henry_actor";
const API_BASE = "http://localhost:8787/api";

/**
 * Handle left click on entity (select target)
 * Called by frontend when user left-clicks an NPC, actor, or item
 */
export function handleEntityClick(entity_ref: string, entity_type: "npc" | "actor" | "item"): void {
    console.log("[FrontendAPI] Left click on", entity_type, entity_ref);
    
    // Extract name from ref (e.g., "npc.grenda" -> "Grenda")
    const name = entity_ref.split('.').pop() || entity_ref;
    
    // Set local target state
    current_target = {
        ref: entity_ref,
        type: entity_type,
        name: name
    };
    
    // Send to backend via HTTP API
    fetch(`${API_BASE}/target`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            actor_ref: actor_ref,
            target_ref: entity_ref,
            target_type: entity_type,
            target_name: name
        })
    }).then(res => res.json())
      .then(data => {
          console.log("[FrontendAPI] Backend target set:", data);
      })
      .catch(err => {
          console.error("[FrontendAPI] Failed to set target:", err);
      });
    
    console.log("[FrontendAPI] Target set:", current_target);
}

/**
 * Handle right click (move/interact)
 * Called by frontend when user right-clicks
 */
export function handleRightClick(x: number, y: number, entity_ref?: string): void {
    if (entity_ref) {
        console.log("[FrontendAPI] Right click on entity:", entity_ref, "at (", x, ",", y, ")");
    } else {
        console.log("[FrontendAPI] Right click on ground at (", x, ",", y, ")");
    }
}

/**
 * Handle volume button click
 * Called by frontend when user clicks volume buttons
 */
export function handleVolumeClick(volume: VolumeLevel): void {
    console.log("[FrontendAPI] Volume button clicked:", volume);
    current_volume = volume;
}

/**
 * Get current volume
 */
export function getVolume(): VolumeLevel {
    return current_volume;
}

/**
 * Handle submit communication
 * Called by frontend when user clicks Send or presses Enter
 * Returns the message info to be sent to backend
 */
export function handleSubmitCommunication(text: string): { text: string; volume: VolumeLevel; target: typeof current_target } | null {
    console.log("[FrontendAPI] Submit communication:", text);
    
    if (!text.trim()) {
        return null;
    }
    
    current_message = text;
    
    return {
        text: text,
        volume: current_volume,
        target: current_target
    };
}

/**
 * Get current target info
 * Called by frontend to display "Talking to: X"
 */
export function getCurrentTarget(): typeof current_target {
    return current_target;
}

/**
 * Clear current target
 * Called by frontend when user clears target
 */
export function clearCurrentTarget(): void {
    console.log("[FrontendAPI] Target cleared");
    current_target = null;
    
    // Send to backend via HTTP API
    fetch(`${API_BASE}/target`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            actor_ref: actor_ref,
            target_ref: null
        })
    }).catch(err => {
        console.error("[FrontendAPI] Failed to clear target:", err);
    });
}

/**
 * Check if we have a valid target
 */
export function hasValidTarget(): boolean {
    return current_target !== null;
}

