/**
 * Constants for the Moss plugins marketplace.
 *
 * The marketplace source can be overridden with
 * MOSS_OFFICIAL_MARKETPLACE_REPO.
 */

import type { MarketplaceSource } from './schemas.js'

/**
 * Source configuration for the Moss plugins marketplace.
 * Used when auto-installing the marketplace on startup.
 */
export const OFFICIAL_MARKETPLACE_SOURCE = {
  source: 'github',
  repo: process.env.MOSS_OFFICIAL_MARKETPLACE_REPO || 'moss/moss-plugins-official',
} as const satisfies MarketplaceSource

/**
 * Display name for the official marketplace.
 * This is the name under which the marketplace will be registered
 * in the known_marketplaces.json file.
 */
export const OFFICIAL_MARKETPLACE_NAME = 'moss-plugins-official'
