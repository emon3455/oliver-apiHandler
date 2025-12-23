/**
 * Class SafeUtils
 *
 * A collection of defensive sanitizers, parsers, and helpers for safely handling untrusted inputs.
 *
 * @link #TODO
 */

 class SafeUtils {
  /**
   * Determine presence of a value.
   *
   * Returns whether a value should be considered “present” (non-empty, non-null, non-NaN, etc.).
   *
   * // NOTE: 0 and false are considered present
   *
   * @author Linden May
   * @version 1.0.0
   * @since 1.0.0
   * @link #TODO
   *
   * @param {*} value - Value to test for presence.
   *
   * @returns {boolean} True if value is considered present; otherwise false.
   */
  static hasValue(value) {
    // Check if value is null or undefined
    if (value === null || value === undefined)
      // Return false
      return false;
    // Check if value is a string
    if (typeof value === "string")
      // Return whether trimmed string has length
      return value.trim().length > 0;
    // Check if value is a number
    if (typeof value === "number")
      // Return whether number is not NaN
      return !Number.isNaN(value);
    // Check if value is an array
    if (Array.isArray(value))
      // Return whether array has elements
      return value.length > 0;
    // Check if value is an object
  if (typeof value === "object") {
    const keys = [
      ...Object.getOwnPropertyNames(value),
      ...Object.getOwnPropertySymbols(value),
    ];

    if (keys.length === 0) return false;

     // check if at least one key has a non-null/undefined value
    return keys.some((key) => {
      const val = value[key];
      return val !== null && val !== undefined;
    });
  }
    // Return true
    return true;
  }

  /**
   * Sanitize and validate according to a schema.
   *
   * Applies type-specific sanitizers to each key based on the provided rules object.
   *
   * @author Linden May
   * @version 1.0.0
   * @since 1.0.0
   * @link #TODO
   *
   * @param {Object} args - Schema of { key: { value, type, required?, default? } }.
   *
   * @returns {Object} Object of sanitized values keyed by input schema keys.
   */
 static sanitizeValidate(schema = {}, argsObj = {}) {
  const isPlainObject = (obj) =>
    obj !== null &&
    typeof obj === "object" &&
    !Array.isArray(obj) &&
    Object.getPrototypeOf(obj) === Object.prototype;

  if (!isPlainObject(schema)) {
    throw SafeUtils.formatError(
      "sanitizeValidate",
      "schema must be a plain object"
    );
  }

  const sanitizers = {
    int: SafeUtils.sanitizeInteger,
    integer: SafeUtils.sanitizeInteger,
    float: SafeUtils.sanitizeFloat,
    numeric: SafeUtils.sanitizeFloat,
    bool: SafeUtils.sanitizeBoolean,
    boolean: SafeUtils.sanitizeBoolean,
    string: SafeUtils.sanitizeTextField,
    text: SafeUtils.sanitizeTextField,
    array: SafeUtils.sanitizeArray,
    iterable: SafeUtils.sanitizeIterable,
    email: SafeUtils.sanitizeEmail,
    url: SafeUtils.sanitizeUrl,
    html: SafeUtils.sanitizeHtmlWithWhitelist,
    object: SafeUtils.sanitizeObject,
  };

  const result = {};

  for (const [key, rule] of Object.entries(schema)) {
    if (!isPlainObject(rule) || typeof rule.type !== "string") {
      throw new TypeError(`sanitizeValidate(): invalid schema for "${key}"`);
    }

    const { type, required = false, default: defaultValue } = rule;
    const value = (key in argsObj) ? argsObj[key] : undefined;  // 👈 yahan fix

    const sanitizer = sanitizers[type.toLowerCase()];
    if (typeof sanitizer !== "function") {
      throw new TypeError(
        `sanitizeValidate(): unknown type "${type}" for "${key}"`
      );
    }

    if ("default" in rule) {
      const defaultCleaned = sanitizer(rule.default);
      if (!SafeUtils.hasValue(defaultCleaned)) {
        throw new TypeError(
          `sanitizeValidate(): "${key}" has invalid default for type ${type}`
        );
      }
    }

    if (!required && !SafeUtils.hasValue(value)) {
      result[key] = "default" in rule ? sanitizer(defaultValue) : null;
      continue;
    }

    if (required && !SafeUtils.hasValue(value)) {
  if (type.toLowerCase() === "iterable") {
    // allow passing iterators like Map.keys()
    // don’t throw, sanitizer will handle
  } else {
    throw new TypeError(`Missing required parameter: ${key}`);
  }
}


    const cleaned = sanitizer(value);
    if (cleaned === null) {
      throw new TypeError(
        `sanitizeValidate(): "${key}" failed sanitization. Expected ${type}.`
      );
    }

    result[key] = cleaned;
  }

  return result;
}


  /**
   * Normalize and validate a URL.
   *
   * Accepts only http/https schemes and enforces a maximum length, returning a normalized href.
   *
   * @author Linden May
   * @version 1.0.0
   * @since 1.0.0
   * @link #TODO
   *
   * @param {string} val - Raw URL string to validate.
   *
   * @returns {string|null} Normalized URL string, or null if invalid.
   */
  static sanitizeUrl(val) {
    // Return null if input is not a string
    if (typeof val !== "string") return null;

        // Reject URLs containing control characters upfront
    if (/[\u0000-\u001F\u007F]/.test(val)) return null;
    
    // Attempt to parse the input as a URL
    try {
      // Create a new URL object
      const u = new URL(val);
      // Return null if protocol is not http or https
      if (!["http:", "https:"].includes(u.protocol)) return null;
      // Clear the username field
      u.username = "";
      // Clear the password field
      u.password = "";

      // Reject hostnames with trailing dot
    if (u.hostname.endsWith(".")) return null;

     // Reject non-ASCII hostnames (IDN) until punycode support is added
    if (/[^\x00-\x7F]/.test(u.hostname)) return null;
    
      // Convert URL back to string
      const out = u.toString();
      // Return null if URL exceeds max length
      if (out.length > 2048) return null;
      // Return null if URL contains control characters
      if (/[\u0000-\u001F\u007F]/.test(out)) return null;
      // Return the sanitized URL string
      return out;
    } catch (e) {
      // Log warning if URL parsing fails
      console.warn("sanitizeUrl parsing error", e);
      // Return null on failure
      return null;
    }
  }

  /**
   * Strip tags and control characters from text.
   *
   * Trims, removes HTML tags and control/formatting chars; returns null if empty after cleaning.
   *
   * @author Linden May
   * @version 1.0.0
   * @since 1.0.0
   * @link #TODO
   *
   * @param {string} val - Input text to sanitize.
   *
   * @returns {string|null} Cleaned non-empty string or null when invalid/empty.
   */
  static sanitizeTextField(val) {
    // Return null if value is not a string
    if (typeof val !== "string") return null;
     // Strip HTML tags
  let s = val.replace(/<[^>]*>/g, "");
     // Remove zero-width and format characters
  s = s.replace(/[\u200B-\u200D\uFEFF]/g, "");

  // Remove control characters except newline (\n) and tab (\t)
  s = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, "");

  // Trim spaces and vertical whitespace only, preserve \n and \t
    s = s.replace(/^[ \f\v]+|[ \f\v]+$/g, "");
    
    // Attempt to normalize string to NFC
    try {
      s = s.normalize("NFC");
    } catch {
      // Ignore if normalization is unsupported
    }
    // Return sanitized string or null if empty
    return s.length ? s : null;
  }

  /**
   * Escape and serialize a safe URL.
   *
   * Validates scheme, strips credentials, re-encodes path segments, and preserves query/fragment.
   *
   * @author Linden May
   * @version 1.0.0
   * @since 1.0.0
   * @link #TODO
   *
   * @param {string} rawUrl - Raw URL (absolute or relative).
   * @param {string[]} [allowedProtocols=["http:", "https:", "ftp:"]] - Whitelisted protocols.
   *
   * @returns {string} A safely escaped URL string ('' if invalid).
   */
  static escUrl(rawUrl, allowedProtocols = ["http:", "https:"]) {
    // Return empty string if input is not a string or empty
    if (typeof rawUrl !== "string" || rawUrl.length === 0) return "";
    // Attempt to parse and sanitize URL
    try {

       if (/^(\/|\?|#|\.\/|\.\.\/)/.test(rawUrl)) {
      if (/[\u0000-\u001F\u007F]/.test(rawUrl)) return "";
      return rawUrl; // original relative URL preserve
    }
      // Create URL object with a base to handle relative paths
      const u = new URL(rawUrl, "http://_base_/");

      // Return empty string if protocol is not allowed
        if (!allowedProtocols.includes(u.protocol)) return "";

      // Check if URL is absolute
      if (u.origin !== "null") {
        
        // Remove username
        u.username = "";
        // Remove password
        u.password = "";
        // Return sanitized absolute URL
        return u.toString();
      }
      // Handle relative URLs
      const rel = rawUrl;
      // Return empty string if contains control characters
      if (/[\u0000-\u001F\u007F]/.test(rel)) return "";
      // Return sanitized relative URL
      return rel;
    } catch {
      // Return empty string if parsing fails
      return "";
    }
  }

  /**
   * Coerce to array and drop empties.
   *
   * Ensures an array return and filters out null/undefined/empty values via hasValue().
   *
   * @author Linden May
   * @version 1.0.0
   * @since 1.0.0
   * @link #TODO
   *
   * @param {*} input - Any input to coerce into an array.
   *
   * @returns {Array} Cleaned array of present values.
   */
  static sanitizeArray(input) {
    // Return empty array if input is null or undefined
    if (input == null) return [];
    // Ensure input is an array, wrap in array if not
    const arr = Array.isArray(input) ? input : [input];
    // Filter array to keep only values that exist
    return arr.filter((v) => SafeUtils.hasValue(v));
  }

  /**
   * Sanitize iterable.
   *
   * Attempts to convert an iterable to an array and filter valid values, or returns null on failure.
   *
   * @author Linden May
   * @version 1.0.0
   * @since 1.0.0
   * @link #TODO
   *
   * @param {Iterable} val - The iterable value to sanitize.
   *
   * @returns {Array|null} The sanitized array of values, or null if conversion fails.
   */
  static sanitizeIterable(val) {
    // Try block to attempt conversion
    try {
        // Return null if val is not iterable
        if (val == null || typeof val[Symbol.iterator] !== "function") {
            return null;
        }
        // Convert the iterable to an array and filter values
        return Array.from(val).filter(SafeUtils.hasValue);
    // Catch block to handle errors
    } catch {
        // Return null if conversion fails
        console.warn("Conversion failed for sanitizeIterable:", val);
        return null;
    }
}


  /**
   * Create a trimmed (optionally escaped) string.
   *
   * Converts any value to string, trims, and optionally HTML-escapes special characters.
   *
   * @author Linden May
   * @version 1.0.0
   * @since 1.0.0
   * @link #TODO
   *
   * @param {string} [val=""] - Value to stringify and trim.
   * @param {boolean} [escape=false] - Whether to HTML-escape & < > " ' characters.
   *
   * @returns {string} The sanitized string.
   */
  static sanitizeString(val = "", escape = false) {
    // Convert value to string if not already
    let s = typeof val === "string" ? val : String(val);
    // Trim whitespace from string
    s = s.trim();
    // Check if escaping is enabled
      if (escape) {
        // Replace special characters with HTML entities, avoid double-encoding
        s = s.replace(/[&<>"']/g, (chr) => {
            // If & is part of an existing entity, leave it
            if (chr === "&" && /&[a-zA-Z]+;/.test(s)) return "&";
            return {
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                '"': "&quot;",
                "'": "&#39;",
            }[chr];
        });
    }
    // Return sanitized string
    return s;
  }

  /**
   * Parse a safe integer.
   *
   * Accepts numeric or base-10 string integers within JS safe integer bounds; else null.
   *
   * @author Linden May
   * @version 1.0.0
   * @since 1.0.0
   * @link #TODO
   *
   * @param {*} val - Candidate integer value.
   *
   * @returns {number|null} Parsed safe integer or null if invalid.
   */
  static sanitizeInteger(val) {
    // Return null if value is null or undefined
    if (val === null || val === undefined) return null;
    // Check if value is a number
    if (typeof val === "number") {
      // Return null if not an integer
      if (!Number.isInteger(val)) return null;
      // Return null if not finite
      if (!Number.isFinite(val)) return null;
      // Return null if not a safe integer
      if (!Number.isSafeInteger(val)) return null;
      // Return the valid number
      return val;
    }
    // Check if value is a string
    if (typeof val === "string") {
      // Trim the string
      const s = val.trim();
      // Return null if not a valid signed integer format
      if (!/^[+-]?\d+$/.test(s)) return null;
      // Convert string to number
      const n = Number(s);
      // Return null if not finite or not safe integer
      if (!Number.isFinite(n) || !Number.isSafeInteger(n)) return null;
      // Return the valid number
      return n;
    }
    // Return null for unsupported types
    return null;
  }

  /**
   * Parse a safe float.
   *
   * Accepts finite numbers or strictly validated float strings (including exponent notation).
   *
   * @author Linden May
   * @version 1.0.0
   * @since 1.0.0
   * @link #TODO
   *
   * @param {*} val - Candidate floating-point value.
   *
   * @returns {number|null} Finite number or null if invalid.
   */
  static sanitizeFloat(val) {
    // Return null if value is null or undefined
    if (val == null) return null;
    // Check if value is a number
    if (typeof val === "number") {
      // Return value if it is finite, else null
      return Number.isFinite(val) ? val : null;
    }
    // Check if value is a string
    if (typeof val === "string") {
      // Trim whitespace from string
      const str = val.trim();
      // Define regex pattern for valid float format
      const floatPattern = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
      // Validate string matches float pattern
      if (!floatPattern.test(str)) {
        // Return null if string is not a valid float
        return null;
      }
      // Convert string to number
      const n = Number(str);
      // Return number if it is finite, else null
      return Number.isFinite(n) ? n : null;
    }
    // Return null for unsupported types
    console.warn("Unsupported type for sanitizeFloat:", val);
    return null;
  }

  /**
   * Coerce to boolean.
   *
   * Interprets booleans, 1/0, and common string toggles (true/false/yes/no/on/off); else null.
   *
   * @author Linden May
   * @version 1.0.0
   * @since 1.0.0
   * @link #TODO
   *
   * @param {*} val - Candidate boolean value.
   *
   * @returns {boolean|null} True/false or null when unrecognized.
   */
  static sanitizeBoolean(val) {
    // Check if value is already boolean
    if (typeof val === "boolean") {
      // Return the boolean value
      return val;
    }
    // Check if value is a number
    if (typeof val === "number") {
      // Return null if value is NaN or not finite
      if (Number.isNaN(val) || !Number.isFinite(val)) return null;
      // Return true if value equals 1, false if 0, else null
      return val === 1 ? true : val === 0 ? false : null;
    }
    // Check if value is a string
    if (typeof val === "string") {
      // Normalize and trim the string
      const v = val.trim().toLowerCase();
      // Create set of truthy string values
      const TRUE_SET = new Set(["true", "1", "yes", "y", "on"]);
      // Create set of falsy string values
      const FALSE_SET = new Set(["false", "0", "no", "n", "off"]);
      // Return true if value is in truthy set
      if (TRUE_SET.has(v)) return true;
      // Return false if value is in falsy set
      if (FALSE_SET.has(v)) return false;
      // Return null if no match found
      return null;
    }
    // Return null for unsupported types
    return null;
  }

  /**
   * Validate a plain object.
   *
   * Accepts non-null plain objects, filters dangerous keys, and returns null if empty/invalid.
   *
   * // NOTE: Only shallow sanitization; nested structures are not cleaned
   *
   * @author Linden May
   * @version 1.0.0
   * @since 1.0.0
   * @link #TODO
   *
   * @param {*} val - Candidate object to validate.
   *
   * @returns {Object|null} Safe shallow-cloned object or null.
   */
  static sanitizeObject(val) {
    // Define helper to check if value is a plain object
    const isPlainObject = (obj) =>
      Object.prototype.toString.call(obj) === "[object Object]";
    // Return null if value is not a plain object
    if (!isPlainObject(val)) {
      return null;
    }
    // Create result object
    const result = {};
    // Iterate over key-value pairs of input object
    for (const [key, v] of Object.entries(val)) {
      // Skip dangerous prototype-related keys
      if (key === "__proto__" || key === "constructor" || key === "prototype") {
        continue;
      }
      // Assign safe key-value to result
      result[key] = v;
    }
    // Return result if not empty, else null
    return Object.keys(result).length > 0 ? result : null;
  }

  /**
   * Normalize and validate email.
   *
   * Trims, lowercases domain, checks length and ASCII pattern; returns null if invalid.
   *
   * @author Linden May
   * @version 1.0.0
   * @since 1.0.0
   * @link #TODO
   *
   * @param {string} val - Input email string.
   *
   * @returns {string|null} Normalized email or null if invalid.
   */
    static sanitizeEmail(val) {
    // Return null if the input is not a string
    if (typeof val !== "string") return null;

    // Trim whitespace from the input
    const input = val.trim();

    // Return null if the trimmed input is empty
    if (input === "") return null;

    // Find the last occurrence of '@' symbol
    const atIndex = input.lastIndexOf("@");

    // Return null if '@' is missing, at the start, or at the end
    if (atIndex < 1 || atIndex === input.length - 1) return null;

    // Extract the domain: everything after the last '@'
    const domain = input.slice(atIndex + 1);

    // Find the previous '@' before the last one (if any)
    const prevAtIndex = input.lastIndexOf("@", atIndex - 1);

    // Extract the real local part:
    // If there is a previous '@', take the part between previous and last '@'
    // Otherwise, take everything before the last '@'
    const realLocal = prevAtIndex === -1 ? input.slice(0, atIndex) : input.slice(prevAtIndex + 1, atIndex);

    // Return null if local or domain exceeds maximum allowed length
    if (realLocal.length > 64 || domain.length > 255) return null;

    // Return null if domain ends with a dot
    if (domain.endsWith(".")) return null;

    // Return null if any label in the domain is invalid (<1 or >63 characters)
    if (domain.split(".").some(label => label.length < 1 || label.length > 63)) return null;

    // Enforce ASCII-only characters in both local and domain parts
    const asciiOnly = /^[\x00-\x7F]+$/;
    if (!asciiOnly.test(realLocal) || !asciiOnly.test(domain)) return null;

    // Normalize email by converting local and domain parts to lowercase
    const normalized = `${realLocal.toLowerCase()}@${domain.toLowerCase()}`;

    // Validate the normalized email against a standard email regex
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (!emailRegex.test(normalized)) return null;

    // Return the normalized valid email
    return normalized;
}

  /**
   * Merge entries into defaults safely.
   *
   * Parses various input shapes into key/value pairs and merges into a cloned defaults object.
   *
   * @author Linden May
   * @version 1.0.0
   * @since 1.0.0
   * @link #TODO
   *
   * @param {(URLSearchParams|string|Array|Object|null|undefined)} input - Source of entries.
   * @param {Object} [defaults={}] - Default key/value pairs.
   *
   * @returns {Object} Resulting merged arguments object.
   */
  static parseArgs(input, defaults = {}) {
    // Throw error if defaults is not a plain object
    if (!defaults || typeof defaults !== "object" || Array.isArray(defaults)) {
      throw new TypeError("parseArgs(): defaults must be a plain object");
    }
    // Create output object with defaults
    const out = Object.assign({}, defaults);
    // Define helper to assign sanitized key-value pair
    const assignKeyVal = (k, v) => {
    // Skip unsafe keys
    if (k === "__proto__" || k === "constructor" || k === "prototype") return;

    // Preserve numbers, booleans, null as-is
    if (typeof v === "number" || typeof v === "boolean" || v === null) {
      out[k] = v;
      return;
    }

    // Convert value to string
    const str = String(v);
    // Sanitize string value
    let clean = SafeUtils.sanitizeTextField(str);
    // Trim leading/trailing spaces
    clean = clean.trim();
    // Assign sanitized value to output
    out[k] = clean;
  };

    // Return defaults if input is null or undefined
    if (input == null) return out;
    // Handle string input
    if (typeof input === "string") {
      // Strip leading ? from query string
      const s = input.startsWith("?") ? input.slice(1) : input;
      // Create URLSearchParams from string
      const usp = new URLSearchParams(s);
      // Assign each entry to output
      for (const [k, v] of usp.entries()) assignKeyVal(k, v);
      // Return populated output
      return out;
    }
    // Handle URLSearchParams input
    if (input instanceof URLSearchParams) {
      // Assign each entry to output
      for (const [k, v] of input.entries()) assignKeyVal(k, v);
      // Return populated output
      return out;
    }
    // Handle array of pairs input
    if (Array.isArray(input)) {
      // Iterate over array entries
      for (const pair of input) {
        // Check if entry is key-value pair
        if (Array.isArray(pair) && pair.length === 2) {
          // Destructure key and value
          const [k, v] = pair;
          // Assign only if key is string
          if (typeof k === "string") assignKeyVal(k, v);
        }
      }
      // Return populated output
      return out;
    }
    // Handle plain object input
    if (typeof input === "object") {
      // Iterate over object entries
      for (const [k, v] of Object.entries(input)) {
        // Assign only if key is string
        if (typeof k === "string") assignKeyVal(k, v);
      }
      // Return populated output
      return out;
    }
    // Return defaults when input type is unsupported
    return out;
  }

  /**
   * Parse a URL into parts.
   *
   * Light URL parser supporting absolute/relative inputs; optionally returns one component.
   *
   * @author Linden May
   * @version 1.0.0
   * @since 1.0.0
   * @link #TODO
   *
   * @param {string} input - URL string to parse.
   * @param {string|null} [component=null] - Specific component key to return.
   *
   * @returns {(false|Object|string|null)} False if invalid; parts object or selected component.
   */
  static parseUrl(input, component = null) {
    // Return false if input is not a string or empty
    if (typeof input !== "string" || input.length === 0) return false;
    // Return false if input length exceeds limit
    if (input.length > 4096) return false;
    // Return false if input contains control characters
    if (/[\u0000-\u001F\u007F]/.test(input)) return false;
    // Attempt to parse using the URL API
    try {
      // Create URL with a base to support relative inputs
      const u = new URL(input, "http://_base_/");
      // Determine if the input is an absolute URL
      const isAbsolute = /^[a-z][a-z0-9+\-.]*:/i.test(input);
      // Create the result object
      const result = {
        // Set the scheme or empty string for relative inputs
        scheme: isAbsolute ? u.protocol.replace(/:$/, "") || "" : "",
        // Set the host or empty string for relative inputs
        host: isAbsolute ? u.hostname || "" : "",
        // Set the port as number or null when absent
        port: isAbsolute && u.port ? Number(u.port) : null,
        // Set the path or empty string
        path: u.pathname || "",
        // Set the query without leading question mark
        query: u.search ? u.search.replace(/^\?/, "") : "",
        // Set the fragment without leading hash
        fragment: u.hash ? u.hash.replace(/^#/, "") : "",
      };
      // Return full result when no component requested
      if (component == null) return result;

       //Fix: if relative URL and component is "host" or "scheme" or "port", return false
    if (!isAbsolute && ["host", "scheme", "port"].includes(component)) {
      return false;
    }

      // Return requested component or false when invalid
      return Object.prototype.hasOwnProperty.call(result, component)
        ? result[component]
        : false;
    } catch {
      // Return false on parsing failure
      return false;
    }
  }

  /**
   * Add or update query arguments.
   *
   * Accepts single key/value or an object of params, preserving fragments and existing params.
   *
   * @author Linden May
   * @version 1.0.0
   * @since 1.0.0
   * @link #TODO
   *
   * @param {(Object|string|number|null|undefined)} keyOrParams - Key name or params object.
   * @param {*} valOrUrl - Value for key, or URL when keyOrParams is an object.
   * @param {(string|number|undefined)} maybeUrl - URL when keyOrParams is a key.
   *
   * @returns {string} URL with updated query string.
   */
  static addQueryArg(keyOrParams, valOrUrl, maybeUrl) {
    // Define helper function to apply query params
    const apply = (url, paramsObj) => {
      // Declare URL variable
      let u;
      try {
        // Try to construct URL object
        u = new URL(url);
      } catch {
        // Return original string if URL is malformed
        return url;
      }
      // Get search params object
      const sp = u.searchParams;
      // Iterate over entries of params object
      for (const [k, v] of Object.entries(paramsObj)) {
        // Continue if key is not string or number
        if (typeof k !== "string" && typeof k !== "number") continue;
        // Delete param if value is null or undefined
        if (v === null || v === undefined) {
          sp.delete(String(k));
        } else {
          try {
            // Set param with stringified value
            sp.set(String(k), String(v));
          } catch {
            // Skip if value is not stringifiable
          }
        }
      }
      // Update search string
      u.search = sp.toString();
      // Return modified URL string
      return u.toString();
    };

    // Check if first arg is params object
    if (
      typeof keyOrParams === "object" &&
      keyOrParams !== null &&
      !Array.isArray(keyOrParams)
    ) {
      // Return URL with applied params
      return apply(String(valOrUrl || ""), keyOrParams);
    }

    // Assign key variable
    const key = keyOrParams;
    // Assign value variable
    const value = valOrUrl;
    // Convert maybeUrl to string
    const url = String(maybeUrl || "");
    // Return original URL if key is invalid
     if (typeof key !== "string" && typeof key !== "number") {
    try {
      return new URL(url).toString();
    } catch {
      return url; // if it's not a valid URL
    }
  }
    // Return URL with applied single param
    return apply(url, { [String(key)]: value });
  }

  /**
   * Infer array element type.
   *
   * Returns a simple type annotation like "number[]" or "mixed[]" for the array contents.
   *
   * @author Linden May
   * @version 1.0.0
   * @since 1.0.0
   * @link #TODO
   *
   * @param {Array} arr - Array to analyze.
   *
   * @returns {string} Element type annotation for the array.
   */
  static getArrayType(arr) {
    // Throw error if input is not an array
    if (!Array.isArray(arr)) {
      throw new TypeError("getArrayType(): expected an array input");
    }
    // Return mixed[] if array is empty
    if (arr.length === 0) return "mixed[]";
    // Map each element to its type
     const elementTypes = arr.map((v) => {
    if (Array.isArray(v)) {
      return SafeUtils.getArrayType(v); // recursion for nested arrays
    }
    return typeof v;
  });

    // Create a set of unique types
      const unique = [...new Set(elementTypes)];

    // Check if array has only one type
     if (unique.length === 1) {
    return unique[0] + "[]";
  }
    // Return mixed[] if multiple types exist
    return "mixed[]";
  }

  /**
   * Format error message.
   *
   * Creates and returns a new TypeError with the given method name and message.
   *
   * @author Linden May
   * @version 1.0.0
   * @since 1.0.0
   * @link #TODO
   *
   * @param {string} method - The method name associated with the error.
   * @param {string} message - The error message to include.
   *
   * @returns {TypeError} A new TypeError instance with formatted message.
   */
  static formatError(method, message) {
    // Convert method to string
    const m = String(method);
    // Convert message to string
    const msg = String(message);
    // Return new TypeError with formatted message
    return new TypeError(`${m}(): ${msg}`);
  }

  /**
   * Sanitize HTML with a whitelist.
   *
   * Removes disallowed tags/attributes, comments, and optionally escapes text node characters.
   *
   * @author Linden May
   * @version 1.0.0
   * @since 1.0.0
   * @link #TODO
   *
   * @param {string} input - Raw HTML input to sanitize.
   * @param {boolean} [escapeChars=false] - Whether to escape special characters in text nodes.
   *
   * @returns {string} Sanitized HTML string.
   */
static sanitizeHtmlWithWhitelist(input, escapeChars = false) {
    // Return empty string if input is not a string
    if (typeof input !== "string") return "";
    // Return empty string if input is empty
    if (input === "") return "";
    // Declare JSDOM reference
    let JSDOM;
    // Attempt to require jsdom for DOM parsing
    try {
      // Import jsdom and extract JSDOM constructor
      ({ JSDOM } = require("jsdom"));
    } catch {
      // When jsdom is unavailable, strip tags and optionally escape
      let result = input.replace(/<[^>]*>/g, "").trim();
      if (escapeChars) {
        result = result
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;");
      }
      return result;
    }
    // Create a new JSDOM instance with input inside body
    const dom = new JSDOM(`<body>${input}</body>`);
    // Destructure document from window
    const { document } = dom.window;
    // Define whitelist of allowed tags and attributes
    const ALLOWED = {
      A: ["href", "title", "target", "rel"],
      ABBR: ["title"],
      B: [],
      BLOCKQUOTE: ["cite"],
      BR: [],
      CITE: [],
      CODE: [],
      DEL: ["datetime"],
      EM: [],
      I: [],
      INS: ["datetime"],
      LI: [],
      OL: [],
      P: [],
      Q: ["cite"],
      SPAN: ["style"],
      STRONG: [],
      UL: [],
    };
    // Define helper to test if an element tag is allowed
    const isAllowed = (el) => {
      // Return true if tag exists in whitelist
      return Object.prototype.hasOwnProperty.call(ALLOWED, el.tagName);
    };
    // Define recursive sanitizer for DOM nodes
    function sanitizeNode(node) {
      // Iterate children in reverse to allow safe mutation
      for (let i = node.childNodes.length - 1; i >= 0; i--) {
        // Get the current child node
        const child = node.childNodes[i];
        // Handle element nodes
        if (child.nodeType === 1) {
          // Get uppercase tag name
          const tagName = child.tagName.toUpperCase();
          // Replace disallowed elements with their text content
          if (!isAllowed(child)) {
            // Create a text node with child text content
            const text = document.createTextNode(child.textContent || "");
            // Replace the child element with the text node
            node.replaceChild(text, child);
            // Continue to next child
            continue;
          }
          // Build a set of allowed attributes for this tag
          const allowedAttrs = new Set(ALLOWED[tagName]);
          // Remove attributes not present in the whitelist
          for (const attr of Array.from(child.attributes)) {
            // Remove attribute if it is not allowed
            if (!allowedAttrs.has(attr.name)) {
              // Remove the non-whitelisted attribute
              child.removeAttribute(attr.name);
            }
          }
          // Apply anchor specific sanitation rules
          if (tagName === "A") {
            // Read raw href attribute
            const rawHref = child.getAttribute("href");
            // Sanitize URL against allowed protocols
            let cleanHref = SafeUtils.escUrl(rawHref, ["http:", "https:"]);
             // Remove trailing slash from URLs like https://ex.com/
              if (cleanHref && cleanHref.endsWith("/")) {
                  cleanHref = cleanHref.slice(0, -1);
              }
            // Replace anchor with text if URL is invalid
            if (!cleanHref) {
              // Create a text node from link text
              const text = document.createTextNode(child.textContent || "");
              // Replace the anchor element with the text node
              node.replaceChild(text, child);
              // Continue to next child
              continue;
            }
            // Set the sanitized href back on the element
            child.setAttribute("href", cleanHref);
            // Enforce rel when target is _blank
            if (child.getAttribute("target") === "_blank") {
              // Set rel to prevent tabnabbing
              child.setAttribute("rel", "noopener noreferrer");
            }
          }
          // Recurse into allowed child element
          sanitizeNode(child);
          // Continue to next child
          continue;
        }
        // Drop comment nodes
        if (child.nodeType === 8) {
          // Remove the comment node
          node.removeChild(child);
          // Continue to next child
          continue;
        }
        // Handle text nodes with escapeChars option
        if (child.nodeType === 3 && escapeChars) {
          // Get the text content and escape only quotes
          // Don't escape & here as JSDOM will handle it properly
          const txt = child.nodeValue || "";
          const escaped = txt
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
          // Only update if changed
          if (escaped !== txt) {
            child.nodeValue = escaped;
          }
        }
      }
    }
    // Sanitize the document body content  
    sanitizeNode(document.body);
    
    // Get the result and handle the double-encoding issue
    let result = document.body.innerHTML;
    
    // Fix double-encoded quotes that JSDOM created
    if (escapeChars) {
      result = result
        .replace(/&amp;quot;/g, "&quot;")
        .replace(/&amp;#39;/g, "&#39;");
    }
    
    return result;
  }
}

module.exports = SafeUtils;