/**
 * Global Time Tracking System
 * 
 * Manages game time for the THAUMWORLD system.
 * Time progresses based on actions and events.
 * Supports day/night cycles, schedules, and time-based events.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { get_data_slot_dir } from "../engine/paths.js";

// Time constants
export const MINUTES_PER_HOUR = 60;
export const HOURS_PER_DAY = 24;
export const MINUTES_PER_DAY = MINUTES_PER_HOUR * HOURS_PER_DAY;

// Day names
export const DAY_NAMES = [
  "Firstday",
  "Seconday", 
  "Thirday",
  "Fourday",
  "Fiveday",
  "Sixday",
  "Sevenday"
];

// Month names (THAUMWORLD calendar)
export const MONTH_NAMES = [
  "Thawmelt",
  "Bloomtide",
  "Highsun",
  "Goldharvest",
  "Frostfall",
  "Deepwinter"
];

export type GameTime = {
  minute: number;      // 0-59
  hour: number;        // 0-23
  day: number;         // 1-30 (days in month)
  month: number;       // 0-5 (6 months)
  year: number;        // Game year
  total_minutes: number; // Total minutes since game start
};

export type TimeOfDay = "night" | "dawn" | "morning" | "afternoon" | "dusk" | "evening";

/**
 * Initialize time storage for a data slot
 */
export function initialize_time_storage(slot: number): void {
  const time_path = get_time_path(slot);
  
  if (!fs.existsSync(time_path)) {
    // Start at beginning of game time
    const initial_time: GameTime = {
      minute: 0,
      hour: 8,  // Start at 8 AM
      day: 1,
      month: 1, // Bloomtide
      year: 1,
      total_minutes: 8 * MINUTES_PER_HOUR
    };
    
    save_time(slot, initial_time);
  }
}

/**
 * Get the path to time storage
 */
function get_time_path(slot: number): string {
  return path.join(get_data_slot_dir(slot), "game_time.jsonc");
}

/**
 * Load current game time
 */
export function load_time(slot: number): GameTime | null {
  try {
    const time_path = get_time_path(slot);
    
    if (!fs.existsSync(time_path)) {
      initialize_time_storage(slot);
    }
    
    const raw = fs.readFileSync(time_path, "utf-8");
    return JSON.parse(raw) as GameTime;
  } catch (err) {
    console.error("Failed to load game time:", err);
    return null;
  }
}

/**
 * Save game time
 */
export function save_time(slot: number, time: GameTime): void {
  const time_path = get_time_path(slot);
  fs.writeFileSync(time_path, JSON.stringify(time, null, 2), "utf-8");
}

/**
 * Advance time by a number of minutes
 */
export function advance_time(slot: number, minutes: number): GameTime | null {
  const time = load_time(slot);
  if (!time) return null;
  
  let total_minutes = time.total_minutes + minutes;
  
  // Calculate new time
  const new_time = minutes_to_game_time(total_minutes);
  
  save_time(slot, new_time);
  
  return new_time;
}

/**
 * Convert total minutes to game time structure
 */
export function minutes_to_game_time(total_minutes: number): GameTime {
  const minute = total_minutes % MINUTES_PER_HOUR;
  const hour = Math.floor(total_minutes / MINUTES_PER_HOUR) % HOURS_PER_DAY;
  const day_of_year = Math.floor(total_minutes / MINUTES_PER_DAY);
  
  const days_per_month = 30;
  const day = (day_of_year % days_per_month) + 1;
  const month = Math.floor(day_of_year / days_per_month) % 6;
  const year = Math.floor(day_of_year / (days_per_month * 6)) + 1;
  
  return {
    minute,
    hour,
    day,
    month,
    year,
    total_minutes
  };
}

/**
 * Get time of day category
 */
export function get_time_of_day(time: GameTime): TimeOfDay {
  const hour = time.hour;
  
  if (hour >= 5 && hour < 7) return "dawn";
  if (hour >= 7 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 19) return "dusk";
  if (hour >= 19 && hour < 22) return "evening";
  return "night";
}

/**
 * Format game time for display
 */
export function format_game_time(time: GameTime): string {
  const hour_12 = time.hour === 0 ? 12 : time.hour > 12 ? time.hour - 12 : time.hour;
  const am_pm = time.hour >= 12 ? "PM" : "AM";
  const minute_str = time.minute.toString().padStart(2, "0");
  
  return `${hour_12}:${minute_str} ${am_pm}, ${DAY_NAMES[(time.day - 1) % 7]}, ${MONTH_NAMES[time.month]} ${time.day}, Year ${time.year}`;
}

/**
 * Format short time (HH:MM)
 */
export function format_short_time(time: GameTime): string {
  const hour_str = time.hour.toString().padStart(2, "0");
  const minute_str = time.minute.toString().padStart(2, "0");
  return `${hour_str}:${minute_str}`;
}

/**
 * Check if current time is within a range
 */
export function is_time_between(time: GameTime, start_hour: number, end_hour: number): boolean {
  const current_minutes = time.hour * MINUTES_PER_HOUR + time.minute;
  const start_minutes = start_hour * MINUTES_PER_HOUR;
  const end_minutes = end_hour * MINUTES_PER_HOUR;
  
  return current_minutes >= start_minutes && current_minutes < end_minutes;
}

/**
 * Get minutes until a specific hour
 */
export function minutes_until_hour(time: GameTime, target_hour: number): number {
  const current_minutes = time.hour * MINUTES_PER_HOUR + time.minute;
  let target_minutes = target_hour * MINUTES_PER_HOUR;
  
  if (target_minutes <= current_minutes) {
    target_minutes += MINUTES_PER_DAY; // Next day
  }
  
  return target_minutes - current_minutes;
}

/**
 * Calculate time difference in minutes
 */
export function time_difference_minutes(time1: GameTime, time2: GameTime): number {
  return Math.abs(time1.total_minutes - time2.total_minutes);
}

/**
 * Compare two times
 * Returns: -1 if time1 < time2, 0 if equal, 1 if time1 > time2
 */
export function compare_times(time1: GameTime, time2: GameTime): number {
  if (time1.total_minutes < time2.total_minutes) return -1;
  if (time1.total_minutes > time2.total_minutes) return 1;
  return 0;
}

/**
 * Check if two times are on the same day
 */
export function is_same_day(time1: GameTime, time2: GameTime): boolean {
  const day1 = Math.floor(time1.total_minutes / MINUTES_PER_DAY);
  const day2 = Math.floor(time2.total_minutes / MINUTES_PER_DAY);
  return day1 === day2;
}

/**
 * Get the start of day time
 */
export function get_start_of_day(time: GameTime): GameTime {
  const day_start = Math.floor(time.total_minutes / MINUTES_PER_DAY) * MINUTES_PER_DAY;
  return minutes_to_game_time(day_start);
}

/**
 * Get current time as minutes from start of day
 */
export function get_minutes_from_start_of_day(time: GameTime): number {
  return time.hour * MINUTES_PER_HOUR + time.minute;
}

// TODO: Add time-based event scheduling
// TODO: Add season tracking (each month could have different weather/activities)
// TODO: Add special dates/holidays
// TODO: Add time zone support if world is large enough
