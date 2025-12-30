/*
 * Methods:
 *    identifyDateFormatFromString() — Determine the detected format for a date string.
 *    generateRelativeTimestamp() — Generate a formatted timestamp optionally offset by an interval.
 *    parseIntervalToDuration() — Translate an interval descriptor into a Luxon Duration.
 *    resolveTimeZone() — Resolve an input timezone string or fall back to the default zone.
 *    applyIntervalToDateTime() — Apply an interval directive to a base Luxon DateTime.
 *    hasExceededTimestamp() — Determine whether the provided timestamp goes past the current moment.
 *    phpToLuxonFormat() — Translate PHP-style date tokens into Luxon format tokens.
 *    parseStringToLuxon() — Parse a string or timestamp into a Luxon DateTime with optional zone override.
 *    parseDateToTimestamp() — Convert a date string into a Unix timestamp in seconds.
 *    diffInSeconds() — Compute the number of seconds between two date strings.
 *    diffInHumanReadable() — Generate a human-friendly span between two dates.
 *    isValidDate() — Validates whether a date string matches a specific format exactly.
 *    getStartOfDay() — Returns the start of the day (00:00:00) for a given date.
 *    getEndOfDay() — Returns the end of the day (23:59:59) for a given date.
 *    addDays() — Add a number of days to a given date string.
 *    getNextOccurrence() — Calculate the next weekday occurrence at a specified time.
 *    convertTimezone() — Convert a value into a datetime string in another timezone.
 *    buildDateTimeForConversion() — Build a Luxon DateTime from various input types for conversion helpers.
 *    isPast() — Determine whether the provided date string refers to a past moment.
 *    isFuture() — Determine whether the provided date string occurs in the future.
 *    isBetween() — Check whether a date string lies within a provided range.
 *    isValidFormat() — Validate whether the provided format string is supported.
 *    now() — Returns the current time formatted, with optional timezone.
 *    timeToMinutes() — Converts a time string (HH:mm or HH:mm:ss) to total minutes.
 *    getRelativeTime() — Convert a Unix timestamp into a condensed relative label.
 *    formatPrettyRelativeTime() — Return a human-friendly relative time string like '2 minutes ago'.
 *    formatDate() — Converts a date from one format to another.
 *    getDefaultTimeZone() — Return the current default timezone applied by helpers.
 *    setDefaultTimeZone() — Configure the default timezone used by future helpers.
 *    normalizeToHongKong() — Normalize supported inputs into a Luxon DateTime set to the default zone.
 *    isWithinPastSeconds() — Assess whether a timestamp lies within the past N seconds.
 *    isWithinNextSeconds() — Determine if a timestamp occurs within the upcoming seconds window.
 *    isWithinRelativeWindow() — Check whether a timestamp is within a configurable past and future window.
 *    isDateStringWithinRelativeWindow() — Validate that a date string parses inside a relative window around now.
 *    isNowBetweenOffsetSeconds() — Check if the current time lies within offset bounds around a base timestamp.
 *    isTimestampBetween() — Determine whether a timestamp lies between two bounds.
 *    getTimezoneOffsetInMinutes() — Calculate the offset in minutes between two zones at a reference instant.
 *    getTimezoneOffsetFromHongKongToLocal() — Compute the minute offset from Hong Kong to a local zone.
 *    convertHongKongToLocal() — Convert a Hong Kong timestamp string into a specified local timezone.
 *    convertLocalToHongKong() — Convert a local timezone date string to Hong Kong/default timezone.
 *    toUnixTimestamp() — Convert supported values into a Unix timestamp in seconds.
 *    getDayOfWeek() — Determine the weekday index for a date string.
 *    getWeekNumber() — Retrieve the ISO week number for a date string.
 *    fromUnixTimestamp() — Format a Unix timestamp into a string in the desired timezone.
 *    isNowBetween() — Evaluate whether the current moment falls between two date strings.
 *    isDateTimeBetween() — Determine whether an arbitrary datetime falls inside a window, supporting overnight spans.
 *    doRangesOverlap() — Determine whether two date ranges overlap.
 *    listDaysInRange() — List each ISO date string for a range of days between two dates.
 */

"use strict";

const { DateTime: LuxonDateTime, Duration, Settings } = require("luxon");

// App-level defaults so every helper uses the same IANA zone and formatter.
// Keep the zone in sync with Luxon by applying it immediately.
// Default timezone shared across DateTime helpers.
const DEFAULT_TIME_ZONE = "Asia/Hong_Kong";
// Default string format for output when none is provided.
const DEFAULT_OUTPUT_FORMAT = "yyyy-MM-dd HH:mm:ss";

// Apply the default timezone to Luxon's global Settings.
Settings.defaultZone = DEFAULT_TIME_ZONE;

/**
 * Class DateTime
 *
 * A collection of static methods for date and time manipulation using Luxon.
 *
 * @link #TODO
 */
class DateTime {
  // Reflects the compiled constant so callers can read it without instantiating.
  static DEFAULT_TIME_ZONE = DEFAULT_TIME_ZONE;
  // Tracks the runtime override when `setDefaultTimeZone` updates the zone.
  static _runtimeDefaultTimeZone = DEFAULT_TIME_ZONE;

  /**
   * Determine the detected format for a date string.
   *
   * Validate the characters and structure of the string to pick a matching identifier.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/DateTime#identifyDateFormatFromString #TODO
   *
   * @param {string} candidateDateString - Input string to examine.
   * @returns {string|false} Format identifier or false when detection fails.
   */
  static identifyDateFormatFromString(candidateDateString) {
    // Verify that the input is a non-empty string
    if (
      typeof candidateDateString !== "string" ||
      !candidateDateString.trim()
    ) {
      // Return false when the input cannot be interpreted
      return false;
    }

    // Trim whitespace from the date input
    const trimmedCandidateDateString = candidateDateString.trim();

    // Check for ISO separator presence
    if (trimmedCandidateDateString.includes("T")) {
      // Build a Luxon object from the ISO representation
      const isoParseAttemptDateTime = LuxonDateTime.fromISO(
        trimmedCandidateDateString,
      );
      // Return ISO identifier when parsing succeeded
      if (isoParseAttemptDateTime.isValid) {
        // Return ISO identifier when parsing succeeded
        return "iso";
      }
    }

    // Detect a datetime with a space delimiter
    if (trimmedCandidateDateString.includes(" ")) {
      // Return full datetime format when space is present
      return "Y-m-d H:i:s";
    }

    // Count dash separators for format inference
    const dashSeparatorCount = (trimmedCandidateDateString.match(/-/g) || [])
      .length;

    // Evaluate full date structure with three segments
    if (dashSeparatorCount === 2) {
      // Split the string by dash characters
      const fullDateSegments = trimmedCandidateDateString.split("-");
      // Confirm each segment is numeric
      if (
        fullDateSegments.length === 3 &&
        fullDateSegments.every((dateSegment) => /^\d+$/.test(dateSegment))
      ) {
        // Return full date identifier when segments match
        return "Y-m-d";
      }
    }

    // Evaluate year-month structure with two segments
    if (dashSeparatorCount === 1) {
      // Split the string into year and month
      const yearMonthSegments = trimmedCandidateDateString.split("-");
      // Confirm both segments are digits
      if (
        yearMonthSegments.length === 2 &&
        yearMonthSegments.every((dateSegment) => /^\d+$/.test(dateSegment))
      ) {
        // Return year-month identifier
        return "Y-m";
      }
    }

    // Check for year-only format
    if (
      candidateDateString.length === 4 &&
      /^\d{4}$/.test(candidateDateString)
    ) {
      // Return year identifier when four digits provided
      return "Y";
    }

    // Return false when no known format matches
    return false;
  }

  /**
   * Generate a formatted timestamp optionally offset by an interval.
   *
   * Build a Luxon DateTime in the resolved zone and format the output accordingly.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/DateTime#generateRelativeTimestamp #TODO
   *
   * @param {string} desiredFormat - Desired Luxon format string.
   * @param {string|number|null} intervalDescriptor - Offset interval or Unix timestamp to apply.
   * @param {string|null} timeZoneOverride - Optional IANA timezone override.
   * @returns {string|false} Formatted timestamp or false when adjustment fails.
   */
  static generateRelativeTimestamp(
    desiredFormat = DEFAULT_OUTPUT_FORMAT,
    intervalDescriptor = null,
    timeZoneOverride = null,
  ) {
    // Resolve the timezone that should be used
    const resolvedTimeZone = this.resolveTimeZone(timeZoneOverride);
    // Build the current DateTime in the resolved zone
    let baselineDateTimeInZone = LuxonDateTime.now().setZone(resolvedTimeZone);
    // Fall back to the default timezone when the resolved one is invalid
    if (!baselineDateTimeInZone.isValid) {
      // Reset the DateTime using the fallback timezone
      baselineDateTimeInZone = LuxonDateTime.now().setZone(
        this.getDefaultTimeZone(),
      );
    }

    // Determine the output format to use
    const outputFormatToUse = desiredFormat || DEFAULT_OUTPUT_FORMAT;

    // Bypass interval handling when none provided
    if (intervalDescriptor === null || intervalDescriptor === undefined) {
      // Return the formatted timestamp immediately
      return baselineDateTimeInZone.toFormat(outputFormatToUse);
    }

    // Apply the requested interval to the DateTime
    const intervalAdjustedDateTime = this.applyIntervalToDateTime(
      baselineDateTimeInZone,
      intervalDescriptor,
      resolvedTimeZone,
    );
    // Validate the adjusted DateTime before formatting
    if (!intervalAdjustedDateTime || !intervalAdjustedDateTime.isValid) {
      // Return false when adjustment fails
      return false;
    }

    // Format and return the adjusted DateTime
    return intervalAdjustedDateTime.toFormat(outputFormatToUse);
  }

  /**
   * Translate an interval descriptor into a Luxon Duration.
   *
   * Parse value-unit pairs from the string and accumulate totals per unit.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/DateTime#parseIntervalToDuration #TODO
   *
   * @param {string} intervalDescriptor - Relative interval string to evaluate.
   * @returns {Duration} Duration object representing the parsed interval.
   */
  static parseIntervalToDuration(intervalDescriptor) {
    // Ensure the interval is provided as a non-empty string
    if (typeof intervalDescriptor !== "string" || !intervalDescriptor.trim()) {
      // Throw when the input format is invalid
      throw new Error("Invalid interval format");
    }
    // Capture allowed tokens via regex
    const intervalTokenPattern =
      /([+-]?\d+)\s*(second|minute|hour|day|week|month|year)s?/gi;
    // Collect all matches from the interval string
    const intervalTokenMatches = [
      ...intervalDescriptor.matchAll(intervalTokenPattern),
    ];
    // Guard when no valid tokens were found
    if (!intervalTokenMatches.length) {
      // Throw when the parsed matches do not exist
      throw new Error("Invalid interval format");
    }

    // Accumulate duration components per unit
    const durationTotalsByUnit = {};
    // Iterate through each regex match to build totals
    intervalTokenMatches.forEach((intervalMatch) => {
      // Parse the numeric magnitude
      const parsedIntervalAmount = parseInt(intervalMatch[1], 10);
      // Normalize the unit string
      const normalizedDurationUnit = intervalMatch[2].toLowerCase();
      // Add the parsed amount to the running total for the unit
      durationTotalsByUnit[normalizedDurationUnit] =
        (durationTotalsByUnit[normalizedDurationUnit] || 0) +
        parsedIntervalAmount;
    });

    // Return a Luxon duration built from the accumulated parts
    return Duration.fromObject(durationTotalsByUnit);
  }

