/**
 * Shared browser-side draft event contract.
 *
 * This file intentionally contains JSDoc only. It gives the data engine and UI
 * modules one importable source of truth without adding a runtime dependency.
 */

/**
 * @typedef {Object} DraftPlayer
 * @property {string|number|null} id
 * @property {string} name
 * @property {string} position
 * @property {string} team
 * @property {boolean} is_rookie
 * @property {boolean} is_veteran
 * @property {number|null} years_exp
 * @property {string|null} college
 * @property {number|null} age
 * @property {string|number|null} number
 * @property {string|null} height
 * @property {string|null} weight
 * @property {number|null} depth_chart_order
 * @property {string|null} depth_chart_position
 * @property {string|null} injury_status
 * @property {string|null} status
 */

/**
 * @typedef {Object} DraftPick
 * @property {number} pick_no
 * @property {number} round
 * @property {number} draft_slot
 * @property {string} team_name
 * @property {string} team_owner
 * @property {string} team_username
 * @property {string|null} team_avatar
 * @property {DraftPlayer} player
 * @property {number|null} adp
 * @property {number|null} adp_diff
 * @property {"reach"|"value"|null} adp_flag
 */

/**
 * @typedef {Object} DraftTeam
 * @property {number} slot
 * @property {string} name
 * @property {string} owner_name
 * @property {string} username
 * @property {string|null} avatar
 */

/**
 * @typedef {Object} OnDeckTeam
 * @property {number} pick_no
 * @property {number} round
 * @property {number} slot
 * @property {string} name
 * @property {string} owner_name
 * @property {string|null} avatar
 */

/**
 * @typedef {Object} DraftClockState
 * @property {"CLOCK"} type
 * @property {number} pick_no
 * @property {number} round
 * @property {number|null} rounds
 * @property {number} teams
 * @property {string|null} draft_status
 * @property {string} on_clock
 * @property {string} on_clock_owner
 * @property {string|null} on_clock_avatar
 * @property {OnDeckTeam[]} on_deck
 * @property {number|null} deadline
 * @property {number} pick_timer
 */

/**
 * @typedef {Object} LeagueContext
 * @property {string[]} roster_positions
 * @property {Record<string, number>} scoring_settings
 * @property {Record<string, unknown>} draft_settings
 * @property {string|null} scoring_type
 */

/** @typedef {{type:"UNCONFIGURED"}} UnconfiguredDraftEvent */
/** @typedef {{type:"RESET"}} ResetDraftEvent */
/** @typedef {{type:"PICK", ts:number, data:DraftPick}} PickDraftEvent */
/** @typedef {{type:"COMPLETE", ts:number, all_picks:DraftPick[]}} CompleteDraftEvent */
/** @typedef {{type:"TRADE", ts:number, data:Record<string, unknown>}} TradeDraftEvent */
/** @typedef {{type:"HISTORY", all_picks:DraftPick[], clock:DraftClockState, league_context:LeagueContext}} HistoryDraftEvent */
/** @typedef {{type:"TEAMS", teams_order:DraftTeam[], clock:DraftClockState}} TeamsDraftEvent */
/** @typedef {{type:"PICK_TAGS", revision:number, updates:Array<{pick_no:number, player:Partial<DraftPlayer>}>}} PickTagsDraftEvent */
/** @typedef {{type:"FEED_STATUS", status:"delayed"|"restored", message?:string}} FeedStatusDraftEvent */
/** @typedef {{type:"SYNC", draft_id:string, revision:number, pick_count:number, server_time:number}} SyncDraftEvent */

/**
 * @typedef {Object} InitDraftEvent
 * @property {"INIT"} type
 * @property {string} draft_id
 * @property {DraftPick[]} all_picks
 * @property {DraftTeam[]} teams_order
 * @property {DraftClockState} clock
 * @property {boolean} draft_complete
 * @property {string|null} draft_status
 * @property {LeagueContext} league_context
 * @property {boolean} adp_available
 * @property {number} revision
 * @property {number} server_time
 */

/**
 * @typedef {UnconfiguredDraftEvent|ResetDraftEvent|InitDraftEvent|HistoryDraftEvent|PickDraftEvent|PickTagsDraftEvent|DraftClockState|TeamsDraftEvent|TradeDraftEvent|CompleteDraftEvent|FeedStatusDraftEvent|SyncDraftEvent} DraftEvent
 */

export {};
