'use strict';

/**
 * This class processes the raw argv values, extracting options and variables
 *
 * Options are defined as beginning with a '-' or '--' string. If only one dash
 * is used then all of the characters following it will be considered additional
 * single character flags. An any case, set a string option by using the following pattern:
```
  --<option>[=:]<value>
```
 * Variables follow the following pattern:
```
  <var_name>[=:]<value>
```
 */
class Args {
  /**
   * Constructor takes an array of arguments
   *
   * @param {string[]} argv Array of args, generally from process.argv
   */
  constructor(argv) {
    // Set up argument parts
    this.args = [];
    this.opts = {};
    this.vars = {};

    argv.forEach((arg, index) => {
      // Special case. Index 0 is the process (node)
      if (index === 0) {
        this.process = arg;
        return;
      }

      // Special case. Index 1 is the script
      if (index === 1) {
        this.script = arg;
        return;
      }

      // Extract single character flags
      let match = arg.match(/^-(?!-)(.+)(?![:=])/);
      if (match) {
        const flags = match[1];
        // Apply all characters as flags
        for (let i=0; i<flags.length; i++) {
          this.opts[flags.charAt(i)] = true;
        }
        return;
      }

      // Extract string options
      match = arg.match(/^--?(.+)[:=](.+)?/);
      if (match) {
        this.opts[match[1]] = match[2] || null;
        return;
      }

      // Extract multi character flags
      match = arg.match(/^--(.+)/);
      if (match) {
        this.opts[match[1]] = true;
        return;
      }

      // Extract Vars
      match = arg.match(/^(.+)[:=](.+)$/);
      if (match) {
        this.vars[match[1]] = match[2];
        return;
      }

      // Anything that remains is an argument
      this.args.push(arg);
    });
  }

  /**
   * Pseudo-Enum describes all valid actions. The 'action' is the first provided
   * argument
   */
  get ACTIONS() {
    return {
      /**
       * Uploads the current directory to S3
       */
      UPLOAD: 'UPLOAD',
      /**
       * Displays the help text
       */
      HELP: 'HELP'
    };
  }

  /**
   * Validates the arguments provided to this class. If any mismatches are found
   * an error will be thrown detailing the issue
   *
   * @return {Promise} Resolves on success, rejects with an error on error
   */
  async validate() {
    // There must be at least one argument (the action)
    if (this.args.length < 1) {
      throw new Error('Invalid Number of Arguments: Must provide at least one argument');
    }

    // Make sure the action is valid
    if (!this.ACTIONS[this.args[0].toUpperCase()]) {
      throw new Error(`Invalid action: "${this.args[0]}"`);
    }

    const action = this.args[0];

    // If the help flag is present we are done
    if (this.opts.h || this.opts.help) return;

    // Validations for the UPLOAD action
    if (action.toUpperCase() === this.ACTIONS.UPLOAD) {
      // There must be a bucket name
      if (!this.args[1]) {
        throw new Error('Bucket name must be provided');
      }
    }
  }
}

module.exports = Args;