  /**
   * Resolve an input timezone string or fall back to the default zone.
   *
   * Validate the trimmed timezone using Luxon and return it when valid.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/DateTime#resolveTimeZone #TODO
   *
   * @param {string|null} timeZoneCandidate - Candidate timezone identifier.
   * @returns {string} Final timezone to use.
   */
  static resolveTimeZone(timeZoneCandidate) {
    // Check if the provided timezone is a non-empty string
    if (typeof timeZoneCandidate === "string" && timeZoneCandidate.trim()) {
      // Trim whitespace from the timezone string
      const trimmedTimeZoneIdentifier = timeZoneCandidate.trim();
      // Create a DateTime instance to validate the trimmed zone
      const validationDateTimeForTrimmedZone = LuxonDateTime.now().setZone(
        trimmedTimeZoneIdentifier,
      );
      // Check whether Luxon considers the trimmed zone identifier valid
      if (validationDateTimeForTrimmedZone.isValid) {
        // Return the trimmed zone identifier
        return trimmedTimeZoneIdentifier;
      }
    }
    // Fall back to the configured default timezone
    return this.getDefaultTimeZone();
  }

  /**
   * Apply an interval directive to a base Luxon DateTime.
   *
   * Support numeric timestamps or human-friendly interval strings to adjust the base.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/DateTime#applyIntervalToDateTime #TODO
   *
   * @param {LuxonDateTime} baseDateTime - DateTime to adjust.
   * @param {string|number} intervalDescriptor - Interval string or Unix timestamp.
   * @param {string|null} targetZoneIdentifier - Timezone to apply for numeric timestamps.
   * @returns {LuxonDateTime|null} Adjusted DateTime or null when invalid.
   */
  static applyIntervalToDateTime(
    baseDateTime,
    intervalDescriptorOrUnixTimestamp,
    targetZoneIdentifier,
  ) {
    // Handle numeric intervals as Unix seconds
    if (typeof intervalDescriptorOrUnixTimestamp === "number") {
      // Build a DateTime from the numeric seconds in the provided zone
      const numericDateTimeInTargetZone = LuxonDateTime.fromSeconds(
        intervalDescriptorOrUnixTimestamp,
      ).setZone(targetZoneIdentifier);
      // Return the numeric DateTime in the target zone when it is valid
      if (numericDateTimeInTargetZone.isValid) {
        // Return the validated numeric DateTime result
        return numericDateTimeInTargetZone;
      }
      // Fall back to the default timezone when needed
      return LuxonDateTime.fromSeconds(
        intervalDescriptorOrUnixTimestamp,
      ).setZone(this.getDefaultTimeZone());
    }

    // Handle string intervals by parsing them into durations
    if (
      typeof intervalDescriptorOrUnixTimestamp === "string" &&
      intervalDescriptorOrUnixTimestamp.trim()
    ) {
      // Wrap parsing in try/catch to handle invalid inputs
      try {
        // Apply the parsed duration to the base DateTime
        const parsedIntervalDuration = this.parseIntervalToDuration(
          intervalDescriptorOrUnixTimestamp,
        );
        // Return the base DateTime adjusted by the parsed duration
        return baseDateTime.plus(parsedIntervalDuration);
      } catch (durationParsingError) {
        // Return null when duration parsing fails
        return null;
      }
    }

    // Return null for unsupported interval types
    return null;
  }

  /**
   * Determine whether the provided timestamp goes past the current moment.
   *
   * Parse the timestamp and optional interval, then compare the offset value to now.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/DateTime#hasExceededTimestamp #TODO
   *
   * @param {string} timestampString - The timestamp string to evaluate.
   * @param {string} [relativeIntervalDescriptor] - Optional relative interval to shift the timestamp.
   * @returns {boolean} True when now is after the computed timestamp.
   */
  static hasExceededTimestamp(
    timestampString,
    relativeIntervalDescriptor = "",
  ) {
    // Parse the timestamp using the local parser
    const parsedLocalDateTime = this.parseStringToLuxon(
      timestampString,
      "local",
    );
    // Return false when the parsed timestamp is invalid
    if (!parsedLocalDateTime || !parsedLocalDateTime.isValid) {
      // Return false to signal parsing failure
      return false;
    }

    // Convert parsedLocalDateTime into the app default timezone and store the returned DateTime
    let referenceDateTimeInDefaultZone = parsedLocalDateTime.setZone(
      // Return the default timezone identifier for setZone to apply
      this.getDefaultTimeZone(),
    );

    // Return false when the reference time is invalid
    if (!referenceDateTimeInDefaultZone.isValid) {
      // Return false when the zone conversion fails
      return false;
    }

    // Check if an interval string was provided
    if (
      relativeIntervalDescriptor &&
      typeof relativeIntervalDescriptor === "string"
    ) {
      // Attempt to apply the optional interval
      try {
        // Start adding the parsed duration to the reference time
        referenceDateTimeInDefaultZone = referenceDateTimeInDefaultZone.plus(
          // Parse the interval into duration components
          this.parseIntervalToDuration(relativeIntervalDescriptor),
        );
        // Handle duration parsing failures
      } catch (intervalParsingError) {
        // Return false when the duration parsing fails
        return false;
      }
    }

    // Build the current moment in the Hong Kong timezone
    const currentHongKongDateTime =
      LuxonDateTime.now().setZone("Asia/Hong_Kong");
    // Return whether now is strictly later than the computed timestamp
    return currentHongKongDateTime > referenceDateTimeInDefaultZone;
  }

  /**
   * Translate PHP-style date tokens into Luxon format tokens.
   *
   * Provide a replacement map to swap recognized PHP characters with Luxon tokens.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/DateTime#phpToLuxonFormat #TODO
   *
   * @param {string} phpStyleFormatString - PHP-style format string.
   * @returns {string} Format string with Luxon-compatible tokens.
   */
  static phpToLuxonFormat(phpStyleFormatString) {
    // Return empty string when the format input is not a valid string
    if (
      typeof phpStyleFormatString !== "string" ||
      phpStyleFormatString.length === 0
    ) {
      // Return default empty output when validation fails
      return "";
    }
    // Define the mapping between PHP tokens and Luxon tokens
    const phpToLuxonTokenMap = {
      // Map PHP Y to Luxon yyyy
      Y: "yyyy",
      // Map PHP y to Luxon yy
      y: "yy",
      // Map PHP m to Luxon MM
      m: "MM",
      // Map PHP n to Luxon M
      n: "M",
      // Map PHP d to Luxon dd
      d: "dd",
      // Map PHP j to Luxon d
      j: "d",
      // Map PHP H to Luxon HH
      H: "HH",
      // Map PHP h to Luxon hh
      h: "hh",
      // Map PHP g to Luxon h
      g: "h",
      // Map PHP i to Luxon mm
      i: "mm",
      // Map PHP s to Luxon ss
      s: "ss",
      // Map PHP a to Luxon a
      a: "a",
      // Map PHP A to Luxon a
      A: "a",
    };

    // Replace every token using the prepared mapping
    return phpStyleFormatString.replace(
      /./g,
      (phpCharacter) => phpToLuxonTokenMap[phpCharacter] || phpCharacter,
    );
  }

  /**
   * Parse a string or timestamp into a Luxon DateTime with optional zone override.
   *
   * Detect the format, choose the zone, and return a Luxon object when valid.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/DateTime#parseStringToLuxon #TODO
   *
   * @param {string} sourceDateString - Input string to parse.
   * @param {string|null} targetTimeZoneIdentifier - Optional IANA timezone name.
   * @returns {LuxonDateTime|false} Parsed DateTime or false on failure.
   */
  static parseStringToLuxon(sourceDateString, targetTimeZoneIdentifier = null) {
    // Identify the format of the incoming string
    const detectedInputFormat =
      this.identifyDateFormatFromString(sourceDateString);
    // Return false when the format cannot be determined
    if (!detectedInputFormat) {
      // Return false when detection fails
      return false;
    }

    // Choose the timezone to use for parsing
    const zoneIdentifierToUse =
      targetTimeZoneIdentifier || this.getDefaultTimeZone();
    // Handle the ISO case explicitly
    if (detectedInputFormat === "iso") {
      // Parse and return the ISO string directly
      return LuxonDateTime.fromISO(sourceDateString, {
        zone: zoneIdentifierToUse,
      });
    }

    // Translate the detected PHP-style format into Luxon syntax
    const translatedLuxonFormat = this.phpToLuxonFormat(detectedInputFormat);
    // Return false when the translation fails
    if (!translatedLuxonFormat) {
      // Return false when translation fails
      return false;
    }

    // Parse the string using the computed Luxon format and zone
    return LuxonDateTime.fromFormat(sourceDateString, translatedLuxonFormat, {
      zone: zoneIdentifierToUse,
    });
  }

  /**
   * Convert a date string into a Unix timestamp in seconds.
   *
   * Use `parseStringToLuxon` before reducing to seconds.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/DateTime#parseDateToTimestamp #TODO
   *
   * @param {string} dateStringToParse - The string representing a date.
   * @param {string|null} timeZoneIdentifier - Optional timezone for parsing.
   * @returns {number|false} Unix timestamp in seconds or false on failure.
   */
  static parseDateToTimestamp(dateStringToParse, timeZoneIdentifier = null) {
    // Parse the string into a Luxon DateTime first
    const parsedLuxonDateTime = this.parseStringToLuxon(
      dateStringToParse,
      timeZoneIdentifier,
    );
    // Return false when the resulting DateTime is invalid
    if (!parsedLuxonDateTime || !parsedLuxonDateTime.isValid) {
      // Return false when parsing fails
      return false;
    }
    // Return the floored seconds from the DateTime
    return Math.floor(parsedLuxonDateTime.toSeconds());
  }

  /**
   * Compute the number of seconds between two date strings.
   *
   * Convert both inputs to timestamps and subtract to get the delta.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/DateTime#diffInSeconds #TODO
   *
   * @param {string} startDateString - Starting point for the difference.
   * @param {string} endDateString - Ending point for the difference.
   * @returns {number|false} Seconds distance or false when inputs are invalid.
   */
  static diffInSeconds(startDateString, endDateString) {
    // Convert the start date into a timestamp
    const startBoundaryTimestampSeconds =
      this.parseDateToTimestamp(startDateString);
    // Convert the end date into a timestamp
    const endBoundaryTimestampSeconds =
      this.parseDateToTimestamp(endDateString);

    // Return false when either timestamp conversion failed
    if (
      startBoundaryTimestampSeconds === false ||
      endBoundaryTimestampSeconds === false
    ) {
      // Return false to signal invalid timestamps
      return false;
    }

    // Return the numeric difference between end and start
    return endBoundaryTimestampSeconds - startBoundaryTimestampSeconds;
  }

