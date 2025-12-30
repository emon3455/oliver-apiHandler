/*
 * Methods:
 *    init() — Initialize environment source.
 *    load() — Load environment configuration.
 *    _resolveValue() — Resolve configuration entry value.
 *    _resolveRaw() — Resolve raw environment string.
 *    _ensureConfigShape() — Ensure configuration object is valid.
 *    _normalizeName() — Normalize environment entry name.
 *    _resolveInt() — Resolve integer configuration.
 *    _resolveEnum() — Resolve enum configuration.
 */

"use strict";

/**
 * Class EnvLoader
 *
 * A defensive environment loader that reads from a configurable source (defaults to `process.env`),
 * normalizes variable names, applies defaults, enforces required values, and performs type-safe
 * coercion/validation (e.g., ints with bounds and enums with allowlists) to produce a normalized
 * runtime configuration object.
 *
 * @link #TODO
 */
class EnvLoader {
  // Default environment source for lookups; can be overridden via EnvLoader.init() (useful for tests).
  static source = process.env;

  /**
   * Initialize environment source.
   *
   * Set the source object that EnvLoader references for lookups.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/EnvLoader#init #TODO
   *
   * @param {object} sourceObject - optional override source for env values
   * @returns {void} nothing
   */
  static init(sourceObject = process.env) {
    // Set the source object for lookups
    this.source = sourceObject || process.env;
  }

  /**
   * Load environment configuration.
   *
   * Build normalized environment mapping from provided configuration.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/EnvLoader#load #TODO
   *
   * @param {object} envConfiguration - config describing each env variable
   * @returns {object} normalized environment values
   */
  static load(envConfiguration = {}) {
    // Validate provided configuration structure
    this._ensureConfigShape(envConfiguration);

    // Define the normalized environment map
    const normalizedEnvironment = {};
    // Iterate each global configuration entry
    for (const envEntry of envConfiguration.global) {
      // Normalize the entry name for lookups
      const normalizedName = this._normalizeName(envEntry);
      // Skip entries without valid names
      if (!normalizedName) continue;
      // Assign resolved value for normalized name
      normalizedEnvironment[normalizedName] = this._resolveValue(
        // Pass env entry to resolver
        envEntry,
        // Pass normalized name to resolver
        normalizedName,
        // Finalize resolver call
      );
    }
    // Return normalized environment result
    return normalizedEnvironment;
  }

  /**
   * Resolve configuration entry value.
   *
   * Derive normalized value for a single environment specification entry.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/EnvLoader#_resolveValue #TODO
   *
   * @param {object} envEntry - specification for environment value
   * @param {string} normalizedName - trimmed environment variable name
   * @returns {*} resolved value based on declared type
   */
  static _resolveValue(envEntry, normalizedName) {
    // Resolve raw string from configured source
    const rawValue = this._resolveRaw(normalizedName);
    // Determine normalized value using provided defaults
    const normalizedValue =
      // Evaluate default usage condition
      rawValue === "" && envEntry.default !== undefined
        ? // Convert default fallback to trimmed string
          String(envEntry.default).trim()
        : // Keep raw value when defaults are absent
          rawValue;
    // Reject missing required values
    if (envEntry.required && normalizedValue === "") {
      // Raise missing required env error
      throw new Error(`EnvLoader: missing required env "${normalizedName}"`);
    }
    // Handle empty normalized values
    if (normalizedValue === "") {
      // Preserve empty string for optional entries
      return normalizedValue;
    }
    // Handle integer typed entries
    if (envEntry.type === "int") {
      // Delegate to integer resolver
      return this._resolveInt(normalizedName, normalizedValue, envEntry);
    }
    // Handle enum typed entries
    if (envEntry.type === "enum") {
      // Delegate to enum resolver
      return this._resolveEnum(normalizedName, normalizedValue, envEntry);
    }
    // Return normalized value when no type casting required
    return normalizedValue;
  }

  /**
   * Resolve raw environment string.
   *
   * Retrieve trimmed value from the current source map.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/EnvLoader#_resolveRaw #TODO
   *
   * @param {string} normalizedName - name to read from the source
   * @returns {string} trimmed source value
   */
  static _resolveRaw(normalizedName) {
    // Read value from source map
    const sourceValue = this.source[normalizedName];
    // Provide empty string when value missing
    if (sourceValue === undefined || sourceValue === null) return "";
    // Return trimmed string representation
    return String(sourceValue).trim();
  }

