/*
 * Methods:
 *    addError() — Add an error entry to the error log.
 *    hasErrors() — Check if any errors have been logged.
 *    getAllErrors() — Retrieve all logged errors.
 *    clear() — Clear all logged errors.
 */

"use strict";

/**
 * Class ErrorHandler
 *
 * Handles error logging, storage, and retrieval for the application.
 *
 * @link https://docs.example.com/ErrorHandler #TODO
 */
class ErrorHandler {
  /**
   * Static array to store error entries.
   *
   * @type {Array<object>}
   */
  static errors = [];

  /**
   * Add an error entry to the error log.
   *
   * Creates a timestamp and stores the error message with additional data.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/ErrorHandler#addError #TODO
   *
   * @param {string} message - The error message to log.
   * @param {object} [data={}] - Optional additional error details.
   *
   * @returns {void} Logs the error in the internal array.
   */
  static addError(message, data = {}) {
    // Create a timestamp for the error
    const timestamp = new Date().toISOString();

    // Insert the error entry into the errors array
    this.errors.push({ message, data, timestamp });
  }

  /**
   * Check if any errors have been logged.
   *
   * Returns a boolean indicating whether the error log contains entries.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/ErrorHandler#hasErrors #TODO
   *
   * @returns {boolean} True if there are logged errors, false otherwise.
   */
  static hasErrors() {
    // Return true if there are any logged errors
    return this.errors.length > 0;
  }

  /**
   * Retrieve all logged errors.
   *
   * Returns the full list of recorded error objects.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/ErrorHandler#getAllErrors #TODO
   *
   * @returns {Array} An array containing all logged error entries.
   */
  static getAllErrors() {
    // Return the complete list of logged errors
    return this.errors;
  }

  /**
   * Clear all logged errors.
   *
   * Resets the internal errors array to an empty state.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/ErrorHandler#clear #TODO
   *
   * @returns {void} Empties the stored error logs.
   */
  static clear() {
    // Reset the errors array to an empty list
    this.errors = [];
  }
}

module.exports = ErrorHandler;