  /**
   * Generate a human-friendly span between two dates.
   *
   * Build a description using the top two units that cover the delta between inputs.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/DateTime#diffInHumanReadable #TODO
   *
   * @param {string} startDateString - Start date string.
   * @param {string} endDateString - End date string.
   * @returns {string|false} Readable span or false when inputs are invalid.
   */
  static diffInHumanReadable(startBoundaryDateString, endBoundaryDateString) {
    // Convert the start date into a timestamp
    const startBoundaryTimestampSeconds = this.parseDateToTimestamp(
      startBoundaryDateString,
    );
    // Convert the end date into a timestamp
    const endBoundaryTimestampSeconds = this.parseDateToTimestamp(
      endBoundaryDateString,
    );

    // Return false when either timestamp conversion failed
    if (
      startBoundaryTimestampSeconds === false ||
      endBoundaryTimestampSeconds === false
    ) {
      // Return false to signal invalid timestamps
      return false;
    }

    // Compute the absolute difference between timestamps
    let remainingSeconds = Math.abs(
      endBoundaryTimestampSeconds - startBoundaryTimestampSeconds,
    );

    // Define units with their respective second weights
    const timeUnits = [
      // Year unit definition
      { name: "year", seconds: 31536000 },
      // Month unit definition
      { name: "month", seconds: 2592000 },
      // Day unit definition
      { name: "day", seconds: 86400 },
      // Hour unit definition
      { name: "hour", seconds: 3600 },
      // Minute unit definition
      { name: "minute", seconds: 60 },
      // Second unit definition
      { name: "second", seconds: 1 },
    ];

    // Prepare the array to hold the resulting segments
    const spanSegments = [];

    // Iterate through the units to build the descriptive parts
    for (const unitDefinition of timeUnits) {
      // Check if the current difference meets the unit threshold
      if (remainingSeconds >= unitDefinition.seconds) {
        // Determine how many whole units fit into the difference
        const wholeUnitCount = Math.floor(
          remainingSeconds / unitDefinition.seconds,
        );
        // Append the formatted unit string to the results
        spanSegments.push(
          `${wholeUnitCount} ${unitDefinition.name}${wholeUnitCount !== 1 ? "s" : ""}`,
        );
        // Subtract the accounted seconds from the remaining difference
        remainingSeconds -= wholeUnitCount * unitDefinition.seconds;
      }

      // Stop once two units have been captured
      if (spanSegments.length >= 2) {
        // Exit the loop when the desired number of entries exists
        break;
      }
    }

    // Return the joined result with comma separation
    return spanSegments.join(", ");
  }

  /**
   * Validates whether a date string matches a specific format exactly.
   *
   * Ensure the string reproduces the provided format without normalization.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/DateTime#isValidDate #TODO
   *
   * @param {string} dateString - The date string to validate.
   * @param {string} [expectedFormat='yyyy-MM-dd'] - The expected format.
   * @returns {boolean} True when the string matches the format exactly.
   */
  static isValidDate(inputDateString, expectedFormatPattern = "yyyy-MM-dd") {
    // Return false when the input is not a valid string
    if (typeof inputDateString !== "string" || inputDateString.trim() === "") {
      // Return false when the date string is missing or empty
      return false;
    }
    // Parse the string using the provided format
    const validatedDateTime = LuxonDateTime.fromFormat(
      inputDateString,
      expectedFormatPattern,
    );
    // Return whether the parsed value matches the original format
    return (
      validatedDateTime.isValid &&
      validatedDateTime.toFormat(expectedFormatPattern) === inputDateString
    );
  }

  /**
   * Converts a date from one format to another.
   *
   * Format the input string via explicit hints or automatic detection.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/DateTime#formatDate #TODO
   *
   * @param {string} inputDateString - The input date string.
   * @param {string} [desiredOutputFormat='dd/MM/yyyy'] - The desired output format.
   * @param {string|null} explicitInputFormat - Optional input format to use.
   * @returns {string|false} Formatted date string or false if invalid.
   */
  static formatDate(
    sourceDateString,
    targetFormatPattern = "dd/MM/yyyy",
    explicitInputFormatPattern = null,
  ) {
    // Declare the DateTime placeholder
    let normalizedDateTime;
    // Check if an explicit input format was provided
    if (explicitInputFormatPattern) {
      // Parse using the provided format when available
      normalizedDateTime = LuxonDateTime.fromFormat(
        sourceDateString,
        explicitInputFormatPattern,
      );
    } else {
      // Automatically parse the input string when no format is given
      normalizedDateTime = this.parseStringToLuxon(sourceDateString);
    }

    // Return false when parsing failed
    if (!normalizedDateTime || !normalizedDateTime.isValid) {
      // Return false to signal invalid parsing
      return false;
    }
    // Format and return the parsed DateTime
    return normalizedDateTime.toFormat(targetFormatPattern);
  }

  /**
   * Returns the start of the day (00:00:00) for a given date.
   *
   * Normalize the input to the start of the day in the resolved timezone.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/DateTime#getStartOfDay #TODO
   *
   * @param {string} inputDateString - The input date string.
   * @param {string|null} timeZoneIdentifier - Optional IANA timezone name.
   * @returns {string|false} Formatted datetime string or false if invalid.
   */
  static getStartOfDay(sourceDateString, targetTimeZoneIdentifier = null) {
    // Convert the input string into a timestamp
    const referenceTimestampSeconds = this.parseDateToTimestamp(
      sourceDateString,
      targetTimeZoneIdentifier,
    );
    // Return false when the timestamp conversion fails
    if (referenceTimestampSeconds === false) {
      // Return false to signal invalid timestamp
      return false;
    }

    // Build the DateTime at the given timestamp
    const resolvedZoneIdentifier = targetTimeZoneIdentifier || "Asia/Hong_Kong";
    const startOfDayDateTimeValue = LuxonDateTime.fromSeconds(
      referenceTimestampSeconds,
    )
      // Force the timezone to the provided zone or fallback to Hong Kong
      .setZone(resolvedZoneIdentifier)
      // Move to the start of the day
      .startOf("day");

    // Format and return the start-of-day datetime
    return startOfDayDateTimeValue.toFormat("yyyy-MM-dd HH:mm:ss");
  }

  /**
   * Returns the end of the day (23:59:59) for a given date.
   *
   * Normalize the input to the end of the day in the resolved timezone.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/DateTime#getEndOfDay #TODO
   *
   * @param {string} inputDateString - The input date string.
   * @param {string|null} timeZoneIdentifier - Optional IANA timezone name.
   * @returns {string|false} Formatted datetime string or false if invalid.
   */
  static getEndOfDay(sourceDateString, targetTimeZoneIdentifier = null) {
    // Determine the timezone to use
    const resolvedTimeZoneIdentifier =
      targetTimeZoneIdentifier || this.getDefaultTimeZone();
    // Parse the date string within the chosen zone
    const normalizedDateTime = this.parseStringToLuxon(
      sourceDateString,
      resolvedTimeZoneIdentifier,
    );
    // Return false when parsing failed
    if (!normalizedDateTime || !normalizedDateTime.isValid) {
      // Return false to signal invalid DateTime
      return false;
    }
    // Format the end of day and return the string
    return normalizedDateTime
      .endOf("day")
      .setZone(resolvedTimeZoneIdentifier)
      .toFormat("yyyy-MM-dd HH:mm:ss");
  }

  /**
   * Add a number of days to a given date string.
   *
   Parse the input, shift it by the provided day count, and format the result.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/DateTime#addDays #TODO
   *
   * @param {string} inputDateString - The input date string.
   * @param {number} dayDelta - Number of days to add (can be negative).
   * @param {string|null} timeZoneIdentifier - Optional timezone.
   * @returns {string|false} Formatted datetime or false on failure.
   */
  static addDays(
    baseDateString,
    dayDeltaQuantity,
    optionalTimeZoneIdentifier = null,
  ) {
    // Guard the method with a try block for safe parsing
    try {
      // Resolve the timezone or fall back to Hong Kong
      const resolvedTimeZoneIdentifier =
        optionalTimeZoneIdentifier || "Asia/Hong_Kong";
      // Parse the date string into a Luxon DateTime
      const normalizedDateTime = this.parseStringToLuxon(
        baseDateString,
        resolvedTimeZoneIdentifier,
      );
      // Validate that parsing succeeded before proceeding
      if (!normalizedDateTime || !normalizedDateTime.isValid) {
        // Return false when the parsed DateTime is invalid
        return false;
      }

      // Convert the provided days argument into a numeric value
      const parsedDayDeltaValue = Number(dayDeltaQuantity);
      // Validate that the numeric conversion is finite
      if (!Number.isFinite(parsedDayDeltaValue)) {
        // Return false when the days value is not a finite number
        return false;
      }

      // Add the number of days to the parsed DateTime
      const adjustedDateTime = normalizedDateTime.plus({
        days: parsedDayDeltaValue,
      });
      // Return the formatted result after adjustment
      return adjustedDateTime.toFormat("yyyy-MM-dd HH:mm:ss");
    } catch (unexpectedError) {
      // Catch unexpected errors gracefully
      // Return false when an exception occurs
      return false;
    }
  }