  /**
   * Ensure configuration object is valid.
   *
   * Validate top level shape of the provided config.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/EnvLoader#_ensureConfigShape #TODO
   *
   * @param {object} envConfiguration - configuration to validate
   * @returns {void} nothing
   */
  static _ensureConfigShape(envConfiguration) {
    // Guard against missing or non-object configurations
    if (!envConfiguration || typeof envConfiguration !== "object") {
      // Raise configuration required error
      throw new Error("EnvLoader.load requires a configuration object");
    }
    // Guard against missing global array
    if (!Array.isArray(envConfiguration.global)) {
      // Raise missing global array error
      throw new Error("EnvLoader.load requires a `global` array of env specs");
    }
  }

  /**
   * Normalize environment entry name.
   *
   * Ensure the provided entry carries a string name and trim whitespace.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/EnvLoader#_normalizeName #TODO
   *
   * @param {object} envEntry - env entry metadata to evaluate
   * @returns {string} trimmed entry name or empty string when invalid
   */
  static _normalizeName(envEntry) {
    // Validate env entry presence and structure
    if (!envEntry || typeof envEntry.name !== "string") {
      // Return empty string for invalid entries
      return "";
    }
    // Trim and return normalized name
    return envEntry.name.trim();
  }

  /**
   * Resolve integer configuration.
   *
   * Parse and validate integer env values against declared bounds.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/EnvLoader#_resolveInt #TODO
   *
   * @param {string} normalizedName - name of the environment variable
   * @param {string} normalizedValue - string content to parse
   * @param {object} envEntry - env entry configuration for validation
   * @returns {number} validated integer value
   */
  static _resolveInt(normalizedName, normalizedValue, envEntry) {
    // Parse normalized value to integer
    const parsedInteger = Number(normalizedValue);
    // Ensure parsed value is an integer
    if (!Number.isFinite(parsedInteger) || !Number.isInteger(parsedInteger)) {
      // Raise integer requirement error
      throw new Error(`EnvLoader: "${normalizedName}" must be an integer`);
    }
    // Enforce minimum bound when configured
    if (typeof envEntry.min === "number" && parsedInteger < envEntry.min) {
      // Raise minimum constraint violation
      throw new Error(
        `EnvLoader: "${normalizedName}" must be >= ${envEntry.min}`,
      );
    }
    // Enforce maximum bound when configured
    if (typeof envEntry.max === "number" && parsedInteger > envEntry.max) {
      // Raise maximum constraint violation
      throw new Error(
        `EnvLoader: "${normalizedName}" must be <= ${envEntry.max}`,
      );
    }
    // Return validated integer
    return parsedInteger;
  }

  /**
   * Resolve enum configuration.
   *
   * Match normalized value against allowed enum entries.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/EnvLoader#_resolveEnum #TODO
   *
   * @param {string} normalizedName - name of the environment variable
   * @param {string} normalizedValue - value to match against enums
   * @param {object} envEntry - enum configuration metadata
   * @returns {string} matched enum value
   */
  static _resolveEnum(normalizedName, normalizedValue, envEntry) {
    // Determine allowed options list
    const allowedOptions = Array.isArray(envEntry.allowed)
      ? envEntry.allowed
      : [];
    // Locate matching option ignoring case
    const matchedOption = allowedOptions.find((allowedOption) => {
      // Skip options that are not strings
      if (typeof allowedOption !== "string") {
        // Continue search when option invalid
        return false;
      }
      // Compare option to normalized value ignoring case
      return allowedOption.toLowerCase() === normalizedValue.toLowerCase();
    });
    // Reject unmatched values
    if (!matchedOption) {
      // Raise enum mismatch error
      throw new Error(
        `EnvLoader: "${normalizedName}" must be one of: ${allowedOptions.join(
          ", ",
        )}`,
      );
    }
    // Return matched enum value
    return matchedOption;
  }
}

module.exports = EnvLoader;
