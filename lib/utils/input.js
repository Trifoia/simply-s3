'use strict';

/**
 * The Input helper class is used to get user input
 */
class Input {
  /**
   * Constructor initializes the readline interface
   *
   * @param {object} opts Options passed into readline.createInterface
   */
  constructor(opts) {
    const readline = require('readline');
    this.rl = readline.createInterface(opts);

    this.prompt = '> ';

    // Override the internal _writeToOutput function so we can hide sensitive information
    this.rl._writeToOutput = (stringToWrite) => {
      if (stringToWrite === this.prompt) {
        this.rl.output.write(stringToWrite);
        return;
      }

      if (this.muted) {
        this.rl.output.write('');
      } else {
        this.rl.output.write(stringToWrite);
      }
    };
  }

  /**
   * Ask the user a question, and receive an answer
   *
   * @param {string} question Question for the user
   * @param {boolean} hide Whether the user input should be hidden
   */
  async ask(question, hide) {
    console.log(question);

    return new Promise((resolve) => {
      this.muted = hide;
      this.rl.question(this.prompt, (value) => {
        this.muted = false;
        return resolve(value);
      });
    });
  }

  /**
   * Close the readline interface
   */
  close() {
    this.rl.close();
  }
}

module.exports = Input;