  /**
   * Calculate the next weekday occurrence at a specified time.
   *
   Validate inputs, compute the target day offset, and format the resulting DateTime.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/DateTime#getNextOccurrence #TODO
   *
   * @param {string} targetWeekdayName - e.g., 'Monday', 'Friday'.
   * @param {string} [timeOfDay='00:00:00'] - Time in HH:mm:ss format.
   * @param {string|null} timeZoneIdentifier - Optional timezone.
   * @returns {string|false} Formatted datetime or false on error.
   */
  static getNextOccurrence(
    desiredWeekdayName,
    scheduledTimeOfDay = "00:00:00",
    optionalTargetTimeZone = null,
  ) {
    // Wrap the computation in a try block to handle validation failures
    try {
      // Validate that the weekday is a non-empty string
      if (
        typeof desiredWeekdayName !== "string" ||
        !desiredWeekdayName.trim()
      ) {
        // Signal invalid weekday input
        throw new Error("Invalid weekday");
      }

      // Define mapping for lowercase weekday names to Luxon weekday numbers
      const weekdayNameToNumberMap = {
        monday: 1,
        tuesday: 2,
        wednesday: 3,
        thursday: 4,
        friday: 5,
        saturday: 6,
        sunday: 7,
      };

      // Normalize the weekday name for lookup
      const normalizedWeekdayName = desiredWeekdayName.toLowerCase();
      // Lookup the numeric representation for the normalized weekday
      const targetWeekdayNumber = weekdayNameToNumberMap[normalizedWeekdayName];
      // Guard when the weekday name is unrecognized
      if (!targetWeekdayNumber) {
        // Throw when the normalized weekday cannot be mapped
        throw new Error(`Invalid weekday: "${desiredWeekdayName}"`);
      }

      // Split the time string into hour, minute, second components
      const timeSegments = scheduledTimeOfDay.split(":");
      // Ensure the time string has either 2 or 3 segments
      if (timeSegments.length < 2 || timeSegments.length > 3) {
        // Throw when the time format is invalid
        throw new Error("Invalid time format");
      }

      // Destructure the time segments with fallback for seconds
      const [hourSegment, minuteSegment, secondSegment = "0"] = timeSegments;
      // Parse the hour component
      const hour = parseInt(hourSegment, 10);
      // Parse the minute component
      const minute = parseInt(minuteSegment, 10);
      // Parse the second component
      const second = parseInt(secondSegment, 10);

      // Validate that the parsed time components fall within valid ranges
      if (
        Number.isNaN(hour) ||
        Number.isNaN(minute) ||
        Number.isNaN(second) ||
        hour < 0 ||
        hour > 23 ||
        minute < 0 ||
        minute > 59 ||
        second < 0 ||
        second > 59
      ) {
        // Throw when any time component is invalid
        throw new Error("Invalid time format");
      }

      // Anchor the calculation to the current UTC moment
      const utcReferenceDateTime = LuxonDateTime.fromMillis(Date.now()).setZone(
        "UTC",
      );
      // Determine how many days ahead the target weekday falls
      const daysUntilNextTargetWeekday =
        (targetWeekdayNumber - utcReferenceDateTime.weekday + 7) % 7;

      // Build the candidate UTC DateTime at the desired hour/minute/second
      const candidateUtcDateTimeForWeekday = utcReferenceDateTime
        .plus({ days: daysUntilNextTargetWeekday })
        .startOf("day")
        .set({ hour, minute, second });

      // Resolve the final timezone for output
      const finalOutputZoneIdentifier =
        optionalTargetTimeZone || this.getDefaultTimeZone();
      // Convert the candidate into the desired timezone
      const convertedDateTimeInTargetZone =
        candidateUtcDateTimeForWeekday.setZone(finalOutputZoneIdentifier);
      // Validate that the converted DateTime is valid
      if (!convertedDateTimeInTargetZone.isValid) {
        // Throw when the timezone conversion fails
        throw new Error("Invalid timezone");
      }

      // Format and return the resulting datetime string
      return convertedDateTimeInTargetZone.toFormat("yyyy-MM-dd HH:mm:ss");
    } catch (exception) {
      // Return false when any exception occurs
      return false;
    }
  }

  /**
   * Convert a value into a datetime string in another timezone.
   *
   Build a DateTime from the source value, change zones, and format the output.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/DateTime#convertTimezone #TODO
   *
   * @param {number|string|Date|LuxonDateTime} valueToInterpret - Value to interpret for conversion.
   * @param {string} sourceTimeZoneIdentifier - Original timezone identifier.
   * @param {string} targetTimeZoneIdentifier - Target timezone identifier.
   * @param {string} [desiredOutputFormat='yyyy-MM-dd HH:mm:ss'] - Desired output format.
   * @returns {string|false} Converted datetime string or false on failure.
   */
  static convertTimezone(
    valueToInterpret,
    sourceTimeZoneIdentifier,
    targetTimeZoneIdentifier,
    desiredOutputFormat = "yyyy-MM-dd HH:mm:ss",
  ) {
    // Wrap the conversion in a try block to handle unexpected failures
    try {
      // Build a DateTime instance from the provided value and source zone
      const sourceDateTimeForConversion = this.buildDateTimeForConversion(
        valueToInterpret,
        sourceTimeZoneIdentifier,
      );
      // Validate that the DateTime is available and valid
      if (
        !sourceDateTimeForConversion ||
        !sourceDateTimeForConversion.isValid
      ) {
        // Return false when the source DateTime could not be built
        return false;
      }
      // Set the DateTime to the target zone
      const convertedDateTimeInTargetZone = sourceDateTimeForConversion.setZone(
        targetTimeZoneIdentifier,
      );
      // Return false when the timezone conversion fails
      if (!convertedDateTimeInTargetZone.isValid) {
        // Signal failure to convert to the new zone
        return false;
      }
      // Format and return the converted DateTime
      return convertedDateTimeInTargetZone.toFormat(desiredOutputFormat);
    } catch (conversionError) {
      // Catch unexpected exceptions during conversion
      // Return false to signal failure
      return false;
    }
  }

  /**
   * Build a Luxon DateTime from various input types for conversion helpers.
   *
   * Accept strings, Unix seconds, JS Dates, or Luxon DateTime instances.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/DateTime#buildDateTimeForConversion #TODO
   *
   * @param {number|Date|LuxonDateTime|string} valueToNormalize - Input to normalize.
   * @param {string} targetTimeZoneIdentifier - Timezone for the resulting DateTime.
   * @returns {LuxonDateTime|false} Normalized DateTime or false when unsupported.
   */
  static buildDateTimeForConversion(
    valueToNormalize,
    targetTimeZoneIdentifier,
  ) {
    // Handle string inputs via the existing parser
    if (typeof valueToNormalize === "string") {
      // Return the parsed DateTime within the requested zone
      return this.parseStringToLuxon(
        valueToNormalize,
        targetTimeZoneIdentifier,
      );
    }
    // Handle numeric inputs as Unix seconds
    if (
      typeof valueToNormalize === "number" &&
      Number.isFinite(valueToNormalize)
    ) {
      // Create a DateTime from seconds and apply the target zone
      return LuxonDateTime.fromSeconds(valueToNormalize).setZone(
        targetTimeZoneIdentifier,
      );
    }
    // Handle JS Date instances
    if (valueToNormalize instanceof Date) {
      // Convert the JS Date into a Luxon DateTime with the desired zone
      return LuxonDateTime.fromJSDate(valueToNormalize).setZone(
        targetTimeZoneIdentifier,
      );
    }
    // Handle Luxon DateTime objects directly
    if (valueToNormalize instanceof LuxonDateTime) {
      // Rezone the existing DateTime instance
      return valueToNormalize.setZone(targetTimeZoneIdentifier);
    }
    // Return false when no supported input type matches
    return false;
  }

  /**
   * Determine whether the provided date string refers to a past moment.
   *
   * Parse the input into a timestamp and compare it with the current time.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/DateTime#isPast #TODO
   *
   * @param {string} targetDateStringToEvaluate - Date string to evaluate.
   * @returns {boolean|false} True when date is before now, false otherwise.
   */
  static isPast(targetDateStringToEvaluate) {
    // Convert the input string into a Unix timestamp
    const parsedTimestampSeconds = this.parseDateToTimestamp(
      targetDateStringToEvaluate,
    );
    // Return false when the timestamp could not be parsed
    if (parsedTimestampSeconds === false) {
      // Return false when parsing fails
      return false;
    }

    // Return whether the timestamp is strictly less than the current time
    return parsedTimestampSeconds < Math.floor(Date.now() / 1000);
  }

  /**
   * Determine whether the provided date string occurs in the future.
   *
   * Parse the timestamp and compare it to the current Unix seconds count.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/DateTime#isFuture #TODO
   *
   * @param {string} targetDateStringToEvaluate - Date string to evaluate.
   * @returns {boolean|false} True when the date is after now, false otherwise.
   */
  static isFuture(targetDateStringToEvaluate) {
    // Convert the input string into a Unix timestamp
    const parsedTimestampSeconds = this.parseDateToTimestamp(
      targetDateStringToEvaluate,
    );
    // Return false when the timestamp parsing fails
    if (parsedTimestampSeconds === false) {
      // Return false to signal parsing failure
      return false;
    }

    // Return whether the timestamp is after the current time
    return parsedTimestampSeconds > Math.floor(Date.now() / 1000);
  }

  /**
   * Check whether a date string lies within a provided range.
   *
   * Build timestamps for each border and ensure the target falls between them inclusively.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/DateTime#isBetween #TODO
   *
   * @param {string} targetDateString - The date to check.
   * @param {string} rangeStartDateString - Start boundary date.
   * @param {string} rangeEndDateString - End boundary date.
   * @returns {boolean|false} True when the date is within bounds, false when invalid.
   */
  static isBetween(
    targetDateStringToCheck,
    rangeStartDateString,
    rangeEndDateString,
  ) {
    // Parse all provided date strings into timestamps
    const targetTimestampSeconds = this.parseDateToTimestamp(
      targetDateStringToCheck,
    );
    // Parse the range start date string into a seconds timestamp for the lower boundary
    const rangeStartTimestampSeconds =
      this.parseDateToTimestamp(rangeStartDateString);
    // Parse the range end date string into a seconds timestamp for the upper boundary
    const rangeEndTimestampSeconds =
      this.parseDateToTimestamp(rangeEndDateString);

    // Return false when any timestamp parsing failed
    if (
      targetTimestampSeconds === false ||
      rangeStartTimestampSeconds === false ||
      rangeEndTimestampSeconds === false
    ) {
      // Return false to signal invalid inputs
      return false;
    }

    // Return whether the target lies within the inclusive range
    return (
      targetTimestampSeconds >= rangeStartTimestampSeconds &&
      targetTimestampSeconds <= rangeEndTimestampSeconds
    );
  }

  /**
   * Validate whether the provided format string is supported.
   *
   * Attempt to format and re-parse the current time with the format to ensure Luxon accepts it.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/DateTime#isValidFormat #TODO
   *
   * @param {string} proposedFormatString - The format to check.
   * @returns {boolean} True when the format is valid for Luxon, false otherwise.
   */
  static isValidFormat(proposedFormatString) {
    // Validate that the format input is a string
    if (typeof proposedFormatString !== "string") {
      // Return false when the input is not a string
      return false;
    }
    // Return true for the empty format shortcut
    if (proposedFormatString === "") {
      // Accept the empty string as valid
      return true;
    }

    // Attempt to format and parse using Luxon to verify the format
    try {
      // Create a DateTime for now
      const currentMomentDateTime = LuxonDateTime.now();
      // Format the current time using the provided format
      const formattedCurrentMoment =
        currentMomentDateTime.toFormat(proposedFormatString);
      // Parse the formatted string back into a DateTime
      const parsedRoundTripDateTime = LuxonDateTime.fromFormat(
        formattedCurrentMoment,
        proposedFormatString,
      );
      // Return whether the round-trip parsing produced a valid DateTime
      return parsedRoundTripDateTime.isValid;
    } catch (formatValidationError) {
      // Return false when an exception occurs
      return false;
    }
  }

  /**
   * Returns the current time formatted, with optional timezone.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/DateTime#now #TODO
   *
   * @param {string} [requestedOutputFormat='yyyy-MM-dd HH:mm:ss'] - Output format.
   * @param {string|null} [optionalTimeZoneIdentifier=null] - IANA timezone name.
   * @returns {string|false} Current formatted LuxonDateTime or false on failure.
   */
  static now(
    requestedOutputFormat = DEFAULT_OUTPUT_FORMAT,
    optionalTimeZoneIdentifier = null,
  ) {
    // Resolve the timezone to use for formatting
    const resolvedTimeZone =
      optionalTimeZoneIdentifier || this.getDefaultTimeZone();

    // Return false when the format contains unsupported strftime tokens
    if (requestedOutputFormat.includes("%")) {
      // Signal failure when percent tokens exist
      return false;
    }

    // Build a DateTime instance in the selected zone
    const currentDateTimeInZone = LuxonDateTime.now().setZone(resolvedTimeZone);
    // Wrap validation and formatting in a try block
    try {
      // Fall back to the default output when the format is invalid
      if (!this.isValidFormat(requestedOutputFormat)) {
        // Format using the default output
        return currentDateTimeInZone.toFormat(DEFAULT_OUTPUT_FORMAT);
      }
      // Return the formatted string for the requested format
      return currentDateTimeInZone.toFormat(requestedOutputFormat);
    } catch (formattingError) {
      // Return false when an exception occurs
      return false;
    }
  }

  /**
   * Converts a time string (HH:mm or HH:mm:ss) to total minutes.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/DateTime#timeToMinutes #TODO
   *
   * @param {string} timeStringToConvert - Time string to convert.
   * @returns {number} Total minutes.
   * @throws {Error} When the input format is invalid.
   */
  static timeToMinutes(timeStringToConvert) {
    // Split the string into hour and minute components
    const timeSegments = timeStringToConvert.split(":");

    // Throw when the required segments are missing
    if (timeSegments.length < 2) {
      // Signal invalid format through exception
      throw new Error("Invalid time string format");
    }

    // Parse absolute hour and minute values from the segments
    const absoluteHourValue = Math.abs(parseInt(timeSegments[0], 10));
    // Parse absolute minute value from the segments
    const absoluteMinuteValue = Math.abs(parseInt(timeSegments[1], 10));

    // Throw when any parsed value is not finite
    if (
      !Number.isFinite(absoluteHourValue) ||
      !Number.isFinite(absoluteMinuteValue)
    ) {
      // Signal invalid format through exception
      throw new Error("Invalid time string format");
    }

    // Return the total minutes representation
    return absoluteHourValue * 60 + absoluteMinuteValue;
  }

  /**
   * Convert a Unix timestamp into a condensed relative label.
   *
   * Build the delta from now and return the first matching threshold tag.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/DateTime#getRelativeTime #TODO
   *
   * @param {number} unixTimestampSeconds - Unix seconds to describe.
   * @returns {string|false} Relative label or false when input invalid.
   */
  static getRelativeTime(unixTimestampSeconds) {
    // Validate that the timestamp is a numeric value
    if (
      typeof unixTimestampSeconds !== "number" ||
      isNaN(unixTimestampSeconds)
    ) {
      // Return false when the provided value is not valid
      return false;
    }

    // Compute the current time in seconds
    const currentUnixTimestampSeconds = Math.floor(Date.now() / 1000);
    // Determine the difference between now and the timestamp
    const elapsedSeconds = currentUnixTimestampSeconds - unixTimestampSeconds;

    // Return early when the event occurred less than a minute ago
    if (elapsedSeconds < 60) {
      // Return the quick "just now" label
      return "just now";
    }

    // Define the thresholds for relative labels
    const relativeThresholdSecondsMapping = {
      // Define yearly threshold
      "1y": 31536000,
      // Define monthly threshold
      "1m": 2592000,
      // Define two-week threshold
      "2w": 1209600,
      // Define weekly threshold
      "1w": 604800,
      // Define daily threshold
      "1d": 86400,
      // Define hourly threshold
      "1h": 3600,
    };

    // Iterate through each threshold entry
    for (const [thresholdTag, thresholdDurationSeconds] of Object.entries(
      relativeThresholdSecondsMapping,
    )) {
      // Check if the difference meets or exceeds the threshold
      if (elapsedSeconds >= thresholdDurationSeconds) {
        // Return the appropriate condensed label
        return `${Math.floor(elapsedSeconds / thresholdDurationSeconds)}${
          thresholdTag[thresholdTag.length - 1]
        }`;
      }
    }

    // Return fallback label when no threshold matches
    return "just now";
  }

  /**
   * Return a human-friendly relative time string like '2 minutes ago'.
   *
   * Compare now with the timestamp to build a readable description.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/DateTime#formatPrettyRelativeTime #TODO
   *
   * @param {number} unixTimestampSeconds - Unix timestamp in seconds.
   * @returns {string|false} Readable relative time or false when invalid.
   */
  static formatPrettyRelativeTime(unixTimestampSeconds) {
    // Validate that the timestamp is numeric
    if (
      typeof unixTimestampSeconds !== "number" ||
      isNaN(unixTimestampSeconds)
    ) {
      // Return false for invalid timestamp input
      return false;
    }

    // Capture the current time in seconds
    const currentUnixTimestampSeconds = Math.floor(Date.now() / 1000);
    // Compute the difference from the provided timestamp
    let elapsedSeconds = currentUnixTimestampSeconds - unixTimestampSeconds;

    // Return the immediate string when under one minute
    if (elapsedSeconds < 60) {
      // Return the quick "just now" label
      return "just now";
    }

    // Define the lookup units in descending order
    const relativeUnitDefinitions = [
      // Year unit definition
      { name: "year", seconds: 31536000 },
      // Month unit definition
      { name: "month", seconds: 2592000 },
      // Week unit definition
      { name: "week", seconds: 604800 },
      // Day unit definition
      { name: "day", seconds: 86400 },
      // Hour unit definition
      { name: "hour", seconds: 3600 },
      // Minute unit definition
      { name: "minute", seconds: 60 },
    ];

    // Search for the first unit that fits the difference
    for (const relativeUnitDefinition of relativeUnitDefinitions) {
      // Check if the diff meets the current unit threshold
      if (elapsedSeconds >= relativeUnitDefinition.seconds) {
        // Compute how many units fit into the difference
        const unitCount = Math.floor(
          elapsedSeconds / relativeUnitDefinition.seconds,
        );
        // Return the formatted string with pluralization
        return `${unitCount} ${relativeUnitDefinition.name}${
          unitCount !== 1 ? "s" : ""
        } ago`;
      }
    }

    // Return fallback text when no unit matched
    return "just now";
  }

  /**
   * Return the current default timezone applied by helpers.
   *
   * Prefer the runtime override when available, otherwise fall back to the constant.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/DateTime#getDefaultTimeZone #TODO
   *
   * @returns {string} The default timezone identifier.
   */
  static getDefaultTimeZone() {
    // Return the runtime override when it exists
    return this._runtimeDefaultTimeZone || DEFAULT_TIME_ZONE;
  }

  /**
   * Configure the default timezone used by future helpers.
   *
   * Validate the input and update the runtime override when the zone is acceptable.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/DateTime#setDefaultTimeZone #TODO
   *
   * @param {string} timeZoneCandidate - Candidate IANA timezone string.
   * @returns {boolean} True when the timezone is valid and set, false otherwise.
   */
  static setDefaultTimeZone(timeZoneCandidate) {
    // Reject non-string inputs immediately
    if (typeof timeZoneCandidate !== "string") {
      // Return false when the argument is invalid
      return false;
    }
    // Trim whitespace from the timezone string
    const trimmedTimeZoneIdentifier = timeZoneCandidate.trim();
    // Reject empty strings
    if (!trimmedTimeZoneIdentifier) {
      // Return false when trimming yields nothing
      return false;
    }

    // Validate the timezone with Luxon
    const validationDateTime = LuxonDateTime.now().setZone(
      trimmedTimeZoneIdentifier,
    );
    // Reject invalid Luxon zone results
    if (!validationDateTime.isValid) {
      // Return false when Luxon rejects the zone
      return false;
    }

    // Store the validated timezone override
    this._runtimeDefaultTimeZone = trimmedTimeZoneIdentifier;
    // Signal success to the caller
    return true;
  }

  /**
   * Normalize supported inputs into a Luxon DateTime set to the default zone.
   *
   * Accept numeric timestamps, JS Dates, Luxon DateTimes, or recognized strings.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/DateTime#normalizeToHongKong #TODO
   *
   * @param {number|Date|LuxonDateTime|string} inputValue - Value to normalize.
   * @returns {LuxonDateTime|false} Wrapped DateTime or false when unsupported.
   */
  static normalizeToHongKong(inputValue) {
    // Resolve the default timezone for normalization
    const defaultZoneIdentifier = this.getDefaultTimeZone();

    // Handle numeric Unix timestamp inputs
    if (typeof inputValue === "number" && Number.isFinite(inputValue)) {
      // Return a DateTime built from seconds and forced to the zone
      return LuxonDateTime.fromSeconds(inputValue).setZone(
        defaultZoneIdentifier,
      );
    }

    // Handle JavaScript Date instances
    if (inputValue instanceof Date) {
      // Convert the JS Date into a Luxon object in the zone
      return LuxonDateTime.fromJSDate(inputValue).setZone(
        defaultZoneIdentifier,
      );
    }

    // Handle Luxon DateTime inputs directly
    if (inputValue instanceof LuxonDateTime) {
      // Rezone the Luxon instance
      const normalizedDateTime = inputValue.setZone(defaultZoneIdentifier);
      // Return the DateTime when valid otherwise false
      return normalizedDateTime.isValid ? normalizedDateTime : false;
    }

    // Handle string inputs via the parser
    if (typeof inputValue === "string" && inputValue.trim() !== "") {
      // Parse the string according to the default zone
      const parsedDateTime = this.parseStringToLuxon(
        inputValue,
        defaultZoneIdentifier,
      );
      // Return the parsed DateTime when valid otherwise false
      return parsedDateTime && parsedDateTime.isValid ? parsedDateTime : false;
    }

    // Return false when the input type is not supported
    return false;
  }

  /**
   * Assess whether a timestamp lies within the past N seconds.
   *
   * Convert the inputs to numeric values and determine if the target falls inside the computed window.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/DateTime#isWithinPastSeconds #TODO
   *
   * @param {number} targetTimestampSeconds - Unix timestamp to evaluate.
   * @param {number} pastWindowSeconds - Number of seconds defining the past window.
   * @returns {boolean} True when the timestamp sits within the past window.
   */
  static isWithinPastSeconds(targetTimestampSeconds, pastWindowSeconds) {
    // Validate the types and finiteness of the inputs
    if (
      typeof targetTimestampSeconds !== "number" ||
      !Number.isFinite(targetTimestampSeconds) ||
      typeof pastWindowSeconds !== "number" ||
      !Number.isFinite(pastWindowSeconds)
    ) {
      // Return false when validation fails
      return false;
    }
    // Grab the current Unix timestamp
    const currentUnixTimestamp = Math.floor(Date.now() / 1000);
    // Convert the provided window size to an absolute number
    const windowSizeSeconds = Math.abs(Math.floor(pastWindowSeconds));
    // Calculate the start of the past window
    const pastWindowStart = currentUnixTimestamp - windowSizeSeconds;
    // Determine whether the timestamp sits inside the window
    return (
      targetTimestampSeconds >= pastWindowStart &&
      targetTimestampSeconds <= currentUnixTimestamp
    );
  }

  /**
   * Determine if a timestamp occurs within the upcoming seconds window.
   *
   * Normalize the inputs and compare the target to the forward window around now.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/DateTime#isWithinNextSeconds #TODO
   *
   * @param {number} targetTimestampSeconds - Unix timestamp to evaluate.
   * @param {number} futureWindowSeconds - Number of seconds advancing from now.
   * @returns {boolean} True when timestamp falls within the next window.
   */
  static isWithinNextSeconds(targetTimestampSeconds, futureWindowSeconds) {
    // Validate the numeric nature of the inputs
    if (
      typeof targetTimestampSeconds !== "number" ||
      !Number.isFinite(targetTimestampSeconds) ||
      typeof futureWindowSeconds !== "number" ||
      !Number.isFinite(futureWindowSeconds)
    ) {
      // Return false when validation fails
      return false;
    }
    // Capture the current Unix timestamp
    const currentUnixTimestamp = Math.floor(Date.now() / 1000);
    // Translate the window size into an absolute value
    const windowSizeSeconds = Math.abs(Math.floor(futureWindowSeconds));
    // Compute the end of the future window
    const futureWindowEnd = currentUnixTimestamp + windowSizeSeconds;
    // Check whether the target falls within now and the window end
    return (
      targetTimestampSeconds <= futureWindowEnd &&
      targetTimestampSeconds >= currentUnixTimestamp
    );
  }

  /**
   * Check whether a timestamp is within a configurable past and future window.
   *
   * Normalize the offsets, compute the bounds, and confirm the target stays between them.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/DateTime#isWithinRelativeWindow #TODO
   *
   * @param {number} targetTimestampSeconds - Unix timestamp to evaluate.
   * @param {number} pastWindowSeconds - Backward offset in seconds.
   * @param {number} futureWindowSeconds - Forward offset in seconds.
   * @returns {boolean} True when timestamp lies between window bounds.
   */
  static isWithinRelativeWindow(
    targetTimestampSeconds,
    pastWindowSeconds,
    futureWindowSeconds,
  ) {
    // Validate that all numeric inputs are finite numbers
    if (
      typeof targetTimestampSeconds !== "number" ||
      !Number.isFinite(targetTimestampSeconds) ||
      typeof pastWindowSeconds !== "number" ||
      !Number.isFinite(pastWindowSeconds) ||
      typeof futureWindowSeconds !== "number" ||
      !Number.isFinite(futureWindowSeconds)
    ) {
      // Return false when validation fails
      return false;
    }
    // Capture the current timestamp
    const currentUnixTimestamp = Math.floor(Date.now() / 1000);
    // Build the absolute backward window
    const pastWindowSizeSeconds = Math.abs(Math.floor(pastWindowSeconds));
    // Build the absolute forward window
    const futureWindowSizeSeconds = Math.abs(Math.floor(futureWindowSeconds));
    // Compute the start of the window
    const relativeWindowStart = currentUnixTimestamp - pastWindowSizeSeconds;
    // Compute the end of the window
    const relativeWindowEnd = currentUnixTimestamp + futureWindowSizeSeconds;
    // Determine whether the timestamp falls inside the window
    return (
      targetTimestampSeconds >= relativeWindowStart &&
      targetTimestampSeconds <= relativeWindowEnd
    );
  }

  /**
   * Validate that a date string parses inside a relative window around now.
   *
   * Convert the offsets, parse the string, and confirm it yields a timestamp.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/DateTime#isDateStringWithinRelativeWindow #TODO
   *
   * @param {string} dateStringToEvaluate - Date string to evaluate.
   * @param {number} pastWindowSeconds - Past offset window.
   * @param {number} futureWindowSeconds - Future offset window.
   * @param {string|null} timeZoneIdentifier - Optional timezone for parsing.
   * @returns {boolean} True when the string yields a timestamp.
   */
  static isDateStringWithinRelativeWindow(
    dateStringToEvaluate,
    pastWindowSeconds,
    futureWindowSeconds,
    timeZoneIdentifier = null,
  ) {
    // Validate that the provided windows are finite numbers
    if (
      // Check pastSeconds type
      typeof pastWindowSeconds !== "number" ||
      // Ensure pastSeconds is finite
      !Number.isFinite(pastWindowSeconds) ||
      // Check futureSeconds type
      typeof futureWindowSeconds !== "number" ||
      // Ensure futureSeconds is finite
      !Number.isFinite(futureWindowSeconds)
    ) {
      // Return false when the windows are invalid
      return false;
    }
    // Determine the timezone to use for parsing
    const resolvedZone = timeZoneIdentifier || this.getDefaultTimeZone();
    // Parse the date string into a timestamp
    const parsedTimestamp = this.parseDateToTimestamp(
      dateStringToEvaluate,
      resolvedZone,
    );
    // Return false when parsing failed
    if (parsedTimestamp === false) {
      // Signal failure through false
      return false;
    }
    // Return true to confirm the timestamp was obtained
    return parsedTimestamp !== false;
  }

  /**
   * Check if the current time lies within offset bounds around a base timestamp.
   *
   * Normalize the offsets, compute the window around base, and compare now to the bounds.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/DateTime#isNowBetweenOffsetSeconds #TODO
   *
   * @param {number} baseTimestampSeconds - Center point timestamp in seconds.
   * @param {number} pastOffsetSeconds - Past offset to subtract.
   * @param {number} futureOffsetSeconds - Future offset to add.
   * @returns {boolean} True when now sits within the offset window.
   */
  static isNowBetweenOffsetSeconds(
    baseTimestampSeconds,
    pastOffsetSeconds,
    futureOffsetSeconds,
  ) {
    // Validate that inputs are finite numbers
    if (
      typeof baseTimestampSeconds !== "number" ||
      !Number.isFinite(baseTimestampSeconds) ||
      typeof pastOffsetSeconds !== "number" ||
      !Number.isFinite(pastOffsetSeconds) ||
      typeof futureOffsetSeconds !== "number" ||
      !Number.isFinite(futureOffsetSeconds)
    ) {
      // Return false when validation fails
      return false;
    }
    // Capture the current Unix timestamp
    const currentUnixTimestamp = Math.floor(Date.now() / 1000);
    // Convert the past offset to an absolute value
    const pastOffsetSizeSeconds = Math.abs(Math.floor(pastOffsetSeconds));
    // Convert the future offset to an absolute value
    const futureOffsetSizeSeconds = Math.abs(Math.floor(futureOffsetSeconds));
    // Compute the start of the window around the base timestamp
    const offsetWindowStart = baseTimestampSeconds - pastOffsetSizeSeconds;
    // Compute the end of the window around the base timestamp
    const offsetWindowEnd = baseTimestampSeconds + futureOffsetSizeSeconds;
    // Determine whether now falls inside the constructed window
    return (
      currentUnixTimestamp >= offsetWindowStart &&
      currentUnixTimestamp <= offsetWindowEnd
    );
  }

  /**
   * Determine whether a timestamp lies between two bounds.
   *
   * Normalize the inputs and evaluate inclusive or exclusive membership.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/DateTime#isTimestampBetween #TODO
   *
   * @param {number} targetTimestampSeconds - The timestamp to check.
   * @param {number} startTimestampSeconds - Start boundary timestamp.
   * @param {number} endTimestampSeconds - End boundary timestamp.
   * @param {boolean} [inclusive=true] - Include the boundaries when true.
   * @returns {boolean} True when the target sits within the specified range.
   */
  static isTimestampBetween(
    targetTimestampSeconds,
    startTimestampSeconds,
    endTimestampSeconds,
    inclusive = true,
  ) {
    // Validate that the supplied timestamps are finite numbers
    if (
      typeof targetTimestampSeconds !== "number" ||
      !Number.isFinite(targetTimestampSeconds) ||
      typeof startTimestampSeconds !== "number" ||
      !Number.isFinite(startTimestampSeconds) ||
      typeof endTimestampSeconds !== "number" ||
      !Number.isFinite(endTimestampSeconds)
    ) {
      // Return false when input validation fails
      return false;
    }
    // Determine the lower bound of the range
    const rangeLowerBound = Math.min(
      startTimestampSeconds,
      endTimestampSeconds,
    );
    // Determine the upper bound of the range
    const rangeUpperBound = Math.max(
      startTimestampSeconds,
      endTimestampSeconds,
    );
    // Check the inclusive code path first
    if (inclusive) {
      // Return true when the target is within inclusive bounds
      return (
        targetTimestampSeconds >= rangeLowerBound &&
        targetTimestampSeconds <= rangeUpperBound
      );
    }
    // Return true when the target is within exclusive bounds
    return (
      targetTimestampSeconds > rangeLowerBound &&
      targetTimestampSeconds < rangeUpperBound
    );
  }

  /**
   * Calculate the offset in minutes between two zones at a reference instant.
   *
   * Build or reuse a Luxon DateTime, convert to each zone, and subtract offsets.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/DateTime#getTimezoneOffsetInMinutes #TODO
   *
   * @param {string} sourceZoneIdentifier - Source timezone identifier.
   * @param {string} targetZoneIdentifier - Target timezone identifier.
   * @param {LuxonDateTime|string|null} referenceDateTimeOrIso - Optional reference in Luxon or ISO form.
   * @returns {number|false} Offset in minutes or false on failure.
   */
  static getTimezoneOffsetInMinutes(
    sourceZoneIdentifier,
    targetZoneIdentifier,
    referenceDateTimeOrIso = null,
  ) {
    // Ensure both timezone strings are present
    if (
      // Validate the source zone string
      typeof sourceZoneIdentifier !== "string" ||
      // Ensure the source zone is not empty
      !sourceZoneIdentifier.trim() ||
      // Validate the target zone string
      typeof targetZoneIdentifier !== "string" ||
      // Ensure the target zone is not empty
      !targetZoneIdentifier.trim()
    ) {
      // Return false when inputs are invalid
      return false;
    }
    // Prepare a base DateTime reference
    let referenceDateTimeCandidate;
    // Use the provided Luxon DateTime when available
    if (referenceDateTimeOrIso instanceof LuxonDateTime) {
      referenceDateTimeCandidate = referenceDateTimeOrIso;
    }
    // Parse ISO string references via Luxon
    else if (typeof referenceDateTimeOrIso === "string") {
      // Build the DateTime from ISO string
      referenceDateTimeCandidate = LuxonDateTime.fromISO(
        referenceDateTimeOrIso,
      );
      // Return false when parsing produces an invalid DateTime
      if (!referenceDateTimeCandidate.isValid) {
        // Signal failure for invalid ISO input
        return false;
      }
    }
    // Fallback to the current moment
    else {
      // Use now when no reference is provided
      referenceDateTimeCandidate = LuxonDateTime.now();
    }
    // Convert the reference into the source timezone
    const sourceZoneDateTime =
      referenceDateTimeCandidate.setZone(sourceZoneIdentifier);
    // Convert the reference into the target timezone
    const targetZoneDateTime =
      referenceDateTimeCandidate.setZone(targetZoneIdentifier);
    // Ensure both conversions produced valid DateTimes
    if (!sourceZoneDateTime.isValid || !targetZoneDateTime.isValid) {
      // Return false when any zone conversion fails
      return false;
    }
    // Return the difference between target and source offsets
    return targetZoneDateTime.offset - sourceZoneDateTime.offset;
  }

  /**
   * Compute the minute offset from Hong Kong to a local zone.
   *
   * Delegate to the general offset helper using the configured default zone.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/DateTime#getTimezoneOffsetFromHongKongToLocal #TODO
   *
   * @param {string} localZoneIdentifier - Target local timezone.
   * @param {LuxonDateTime|string|null} referenceDateTimeOrIso - Optional reference moment.
   * @returns {number|false} Offset in minutes or false on failure.
   */
  static getTimezoneOffsetFromHongKongToLocal(
    localZoneIdentifier,
    referenceDateTimeOrIso = null,
  ) {
    // Delegate to the shared helper with the default source zone
    return this.getTimezoneOffsetInMinutes(
      this.getDefaultTimeZone(),
      localZoneIdentifier,
      referenceDateTimeOrIso,
    );
  }

  /**
   * Convert a Hong Kong timestamp string into a specified local timezone.
   *
   * Reuse the generic conversion helper with the default source zone.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/DateTime#convertHongKongToLocal #TODO
   *
   * @param {string} sourceHongKongDateString - The Hong Kong/localized date string.
   * @param {string} targetTimeZoneIdentifier - Target timezone for conversion.
   * @param {string} [desiredOutputFormat='yyyy-MM-dd HH:mm:ss'] - Output format for the result.
   * @returns {string|false} Converted datetime string or false on failure.
   */
  static convertHongKongToLocal(
    sourceHongKongDateString,
    targetTimeZoneIdentifier,
    desiredOutputFormat = "yyyy-MM-dd HH:mm:ss",
  ) {
    // Delegate conversion to the shared helper using default source zone
    return this.convertTimezone(
      sourceHongKongDateString,
      this.getDefaultTimeZone(),
      targetTimeZoneIdentifier,
      desiredOutputFormat,
    );
  }

  /**
   * Convert a local timezone date string to Hong Kong/default timezone.
   *
   * Wrap the shared helper using the default target zone.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/DateTime#convertLocalToHongKong #TODO
   *
   * @param {string} sourceLocalDateString - Date string in the local timezone.
   * @param {string} sourceTimeZoneIdentifier - Source timezone of the input.
   * @param {string} [desiredOutputFormat='yyyy-MM-dd HH:mm:ss'] - Desired output format.
   * @returns {string|false} Converted datetime string or false on failure.
   */
  static convertLocalToHongKong(
    sourceLocalDateString,
    sourceTimeZoneIdentifier,
    desiredOutputFormat = "yyyy-MM-dd HH:mm:ss",
  ) {
    // Delegate conversion to the shared helper with reversed zones
    return this.convertTimezone(
      sourceLocalDateString,
      sourceTimeZoneIdentifier,
      this.getDefaultTimeZone(),
      desiredOutputFormat,
    );
  }

  /**
   * Convert supported values into a Unix timestamp in seconds.
   *
   * Detect the input type and normalize it into seconds, using parsing helpers when necessary.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/DateTime#toUnixTimestamp #TODO
   *
   * @param {number|Date|LuxonDateTime|string} valueToCoerce - Value to coerce.
   * @param {string|null} optionalTimeZoneIdentifier - Optional timezone for string parsing.
   * @returns {number|false} Unix timestamp or false on failure.
   */
  static toUnixTimestamp(valueToCoerce, optionalTimeZoneIdentifier = null) {
    // Handle numeric Unix seconds directly
    if (typeof valueToCoerce === "number" && Number.isFinite(valueToCoerce)) {
      // Return the floored seconds when already numeric
      return Math.floor(valueToCoerce);
    }
    // Handle JavaScript Date instances
    if (valueToCoerce instanceof Date) {
      // Convert milliseconds to seconds
      return Math.floor(valueToCoerce.getTime() / 1000);
    }
    // Handle Luxon DateTime instances
    if (valueToCoerce instanceof LuxonDateTime) {
      // Use Luxon's seconds representation
      return Math.floor(valueToCoerce.toSeconds());
    }
    // Handle string inputs via the parser
    if (typeof valueToCoerce === "string" && valueToCoerce.trim() !== "") {
      // Delegate to parseDateToTimestamp with the resolved timezone
      return this.parseDateToTimestamp(
        valueToCoerce,
        optionalTimeZoneIdentifier || this.getDefaultTimeZone(),
      );
    }
    // Return false for unsupported types
    return false;
  }

  /**
   * Determine the weekday index for a date string.
   *
   * Parse the input using the optional timezone and return Luxon's weekday value when valid.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/DateTime#getDayOfWeek #TODO
   *
   * @param {string} dateString - Date string to evaluate.
   * @param {string|null} timeZoneIdentifier - Optional timezone for parsing.
   * @returns {number|false} Weekday number (1-7) or false on failure.
   */
  static getDayOfWeek(sourceDateString, optionalTimeZoneIdentifier = null) {
    // Parse the string into a Luxon DateTime
    const normalizedDateTime = this.parseStringToLuxon(
      sourceDateString,
      optionalTimeZoneIdentifier,
    );
    // Return false when the parsed DateTime is invalid
    if (!normalizedDateTime || !normalizedDateTime.isValid) {
      // Return false to signal invalid inputs
      return false;
    }
    // Return the Luxon weekday number
    return normalizedDateTime.weekday;
  }

  /**
   * Retrieve the ISO week number for a date string.
   *
   Parse the input with an optional timezone and return the week number from Luxon when valid.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/DateTime#getWeekNumber #TODO
   *
   * @param {string} dateString - Input date string.
   * @param {string|null} timeZoneIdentifier - Optional timezone override.
   * @returns {number|false} Week number or false when parsing fails.
   */
  static getWeekNumber(sourceDateString, optionalTimeZoneIdentifier = null) {
    // Convert the string into a Luxon DateTime
    const normalizedDateTime = this.parseStringToLuxon(
      sourceDateString,
      optionalTimeZoneIdentifier,
    );
    // Return false when parsing is invalid
    if (!normalizedDateTime || !normalizedDateTime.isValid) {
      // Return false to signal invalid input
      return false;
    }
    // Return the ISO week number from Luxon
    return normalizedDateTime.weekNumber;
  }

  /**
   * Format a Unix timestamp into a string in the desired timezone.
   *
   * Coerce the Unix seconds, set the zone, and format when the Luxon object is valid.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/DateTime#fromUnixTimestamp #TODO
   *
   * @param {number} timestampSeconds - Unix seconds to convert.
   * @param {string} [outputFormat=DEFAULT_OUTPUT_FORMAT] - Output format string.
   * @param {string|null} timeZoneIdentifier - Optional timezone override.
   * @returns {string|false} Formatted datetime string or false on failure.
   */
  static fromUnixTimestamp(
    unixTimestampSeconds,
    outputFormatPattern = DEFAULT_OUTPUT_FORMAT,
    optionalTimeZoneIdentifier = null,
  ) {
    // Validate that the timestamp is a finite number
    if (
      typeof unixTimestampSeconds !== "number" ||
      !Number.isFinite(unixTimestampSeconds)
    ) {
      // Return false when the timestamp is invalid
      return false;
    }
    // Resolve which timezone to use for formatting
    const resolvedTimeZone =
      optionalTimeZoneIdentifier || this.getDefaultTimeZone();
    // Build a Luxon DateTime from the Unix seconds and zone
    const dateTimeValue =
      LuxonDateTime.fromSeconds(unixTimestampSeconds).setZone(resolvedTimeZone);
    // Return the formatted string when valid otherwise false
    return dateTimeValue.isValid
      ? dateTimeValue.toFormat(outputFormatPattern)
      : false;
  }

  /**
   * Evaluate whether the current moment falls between two date strings.
   *
   Normalize both boundaries into the same timezone and use timestamp math to inspect wrapping ranges.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/DateTime#isNowBetween #TODO
   *
   * @param {string} startDateString - Start boundary date string.
   * @param {string} endDateString - End boundary date string.
   * @param {string|null} timeZoneIdentifier - Optional timezone for evaluation.
   * @returns {boolean} True when now lies between the normalized boundaries.
   */
  static isNowBetween(
    windowStartDateString,
    windowEndDateString,
    optionalTimeZoneIdentifier = null,
  ) {
    // Resolve the zone to perform the comparison
    const comparisonTimeZoneIdentifier =
      optionalTimeZoneIdentifier || this.getDefaultTimeZone();
    // Cache the default zone for conversions
    const defaultZoneIdentifier = this.getDefaultTimeZone();
    // Parse the start boundary into a timestamp
    const startBoundaryTimestampSeconds = this.parseDateToTimestamp(
      windowStartDateString,
      comparisonTimeZoneIdentifier,
    );
    // Parse the end boundary into a timestamp
    const endBoundaryTimestampSeconds = this.parseDateToTimestamp(
      windowEndDateString,
      comparisonTimeZoneIdentifier,
    );
    // Return false when either boundary fails parsing
    if (
      startBoundaryTimestampSeconds === false ||
      endBoundaryTimestampSeconds === false
    ) {
      // Return false to signal invalid boundaries
      return false;
    }
    // Build a UTC reference for the current moment
    const utcReferenceDateTime = LuxonDateTime.fromMillis(Date.now(), {
      zone: "UTC",
    });
    // Set the reference into the default zone while keeping local time
    const defaultZoneReferenceDateTime = utcReferenceDateTime.setZone(
      defaultZoneIdentifier,
      {
        // Preserve the same clock time when changing zones
        keepLocalTime: true,
      },
    );
    // Rezone the base reference into the comparison zone
    const comparisonMomentDateTime = defaultZoneReferenceDateTime.setZone(
      comparisonTimeZoneIdentifier,
    );
    // Convert the start timestamp into a DateTime within the zone
    const startBoundaryDateTimeInZone = LuxonDateTime.fromSeconds(
      startBoundaryTimestampSeconds,
    ).setZone(comparisonTimeZoneIdentifier);
    // Convert the end timestamp into a DateTime within the zone
    const endBoundaryDateTimeInZone = LuxonDateTime.fromSeconds(
      endBoundaryTimestampSeconds,
    ).setZone(comparisonTimeZoneIdentifier);
    // Record the current timestamp for comparison
    const comparisonMomentTimestampSeconds = Math.floor(
      comparisonMomentDateTime.toSeconds(),
    );
    // Normalize the start DateTime to integer seconds
    const normalizedStartBoundarySeconds = Math.floor(
      startBoundaryDateTimeInZone.toSeconds(),
    );
    // Normalize the end DateTime to integer seconds
    const normalizedEndBoundarySeconds = Math.floor(
      endBoundaryDateTimeInZone.toSeconds(),
    );
    // Check the normal ordering case where start <= end
    if (normalizedStartBoundarySeconds <= normalizedEndBoundarySeconds) {
      // Delegate to timestamp comparison when boundaries are non-overnight
      return this.isTimestampBetween(
        comparisonMomentTimestampSeconds,
        normalizedStartBoundarySeconds,
        normalizedEndBoundarySeconds,
        true,
      );
    }
    const wrappedEndBoundarySeconds = Math.floor(
      endBoundaryDateTimeInZone.plus({ days: 1 }).toSeconds(),
    );
    // Return whether now falls in the wrapped overnight range
    return (
      comparisonMomentTimestampSeconds >= normalizedStartBoundarySeconds ||
      comparisonMomentTimestampSeconds <= wrappedEndBoundarySeconds
    );
  }

  /**
   * Determine whether an arbitrary datetime falls inside a window, supporting overnight spans.
   *
   * Normalize all inputs to the same timezone and use timestamp comparisons to evaluate wrapping cases.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/DateTime#isDateTimeBetween #TODO
   *
   * @param {string} targetDateTimeString - The datetime to test.
   * @param {string} windowStartDateString - Start boundary of the window.
   * @param {string} windowEndDateString - End boundary of the window.
   * @param {string|null} optionalTimeZoneIdentifier - Optional timezone for parsing.
   * @returns {boolean} True when the datetime lies within the window.
   */
  static isDateTimeBetween(
    targetDateTimeString,
    windowStartDateString,
    windowEndDateString,
    optionalTimeZoneIdentifier = null,
  ) {
    // Resolve the timezone for the comparison
    const comparisonTimeZoneIdentifier =
      optionalTimeZoneIdentifier || this.getDefaultTimeZone();
    // Parse the target datetime into a timestamp
    const targetDateTimeTimestampSeconds = this.parseDateToTimestamp(
      targetDateTimeString,
      comparisonTimeZoneIdentifier,
    );
    // Parse the start boundary into a timestamp
    const startBoundaryTimestampSeconds = this.parseDateToTimestamp(
      windowStartDateString,
      comparisonTimeZoneIdentifier,
    );
    // Parse the end boundary into a timestamp
    const endBoundaryTimestampSeconds = this.parseDateToTimestamp(
      windowEndDateString,
      comparisonTimeZoneIdentifier,
    );
    // Return false when any parsing fails
    if (
      targetDateTimeTimestampSeconds === false ||
      startBoundaryTimestampSeconds === false ||
      endBoundaryTimestampSeconds === false
    ) {
      // Return false to signal invalid inputs
      return false;
    }
    // Convert timestamps into Luxon DateTimes
    const targetDateTimeInZone = LuxonDateTime.fromSeconds(
      targetDateTimeTimestampSeconds,
    ).setZone(comparisonTimeZoneIdentifier);
    const startBoundaryDateTimeInZone = LuxonDateTime.fromSeconds(
      startBoundaryTimestampSeconds,
    ).setZone(comparisonTimeZoneIdentifier);
    const endBoundaryDateTimeInZone = LuxonDateTime.fromSeconds(
      endBoundaryTimestampSeconds,
    ).setZone(comparisonTimeZoneIdentifier);
    // Normalize each DateTime to whole seconds
    const normalizedTargetBoundarySeconds = Math.floor(
      targetDateTimeInZone.toSeconds(),
    );
    const normalizedStartBoundarySeconds = Math.floor(
      startBoundaryDateTimeInZone.toSeconds(),
    );
    const normalizedEndBoundarySeconds = Math.floor(
      endBoundaryDateTimeInZone.toSeconds(),
    );
    // Handle the case where the window is non-overnight
    if (normalizedStartBoundarySeconds <= normalizedEndBoundarySeconds) {
      // Use the general timestamp comparison helper
      return this.isTimestampBetween(
        normalizedTargetBoundarySeconds,
        normalizedStartBoundarySeconds,
        normalizedEndBoundarySeconds,
        true,
      );
    }
    // Extend the end boundary by one day when the window wraps
    const wrappedEndBoundaryDaySeconds = Math.floor(
      endBoundaryDateTimeInZone.plus({ days: 1 }).toSeconds(),
    );
    // Return true when the target sits in the wrapped range
    return (
      normalizedTargetBoundarySeconds >= normalizedStartBoundarySeconds ||
      normalizedTargetBoundarySeconds <= wrappedEndBoundaryDaySeconds
    );
  }

  /**
   * Determine whether two date ranges overlap.
   *
   Normalize each boundary timestamp and assert that the intervals intersect.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/DateTime#doRangesOverlap #TODO
   *
   * @param {string} firstRangeStartString - Start of the first range.
   * @param {string} firstRangeEndString - End of the first range.
   * @param {string} secondRangeStartString - Start of the second range.
   * @param {string} secondRangeEndString - End of the second range.
   * @param {string|null} optionalTimeZoneIdentifier - Optional timezone for parsing.
   * @returns {boolean|false} True when ranges overlap, false otherwise.
   */
  static doRangesOverlap(
    firstRangeStartString,
    firstRangeEndString,
    secondRangeStartString,
    secondRangeEndString,
    optionalTimeZoneIdentifier = null,
  ) {
    // Determine which timezone to use for parsing
    const comparisonTimeZoneIdentifier =
      optionalTimeZoneIdentifier || this.getDefaultTimeZone();
    // Parse the first range start timestamp
    const firstRangeStartTimestampSeconds = this.parseDateToTimestamp(
      firstRangeStartString,
      comparisonTimeZoneIdentifier,
    );
    // Parse the first range end timestamp
    const firstRangeEndTimestampSeconds = this.parseDateToTimestamp(
      firstRangeEndString,
      comparisonTimeZoneIdentifier,
    );
    // Parse the second range start timestamp
    const secondRangeStartTimestampSeconds = this.parseDateToTimestamp(
      secondRangeStartString,
      comparisonTimeZoneIdentifier,
    );
    // Parse the second range end timestamp
    const secondRangeEndTimestampSeconds = this.parseDateToTimestamp(
      secondRangeEndString,
      comparisonTimeZoneIdentifier,
    );
    // Return false when any of the timestamps are invalid
    if (
      firstRangeStartTimestampSeconds === false ||
      firstRangeEndTimestampSeconds === false ||
      secondRangeStartTimestampSeconds === false ||
      secondRangeEndTimestampSeconds === false
    ) {
      // Return false to signal parsing failure
      return false;
    }
    // Normalize the first range boundaries
    const firstRangeLowerBound = Math.min(
      firstRangeStartTimestampSeconds,
      firstRangeEndTimestampSeconds,
    );
    const firstRangeUpperBound = Math.max(
      firstRangeStartTimestampSeconds,
      firstRangeEndTimestampSeconds,
    );
    // Normalize the second range boundaries
    const secondRangeLowerBound = Math.min(
      secondRangeStartTimestampSeconds,
      secondRangeEndTimestampSeconds,
    );
    const secondRangeUpperBound = Math.max(
      secondRangeStartTimestampSeconds,
      secondRangeEndTimestampSeconds,
    );
    // Return whether the ranges intersect
    return (
      firstRangeLowerBound <= secondRangeUpperBound &&
      secondRangeLowerBound <= firstRangeUpperBound
    );
  }

  /**
   * List each ISO date string for a range of days between two dates.
   *
   * Normalize the range endpoints, ensure validity, and accumulate each day sequentially.
   *
   * @author Linden May
   * @version 1.0.0
   * @since -
   * @updated -
   * @link https://docs.example.com/DateTime#listDaysInRange #TODO
   *
   * @param {string} inclusiveStartDateString - Inclusive start date string.
   * @param {string} inclusiveEndDateString - Inclusive end date string.
   * @param {string|null} optionalTimeZoneIdentifier - Optional timezone override.
   * @returns {string[]|false} Sequence of ISO date strings or false on error.
   */
  static listDaysInRange(
    inclusiveStartDateString,
    inclusiveEndDateString,
    optionalTimeZoneIdentifier = null,
  ) {
    // Resolve the timezone for parsing
    const resolvedTimeZoneIdentifier =
      optionalTimeZoneIdentifier || this.getDefaultTimeZone();
    // Parse the start boundary into a timestamp
    const inclusiveStartTimestampSeconds = this.parseDateToTimestamp(
      inclusiveStartDateString,
      resolvedTimeZoneIdentifier,
    );
    // Parse the end boundary into a timestamp
    const inclusiveEndTimestampSeconds = this.parseDateToTimestamp(
      inclusiveEndDateString,
      resolvedTimeZoneIdentifier,
    );
    // Return false when parsing fails for either boundary
    if (
      inclusiveStartTimestampSeconds === false ||
      inclusiveEndTimestampSeconds === false
    ) {
      // Return false to signal invalid inputs
      return false;
    }
    // Return false when the start occurs after the end
    if (inclusiveStartTimestampSeconds > inclusiveEndTimestampSeconds) {
      // Return false because the range is inverted
      return false;
    }
    // Build the start DateTime at the start of the day
    let currentDayIterator = LuxonDateTime.fromSeconds(
      inclusiveStartTimestampSeconds,
    )
      .setZone(resolvedTimeZoneIdentifier)
      .startOf("day");
    // Build the end DateTime at the start of the day
    const endDayDateTime = LuxonDateTime.fromSeconds(
      inclusiveEndTimestampSeconds,
    )
      .setZone(resolvedTimeZoneIdentifier)
      .startOf("day");
    // Return false when either DateTime is invalid
    if (!currentDayIterator.isValid || !endDayDateTime.isValid) {
      // Return false to signal invalid DateTimes
      return false;
    }
    // Prepare the results array
    const accumulatedDays = [];
    // Cache the end boundary in milliseconds for iteration
    const endDayMillis = endDayDateTime.toMillis();
    // Iterate until the start DateTime surpasses the end bound
    while (currentDayIterator.toMillis() <= endDayMillis) {
      // Append the current day formatted as ISO date
      accumulatedDays.push(currentDayIterator.toFormat("yyyy-MM-dd"));
      // Move the marker to the next day
      currentDayIterator = currentDayIterator.plus({ days: 1 });
    }
    // Return the accumulated list of days
    return accumulatedDays;
  }
}

module.exports = DateTime;
